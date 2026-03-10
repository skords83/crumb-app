/**
 * nightWindowPlanner.js
 * Crumb – Nachtfenster-Planungsalgorithmus
 *
 * Berechnet einen optimalen plannedAt-Zeitpunkt so, dass lange Warteschritte
 * ins definierte Nachtfenster fallen.
 *
 * Kompatibel mit dem bestehenden calculateTimeline()-Format in index.js.
 */

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function isInNightWindow(minOfDay, nightStartMin, nightEndMin) {
  if (nightStartMin > nightEndMin) {
    return minOfDay >= nightStartMin || minOfDay <= nightEndMin;
  }
  return minOfDay >= nightStartMin && minOfDay <= nightEndMin;
}

function minOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatTime(date) {
  return date.toTimeString().slice(0, 5);
}

function isPassive(step) {
  return step.type === 'Warten';
}

/**
 * Berechnet Start/End-Offsets analog zur bestehenden calculateTimeline().
 * Damit sind beide Funktionen zeitlich kompatibel.
 */
function calcOffsets(sections) {
  const phaseNames = sections.map(s => s.name);
  const deps = {};

  sections.forEach(section => {
    deps[section.name] = [];
    (section.ingredients || []).forEach(ing => {
      const ingName = (ing.name || '').toLowerCase();
      phaseNames.forEach(otherName => {
        if (otherName !== section.name && ingName.includes(otherName.toLowerCase())) {
          if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
        }
      });
    });
  });

  const sectionMap = Object.fromEntries(sections.map(s => [s.name, s]));
  const endOffsets = {}, startOffsets = {};

  function calcEndOffset(name, visited = new Set()) {
    if (name in endOffsets) return endOffsets[name];
    if (visited.has(name)) return 0;
    visited.add(name);
    const dependents = sections.map(s => s.name).filter(n => deps[n] && deps[n].includes(name));
    endOffsets[name] = dependents.length === 0
      ? 0
      : Math.min(...dependents.map(d => calcStartOffset(d, new Set(visited))));
    return endOffsets[name];
  }

  function calcStartOffset(name, visited = new Set()) {
    if (name in startOffsets) return startOffsets[name];
    const end = calcEndOffset(name, visited);
    const dur = (sectionMap[name].steps || []).reduce((sum, s) => sum + (parseInt(s.duration) || 0), 0);
    startOffsets[name] = end + dur;
    return startOffsets[name];
  }

  sections.forEach(s => calcStartOffset(s.name));
  return { startOffsets, endOffsets };
}

function buildSteps(sections, plannedAt, startOffsets) {
  const target = new Date(plannedAt);
  const steps = [];

  sections.forEach(section => {
    const offset = startOffsets[section.name] || 0;
    const sectionStart = new Date(target.getTime() - offset * 60000);
    let cursor = new Date(sectionStart);

    (section.steps || []).forEach(step => {
      const duration = parseInt(step.duration) || 0;
      const startTime = new Date(cursor);
      const endTime = new Date(cursor.getTime() + duration * 60000);
      steps.push({ section: section.name, step, startTime, endTime });
      cursor = endTime;
    });
  });

  steps.sort((a, b) => a.startTime - b.startTime);
  return steps;
}

function buildResult(steps, plannedAt, warnings, nightStartMin, nightEndMin) {
  const plan = steps.map(item => {
    const startMod = minOfDay(item.startTime);
    const endMod = minOfDay(item.endTime);
    const inNight = item.step.duration > 0 &&
      isInNightWindow(startMod, nightStartMin, nightEndMin) &&
      isInNightWindow(endMod, nightStartMin, nightEndMin);
    const needsAttention = !isPassive(item.step) && isInNightWindow(startMod, nightStartMin, nightEndMin);

    if (needsAttention) {
      warnings.push(`⚠️ Aktionsschritt nachts (${item.section}): "${item.step.instruction.slice(0, 50)}…" um ${formatTime(item.startTime)}`);
    }

    return {
      section: item.section,
      instruction: item.step.instruction,
      type: item.step.type,
      duration: item.step.duration,
      startTime: item.startTime,
      endTime: item.endTime,
      isNightStep: inNight,
      needsAttention,
    };
  });

  const startTime = plan[0]?.startTime ?? plannedAt;
  const viable = !warnings.some(w => w.startsWith('⚠️'));

  return { plannedAt, startTime, plan, warnings, viable };
}

