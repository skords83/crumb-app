// api/bake-engine.js
// ============================================================
// BAKE ENGINE — State Machine für Backplan-Sessions
//
// Jeder Step hat einen Status: locked → ready → active → done
// Warten-Steps haben zusätzlich: active → soft_done → done
//
// Die Engine berechnet:
// - Welche Steps freigeschaltet werden (Auto-Advance)
// - Phase-Gate-Erkennung (alle Dependencies einer Phase done?)
// - Dynamische Zeitprognose (projected_end)
// - Notification-Trigger
// ============================================================

// ── Step-Typen und gültige Transitions ──────────────────────
const VALID_TRANSITIONS = {
  'locked':    ['ready'],
  'ready':     ['active'],
  'active':    ['soft_done', 'done'],
  'soft_done': ['done', 'active'], // active = timer verlängert
  'done':      [],
};

const WAIT_TYPES = new Set(['Warten', 'Kühl', 'Ruhen']);
const BAKE_TYPES = new Set(['Backen']);

function isWaitStep(step) { return WAIT_TYPES.has(step.type); }
function isBakeStep(step) { return BAKE_TYPES.has(step.type); }
function isActionStep(step) { return !isWaitStep(step) && !isBakeStep(step); }
function isMicroAction(step) { return isActionStep(step) && (parseInt(step.duration) || 0) === 0; }