/**
 * Hauptfunktion.
 *
 * @param {Object[]} sections    - dough_sections aus DB / Scraper
 * @param {Object}   nightWindow - { start: "22:00", end: "06:30" }
 * @param {string}   targetTime  - Fertigzeit "HH:MM"
 * @param {Date}     [baseDate]  - Referenzdatum (default: heute)
 *
 * @returns {{
 *   plannedAt:  Date,      ← direkt in DB speicherbar
 *   startTime:  Date,      ← wann der Bäcker anfangen muss
 *   plan:       Object[],  ← annotierte Schritt-Liste
 *   warnings:   string[],
 *   viable:     boolean
 * }}
 */
function planWithNightWindow(sections, nightWindow, targetTime, baseDate = new Date()) {
  const warnings = [];
  const nightStartMin = timeToMinutes(nightWindow.start);
  const nightEndMin   = timeToMinutes(nightWindow.end);
  const nightDurMin   = nightStartMin > nightEndMin
    ? (1440 - nightStartMin) + nightEndMin
    : nightEndMin - nightStartMin;

  const [th, tm] = targetTime.split(':').map(Number);
  const basePlannedAt = new Date(baseDate);
  basePlannedAt.setHours(th, tm, 0, 0);

  const { startOffsets } = calcOffsets(sections);

  // Basis-Plan aufbauen um Kandidaten zu finden
  const baseSteps = buildSteps(sections, basePlannedAt, startOffsets);
  const candidates = baseSteps.filter(s => isPassive(s.step) && s.step.duration >= 180);

  if (candidates.length === 0) {
    warnings.push('Keine langen Warteschritte (≥3h) gefunden – Nachtoptimierung nicht möglich.');
    return buildResult(baseSteps, basePlannedAt, warnings, nightStartMin, nightEndMin);
  }

  // Besten Kandidaten wählen: bevorzuge den Warteschritt der am besten ins Nachtfenster passt.
  // Kriterium: Dauer möglichst nah am Nachtfenster (aber ≤), sonst längster verfügbarer.
  // Bei Gleichstand: früherer Schritt bevorzugt (damit spätere Aktionen tagsüber bleiben).
  const fitsInWindow = candidates.filter(c => c.step.duration <= nightDurMin);
  let candidate;
  if (fitsInWindow.length > 0) {
    // Den längsten der noch ins Fenster passt – aber nicht den letzten im Rezept,
    // sondern den, nach dem die wenigsten Aktionsschritte noch nachts fallen würden.
    // Einfache Heuristik: nimm den letzten der ins Fenster passt.
    candidate = fitsInWindow[fitsInWindow.length - 1];
  } else {
    // Alle Kandidaten länger als Nachtfenster → nimm den kürzesten (kleinste Überschreitung)
    candidate = candidates.reduce((a, b) => a.step.duration < b.step.duration ? a : b);
    warnings.push(
      `"${candidate.step.instruction.slice(0, 50)}…" dauert ${candidate.step.duration} Min – ` +
      `länger als das Nachtfenster (${nightDurMin} Min). Schritt beginnt im Fenster.`
    );
  }

  // Verschiebung berechnen: Kandidat soll um nightEnd enden
  let minutesToShift;
  if (candidate.step.duration > nightDurMin) {
    // Kandidat startet bei nightStart
    minutesToShift = nightStartMin - minOfDay(candidate.startTime);
  } else {
    // Kandidat endet bei nightEnd
    minutesToShift = nightEndMin - minOfDay(candidate.endTime);
  }

  // Besten plannedAt finden: human-friendly Startzeit (06:00–23:00)
  let bestPlannedAt = null;

  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const shift = minutesToShift + dayOffset * 1440;
    const trialPlannedAt = new Date(basePlannedAt.getTime() + shift * 60000);
    const trialSteps = buildSteps(sections, trialPlannedAt, startOffsets);
    const startMod = minOfDay(trialSteps[0]?.startTime ?? trialPlannedAt);

    if (startMod >= 360 && startMod <= 1380) { // 06:00 – 23:00
      bestPlannedAt = trialPlannedAt;
      break;
    }
  }

  if (!bestPlannedAt) {
    bestPlannedAt = new Date(basePlannedAt.getTime() + minutesToShift * 60000);
    warnings.push('Startzeit liegt außerhalb üblicher Zeiten – bitte manuell prüfen.');
  }

  const finalSteps = buildSteps(sections, bestPlannedAt, startOffsets);
  const result = buildResult(finalSteps, bestPlannedAt, warnings, nightStartMin, nightEndMin);

  // Wenn nicht viable: alternativen Plan berechnen der alle Aktionen VOR die Nacht legt.
  // Strategie: letzter Aktionsschritt vor Nacht muss um nightStart fertig sein.
  if (!result.viable) {
    const altResult = calcAlternativePlan(finalSteps, sections, startOffsets, nightStartMin, nightEndMin, nightDurMin);
    if (altResult) result.alternative = altResult;
  }

  return result;
}