// ── Dependency-Graph aufbauen ───────────────────────────────
// Identisch zur bestehenden Logik in backplan-utils.ts und index.js
function buildDependencyGraph(sections) {
  const phaseNames = sections.map(s => s.name);
  const deps = {};

  const normalize = (name) =>
    name.toLowerCase()
      .replace(/^\d+\.\s*/, '')
      .replace(/\bstufe\s+\d+\b/g, '')
      .replace(/\breifer?\b/g, '')
      .replace(/\bfrischer?\b/g, '')
      .replace(/\bfertig[a-z]*\b/g, '')
      .replace(/\bgesamte?s?\b/g, '')
      .replace(/\beingeweicht\w*\b/g, '')
      .replace(/\s+/g, ' ').trim();

  sections.forEach(section => {
    deps[section.name] = [];
    (section.ingredients || []).forEach(ing => {
      const candidates = [ing.name || '', ing.temperature || ''];
      candidates.forEach(candidate => {
        const ingName = normalize(candidate);
        if (ingName.length < 3) return;
        phaseNames.forEach(otherName => {
          if (otherName === section.name) return;
          const normOther = normalize(otherName);
          if (normOther.length < 4) return;
          const wb = new RegExp(`(?:^|\\s)${normOther.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
          if (wb.test(ingName) || ingName === normOther) {
            if (!deps[section.name].includes(otherName)) {
              deps[section.name].push(otherName);
            }
          }
        });
      });
    });
  });

  return deps;
}

// ── Flatten: Sections → Step-Liste mit Metadaten ────────────
// Erzeugt eine flache Liste aller Steps mit Phase-Info und globalem Index
function flattenSteps(sections) {
  const steps = [];
  sections.forEach(section => {
    (section.steps || []).forEach((step, localIdx) => {
      steps.push({
        globalIdx: steps.length,
        phase: section.name,
        localIdx,
        instruction: step.instruction || '',
        type: step.type || 'Aktion',
        duration: parseInt(step.duration) || 0,
        duration_min: parseInt(step.duration_min) || null,
        duration_max: parseInt(step.duration_max) || null,
        ingredients: section.ingredients || [],
      });
    });
  });
  return steps;
}

// ── Initialen State berechnen ───────────────────────────────
// Beim Start einer Session: alle Steps auf locked setzen,
// dann erste Steps jeder Phase ohne Dependencies freischalten
function computeInitialStates(sections) {
  const steps = flattenSteps(sections);
  const deps = buildDependencyGraph(sections);
  const states = {};
  const timestamps = {};

  // Alle auf locked
  steps.forEach((s, i) => { states[i] = 'locked'; });

  // Phasen ohne Dependencies: erster Step → ready
  const phaseNames = sections.map(s => s.name);
  phaseNames.forEach(phaseName => {
    const phaseDeps = deps[phaseName] || [];
    if (phaseDeps.length === 0) {
      // Erster Step dieser Phase → ready
      const firstStep = steps.find(s => s.phase === phaseName);
      if (firstStep) {
        states[firstStep.globalIdx] = 'ready';
      }
    }
  });

  // Ready Aktions-Steps → sofort active
  steps.forEach(s => {
    if (states[s.globalIdx] === 'ready' && isActionStep(s)) {
      states[s.globalIdx] = 'active';
      timestamps[s.globalIdx] = { started_at: Date.now(), planned_duration: s.duration * 60 };
    } else if (states[s.globalIdx] === 'ready' && (isWaitStep(s) || isBakeStep(s))) {
      // Warten/Backen bleiben ready bis der vorherige Aktion-Step done ist
      // (nur wenn es der allererste Step der Phase ist UND ein Warten-Step, wird er active)
      const phaseSteps = steps.filter(st => st.phase === s.phase);
      if (phaseSteps[0].globalIdx === s.globalIdx) {
        // Erster Step der Phase ist ein Warten/Backen → active + timer
        states[s.globalIdx] = 'active';
        timestamps[s.globalIdx] = {
          started_at: Date.now(),
          planned_duration: s.duration * 60,
          timer_end: Date.now() + s.duration * 60000,
        };
      }
    }
  });

  return { states, timestamps };
}

// ── Transition durchführen ──────────────────────────────────
// Nimmt den aktuellen State und führt einen Transition durch.
// Gibt den neuen State + alle ausgelösten Side-Effects zurück.
function performTransition(sections, stepStates, stepTimestamps, stepIndex, action, extraData = {}) {
  const steps = flattenSteps(sections);
  const deps = buildDependencyGraph(sections);
  const now = Date.now();

  // Deep copy
  const states = { ...stepStates };
  const timestamps = {};
  Object.keys(stepTimestamps).forEach(k => {
    timestamps[k] = { ...stepTimestamps[k] };
  });

  const step = steps[stepIndex];
  if (!step) return { error: 'Step nicht gefunden', states, timestamps, sideEffects: [] };

  const currentState = states[stepIndex];
  const sideEffects = []; // Sammelt: { type: 'notification'|'gate_ready', data: {...} }

  // ── Action: complete ──────────────────────────────────────
  if (action === 'complete') {
    if (currentState !== 'active' && currentState !== 'soft_done' && currentState !== 'ready') {
      return { error: `Step ${stepIndex} kann nicht abgeschlossen werden (Status: ${currentState})`, states, timestamps, sideEffects };
    }

    states[stepIndex] = 'done';
    if (!timestamps[stepIndex]) timestamps[stepIndex] = {};
    timestamps[stepIndex].completed_at = now;
    if (timestamps[stepIndex].started_at) {
      timestamps[stepIndex].actual_duration = Math.round((now - timestamps[stepIndex].started_at) / 1000);
    }

    // Auto-mark: Micro-Aktionen davor die noch nicht done sind
    const phaseSteps = steps.filter(s => s.phase === step.phase);
    for (const ps of phaseSteps) {
      if (ps.globalIdx >= stepIndex) break;
      if (states[ps.globalIdx] !== 'done' && isMicroAction(ps)) {
        states[ps.globalIdx] = 'done';
        if (!timestamps[ps.globalIdx]) timestamps[ps.globalIdx] = {};
        timestamps[ps.globalIdx].completed_at = now;
        timestamps[ps.globalIdx].auto_completed = true;
      }
    }

    // Auto-Advance: nächsten Step in der Phase freischalten
    const nextInPhase = steps.find(s => s.phase === step.phase && s.globalIdx > stepIndex && states[s.globalIdx] === 'locked');
    if (nextInPhase) {
      states[nextInPhase.globalIdx] = 'ready';
      // Aktions-Steps → sofort active
      if (isActionStep(nextInPhase)) {
        states[nextInPhase.globalIdx] = 'active';
        timestamps[nextInPhase.globalIdx] = { started_at: now, planned_duration: nextInPhase.duration * 60 };
      } else if (isWaitStep(nextInPhase)) {
        // Warten → sofort active mit Timer
        states[nextInPhase.globalIdx] = 'active';
        timestamps[nextInPhase.globalIdx] = {
          started_at: now,
          planned_duration: nextInPhase.duration * 60,
          timer_end: now + nextInPhase.duration * 60000,
        };
      }
      // Backen → bleibt ready (User muss "Ofen bereit" bestätigen)
    }

    // Phase-Gate prüfen: Sind jetzt alle Deps einer anderen Phase erfüllt?
    const phaseNames = sections.map(s => s.name);
    phaseNames.forEach(phaseName => {
      const phaseDeps = deps[phaseName] || [];
      if (phaseDeps.length === 0) return;

      // Prüfe ob alle Steps aller Dependency-Phasen done sind
      const allDepsDone = phaseDeps.every(depPhase => {
        const depSteps = steps.filter(s => s.phase === depPhase);
        return depSteps.every(s => states[s.globalIdx] === 'done');
      });

      if (!allDepsDone) return;

      // Prüfe ob die Phase noch komplett locked ist (Gate noch nicht bestätigt)
      const targetSteps = steps.filter(s => s.phase === phaseName);
      const allLocked = targetSteps.every(s => states[s.globalIdx] === 'locked');

      if (allLocked && targetSteps.length > 0) {
        sideEffects.push({
          type: 'gate_ready',
          data: {
            phase: phaseName,
            dependencies: phaseDeps,
            firstStepIdx: targetSteps[0].globalIdx,
          }
        });
      }
    });
  }

  // ── Action: start_baking ──────────────────────────────────
  else if (action === 'start_baking') {
    if (currentState !== 'ready') {
      return { error: `Backen-Step ${stepIndex} ist nicht ready (Status: ${currentState})`, states, timestamps, sideEffects };
    }
    states[stepIndex] = 'active';
    timestamps[stepIndex] = {
      started_at: now,
      planned_duration: step.duration * 60,
      timer_end: now + step.duration * 60000,
    };
  }

  // ── Action: confirm_gate ──────────────────────────────────
  else if (action === 'confirm_gate') {
    // Alle Steps der genannten Phase von locked → ready/active
    const phaseName = extraData.phase;
    if (!phaseName) return { error: 'Phase fehlt für confirm_gate', states, timestamps, sideEffects };

    const phaseSteps = steps.filter(s => s.phase === phaseName);
    if (phaseSteps.length === 0) return { error: `Phase "${phaseName}" nicht gefunden`, states, timestamps, sideEffects };

    // Nur den ersten Step freischalten, Rest bleibt locked
    const firstStep = phaseSteps[0];
    if (states[firstStep.globalIdx] !== 'locked') {
      return { error: `Phase "${phaseName}" ist bereits freigeschaltet`, states, timestamps, sideEffects };
    }

    if (isActionStep(firstStep)) {
      states[firstStep.globalIdx] = 'active';
      timestamps[firstStep.globalIdx] = { started_at: now, planned_duration: firstStep.duration * 60 };
    } else if (isWaitStep(firstStep)) {
      states[firstStep.globalIdx] = 'active';
      timestamps[firstStep.globalIdx] = {
        started_at: now,
        planned_duration: firstStep.duration * 60,
        timer_end: now + firstStep.duration * 60000,
      };
    } else if (isBakeStep(firstStep)) {
      states[firstStep.globalIdx] = 'ready';
    }
  }

  // ── Action: extend_timer ──────────────────────────────────
  else if (action === 'extend_timer') {
    if (currentState !== 'active' && currentState !== 'soft_done') {
      return { error: `Timer für Step ${stepIndex} kann nicht verlängert werden (Status: ${currentState})`, states, timestamps, sideEffects };
    }
    const minutes = parseInt(extraData.minutes) || 15;
    if (!timestamps[stepIndex]) timestamps[stepIndex] = {};
    const oldEnd = timestamps[stepIndex].timer_end || now;
    const newEnd = Math.max(oldEnd, now) + minutes * 60000;
    timestamps[stepIndex].timer_end = newEnd;
    timestamps[stepIndex].extended_by = (timestamps[stepIndex].extended_by || 0) + minutes;
    // Zurück auf active falls soft_done
    if (currentState === 'soft_done') {
      states[stepIndex] = 'active';
    }
  }

  // ── Action: log_temperature ───────────────────────────────
  else if (action === 'log_temperature') {
    // Kein State-Wechsel, nur Timestamp-Update
    if (!timestamps[stepIndex]) timestamps[stepIndex] = {};
    timestamps[stepIndex].temperature = parseFloat(extraData.temperature);
  }

  else {
    return { error: `Unbekannte Action: ${action}`, states, timestamps, sideEffects };
  }

  return { states, timestamps, sideEffects, error: null };
}

// ── Soft-Done-Check ─────────────────────────────────────────
// Prüft alle active Warten-Steps ob ihr Timer abgelaufen ist
// und setzt sie auf soft_done. Wird vom checkAndNotify-Intervall aufgerufen.
function checkSoftDone(sections, stepStates, stepTimestamps) {
  const steps = flattenSteps(sections);
  const now = Date.now();
  const states = { ...stepStates };
  const softDoneSteps = [];

  steps.forEach(s => {
    if (states[s.globalIdx] !== 'active') return;
    if (!isWaitStep(s)) return;
    const ts = stepTimestamps[s.globalIdx];
    if (!ts || !ts.timer_end) return;
    if (now >= ts.timer_end) {
      states[s.globalIdx] = 'soft_done';
      softDoneSteps.push(s);
    }
  });

  return { states, softDoneSteps };
}

// ── Zeitprognose berechnen ──────────────────────────────────
// Berechnet den voraussichtlichen Fertigzeitpunkt basierend auf
// tatsächlichen Dauern (done Steps) und geplanten Dauern (offene Steps)
function calculateProjectedEnd(sections, stepStates, stepTimestamps) {
  const steps = flattenSteps(sections);
  const deps = buildDependencyGraph(sections);
  const now = Date.now();

  // Für jede Phase: berechne wann ihr letzter Step fertig sein wird
  const phaseNames = [...new Set(steps.map(s => s.phase))];
  const phaseEndTimes = {};

  phaseNames.forEach(phaseName => {
    const phaseSteps = steps.filter(s => s.phase === phaseName);
    let cursor = now;

    // Wenn die Phase noch locked ist (Gate nicht bestätigt),
    // brauchen wir den erwarteten Zeitpunkt wann die Deps fertig sein werden
    const firstStep = phaseSteps[0];
    if (stepStates[firstStep.globalIdx] === 'locked') {
      const phaseDeps = deps[phaseName] || [];
      if (phaseDeps.length > 0) {
        // Phase startet erst wenn alle Deps done sind
        const depEnds = phaseDeps.map(d => phaseEndTimes[d] || now);
        cursor = Math.max(...depEnds, now);
      }
    }

    phaseSteps.forEach(s => {
      const state = stepStates[s.globalIdx];
      const ts = stepTimestamps[s.globalIdx] || {};
      const durationMs = s.duration * 60000;

      if (state === 'done') {
        cursor = ts.completed_at || cursor;
      } else if (state === 'active' || state === 'soft_done') {
        if (ts.timer_end) {
          cursor = Math.max(ts.timer_end, now);
        } else {
          // Aktions-Step ohne Timer: schätze verbleibende Zeit
          const elapsed = ts.started_at ? now - ts.started_at : 0;
          cursor = now + Math.max(0, durationMs - elapsed);
        }
      } else {
        // locked oder ready: geplante Dauer addieren
        cursor = cursor + durationMs;
      }
    });

    phaseEndTimes[phaseName] = cursor;
  });

  // Der späteste Phase-End ist der projected_end
  const projected = Math.max(...Object.values(phaseEndTimes), now);
  return new Date(projected);
}

// ── Pending Gates berechnen ─────────────────────────────────
// Gibt alle Phasen zurück die bereit zum Freischalten sind
function getPendingGates(sections, stepStates) {
  const steps = flattenSteps(sections);
  const deps = buildDependencyGraph(sections);
  const gates = [];

  const phaseNames = sections.map(s => s.name);
  phaseNames.forEach(phaseName => {
    const phaseDeps = deps[phaseName] || [];
    if (phaseDeps.length === 0) return;

    const targetSteps = steps.filter(s => s.phase === phaseName);
    const allLocked = targetSteps.every(s => stepStates[s.globalIdx] === 'locked');
    if (!allLocked) return;

    const allDepsDone = phaseDeps.every(depPhase => {
      const depSteps = steps.filter(s => s.phase === depPhase);
      return depSteps.every(s => stepStates[s.globalIdx] === 'done');
    });

    if (allDepsDone) {
      gates.push({
        phase: phaseName,
        dependencies: phaseDeps,
        firstStepIdx: targetSteps[0]?.globalIdx,
      });
    }
  });

  return gates;
}

// ── Geplante Startzeitpunkte berechnen ──────────────────────
// Berechnet den Backplan-Startzeitpunkt jedes Steps rückwärts von plannedAt.
// Gibt ein Objekt { globalIdx → ISO-String } zurück.
// Wird von buildUITimeline verwendet um scheduled_start zu befüllen.
function buildScheduledStarts(sections, plannedAt) {
  if (!plannedAt || !sections?.length) return {};
  const target = new Date(plannedAt);
  const phaseNames = sections.map(s => s.name);
  const deps = buildDependencyGraph(sections);
  const sectionMap = Object.fromEntries(sections.map(s => [s.name, s]));
  const endOffsets = {}, startOffsets = {};

  function calcEndOffset(name, visited = new Set()) {
    if (name in endOffsets) return endOffsets[name];
    if (visited.has(name)) return 0;
    visited.add(name);
    const dependents = phaseNames.filter(n => deps[n]?.includes(name));
    endOffsets[name] = dependents.length === 0
      ? 0
      : Math.min(...dependents.map(d => calcStartOffset(d, new Set(visited))));
    return endOffsets[name];
  }

  function calcStartOffset(name, visited = new Set()) {
    if (name in startOffsets) return startOffsets[name];
    const end = calcEndOffset(name, visited);
    const dur = (sectionMap[name]?.steps || []).reduce(
      (sum, s) => sum + (parseInt(s.duration) || 0), 0
    );
    startOffsets[name] = end + dur;
    return startOffsets[name];
  }

  sections.forEach(s => calcStartOffset(s.name));

  const result = {};
  let globalIdx = 0;
  sections.forEach(section => {
    const offset = startOffsets[section.name] || 0;
    const sectionStart = new Date(target.getTime() - offset * 60000);
    let stepMoment = sectionStart.getTime();
    (section.steps || []).forEach(step => {
      result[globalIdx] = new Date(stepMoment).toISOString();
      stepMoment += (parseInt(step.duration) || 0) * 60000;
      globalIdx++;
    });
  });

  return result;
}

// ── Timeline für UI berechnen ───────────────────────────────
// Erzeugt eine Timeline-Struktur für das Frontend.
// scheduled_start: immer der geplante Backplan-Zeitpunkt (aus plannedAt rückwärts).
// start: der tatsächliche Startzeitpunkt (nur für active/done Steps gesetzt).
function buildUITimeline(sections, stepStates, stepTimestamps, plannedAt) {
  const steps = flattenSteps(sections);
  const now = Date.now();

  // Geplante Startzeitpunkte aus dem Backplan (rückwärts von plannedAt)
  const scheduledStarts = buildScheduledStarts(sections, plannedAt);

  return steps.map(s => {
    const state = stepStates[s.globalIdx] || 'locked';
    const ts = stepTimestamps[s.globalIdx] || {};
    let start = null, end = null, remaining = null;

    if (state === 'done') {
      start = ts.started_at ? new Date(ts.started_at).toISOString() : null;
      end = ts.completed_at ? new Date(ts.completed_at).toISOString() : null;
    } else if (state === 'active' || state === 'soft_done') {
      start = ts.started_at ? new Date(ts.started_at).toISOString() : null;
      if (ts.timer_end) {
        end = new Date(ts.timer_end).toISOString();
        remaining = Math.max(0, Math.round((ts.timer_end - now) / 1000));
      }
    }

    return {
      globalIdx: s.globalIdx,
      phase: s.phase,
      instruction: s.instruction,
      type: s.type,
      duration: s.duration,
      duration_min: s.duration_min,
      duration_max: s.duration_max,
      state,
      start,
      scheduled_start: scheduledStarts[s.globalIdx] || null,
      end,
      remaining,
      temperature: ts.temperature || null,
      extended_by: ts.extended_by || 0,
    };
  });
}

module.exports = {
  flattenSteps,
  buildDependencyGraph,
  computeInitialStates,
  performTransition,
  checkSoftDone,
  calculateProjectedEnd,
  getPendingGates,
  buildUITimeline,
  isWaitStep,
  isBakeStep,
  isActionStep,
};