/**
 * Alternativer Plan: alle Aktionsschritte enden vor nightStart.
 * Findet den letzten Aktionsschritt der noch vor der Nacht liegen soll,
 * und berechnet rückwärts einen Startpunkt.
 */
function calcAlternativePlan(currentSteps, sections, startOffsets, nightStartMin, nightEndMin, nightDurMin) {
  // Letzter Aktionsschritt im aktuellen Plan der nachts fällt
  const nightActions = currentSteps.filter(s =>
    !isPassive(s.step) && isInNightWindow(minOfDay(s.startTime), nightStartMin, nightEndMin)
  );
  if (nightActions.length === 0) return null;

  // Letzter Aktionsschritt der nachts fällt – dieser soll jetzt vor nightStart enden
  const lastNightAction = nightActions[nightActions.length - 1];

  // Verschiebung: lastNightAction.endTime soll nightStart sein
  const currentEndMod = minOfDay(lastNightAction.endTime);
  let shift = nightStartMin - currentEndMod;

  // Sicherstellen dass Startzeit human-friendly bleibt
  let altPlannedAt = null;
  for (let dayOffset = -1; dayOffset <= 2; dayOffset++) {
    const trialShift = shift + dayOffset * 1440;
    // plannedAt des alternativen Plans = aktuelles plannedAt + trialShift
    const currentPlannedAt = currentSteps[currentSteps.length - 1]?.endTime ?? new Date();
    const trialPlannedAt = new Date(currentPlannedAt.getTime() + trialShift * 60000);
    const trialSteps = buildSteps(sections, trialPlannedAt, startOffsets);
    const startMod = minOfDay(trialSteps[0]?.startTime ?? trialPlannedAt);

    if (startMod >= 360 && startMod <= 1380) {
      altPlannedAt = trialPlannedAt;
      break;
    }
  }

  if (!altPlannedAt) return null;

  const altSteps = buildSteps(sections, altPlannedAt, startOffsets);
  const altPlan = altSteps.map(item => ({
    section: item.section,
    instruction: item.step.instruction,
    type: item.step.type,
    duration: item.step.duration,
    startTime: item.startTime,
    endTime: item.endTime,
    isNightStep: item.step.duration > 0 &&
      isInNightWindow(minOfDay(item.startTime), nightStartMin, nightEndMin) &&
      isInNightWindow(minOfDay(item.endTime), nightStartMin, nightEndMin),
    needsAttention: false,
  }));

  return {
    plannedAt: altPlannedAt,
    startTime: altSteps[0]?.startTime ?? altPlannedAt,
    plan: altPlan,
    description: `Früherer Start: alle Aktionen vor ${minutesToTime(nightStartMin)} Uhr erledigt, Wartezeit läuft über Nacht.`,
  };
}

/** Minuten seit Mitternacht → "HH:MM" */
function minutesToTime(min) {
  const h = Math.floor(min / 60).toString().padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

module.exports = { planWithNightWindow };