/**
 * nightWindowPlanner.js
 * Crumb – Nachtfenster-Planungsalgorithmus
 *
 * Für jeden langen Warteschritt im Rezept wird berechnet:
 * "Wenn diese Phase um nightStart beginnt – wann muss ich starten,
 *  und fallen dabei Aktionsschritte in die Nacht?"
 *
 * Kompatibel mit calculateTimeline() in index.js.
 */

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
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

function isInNightWindow(mod, nightStartMin, nightEndMin) {
  if (nightStartMin > nightEndMin) return mod >= nightStartMin || mod <= nightEndMin;
  return mod >= nightStartMin && mod <= nightEndMin;
}

// ---------------------------------------------------------------------------
// Offsets (exakt analog calculateTimeline in index.js)
// ---------------------------------------------------------------------------

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
  const steps = [];
  sections.forEach(section => {
    const offset = startOffsets[section.name] || 0;
    let cursor = new Date(plannedAt.getTime() - offset * 60000);
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

// ---------------------------------------------------------------------------
// Kern: einen Kandidaten evaluieren
// ---------------------------------------------------------------------------

/**
 * Berechnet einen Plan bei dem `candidate` um nightStart beginnt.
 * Gibt zurück ob Aktionsschritte in die Nacht fallen.
 */
function evalCandidate(candidate, sections, startOffsets, plannedAt, nightStartMin, nightEndMin) {
  // Wir wollen: candidate.startTime = nightStart
  // Dazu verschieben wir plannedAt so, dass das stimmt.
  // candidate.startTime hängt von plannedAt ab via buildSteps/startOffsets.
  // candidate.startTime = plannedAt - startOffsets[section] - (duration of steps before candidate in section)
  // Einfacher: aktuelle candidate.startTime im Basis-Plan, Verschiebung berechnen.

  const baseSteps = buildSteps(sections, plannedAt, startOffsets);
  const baseCandidate = baseSteps.find(
    s => s.section === candidate.section && s.step.instruction === candidate.step.instruction
  );
  if (!baseCandidate) return null;

  const currentStartMod = minOfDay(baseCandidate.startTime);
  let shift = nightStartMin - currentStartMod;

  // Besten dayOffset finden: Startzeit human-friendly (06:00–23:00)
  let bestPlannedAt = null;
  for (let dayOffset = -1; dayOffset <= 3; dayOffset++) {
    const trialShift = shift + dayOffset * 1440;
    const trialPlannedAt = new Date(plannedAt.getTime() + trialShift * 60000);
    const trialSteps = buildSteps(sections, trialPlannedAt, startOffsets);
    const startMod = minOfDay(trialSteps[0]?.startTime ?? trialPlannedAt);
    if (startMod >= 360 && startMod <= 1380) {
      bestPlannedAt = trialPlannedAt;
      break;
    }
  }
  if (!bestPlannedAt) {
    // Fallback ohne human-friendly check
    bestPlannedAt = new Date(plannedAt.getTime() + shift * 60000);
  }

  const finalSteps = buildSteps(sections, bestPlannedAt, startOffsets);

  // Nacht-Kandidat im finalen Plan
  const nightStep = finalSteps.find(
    s => s.section === candidate.section && s.step.instruction === candidate.step.instruction
  );

  // Aktionsschritte die in die Nacht fallen (außer dem Kandidaten selbst)
  const nightActions = finalSteps.filter(s =>
    s !== nightStep &&
    !isPassive(s.step) &&
    isInNightWindow(minOfDay(s.startTime), nightStartMin, nightEndMin)
  );

  const plan = finalSteps.map(item => {
    const startMod = minOfDay(item.startTime);
    const endMod = minOfDay(item.endTime);
    const isNightStep = item.step.duration > 0 &&
      isInNightWindow(startMod, nightStartMin, nightEndMin) &&
      isInNightWindow(endMod, nightStartMin, nightEndMin);
    const needsAttention = !isPassive(item.step) &&
      isInNightWindow(startMod, nightStartMin, nightEndMin);

    return {
      section: item.section,
      instruction: item.step.instruction,
      type: item.step.type,
      duration: item.step.duration,
      startTime: item.startTime,
      endTime: item.endTime,
      isNightStep,
      needsAttention,
    };
  });

  return {
    candidateSection: candidate.section,
    candidateInstruction: candidate.step.instruction,
    candidateDuration: candidate.step.duration,
    nightStart: nightStep ? formatTime(nightStep.startTime) : minutesToTime(nightStartMin),
    nightEnd: nightStep ? formatTime(nightStep.endTime) : '?',
    plannedAt: bestPlannedAt,
    startTime: finalSteps[0]?.startTime ?? bestPlannedAt,
    plan,
    viable: nightActions.length === 0,
    nightActionWarnings: nightActions.map(s =>
      `⚠️ ${s.section}: "${s.step.instruction.slice(0, 50)}…" um ${formatTime(s.startTime)}`
    ),
  };
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

/**
 * Evaluiert alle langen Warteschritte als Nacht-Kandidaten.
 *
 * @param {Object[]} sections
 * @param {Object}   nightWindow  - { start: "22:00", end: "06:30" }
 * @param {string}   targetTime   - Fertigzeit "HH:MM"
 * @param {Date}     [baseDate]
 *
 * @returns {{
 *   options: Array<{
 *     candidateSection: string,
 *     candidateInstruction: string,
 *     candidateDuration: number,
 *     nightStart: string,
 *     nightEnd: string,
 *     plannedAt: Date,
 *     startTime: Date,
 *     plan: Object[],
 *     viable: boolean,
 *     nightActionWarnings: string[],
 *   }>,
 *   hasViable: boolean,
 * }}
 */
function planWithNightWindow(sections, nightWindow, targetTime, baseDate = new Date()) {
  const nightStartMin = timeToMinutes(nightWindow.start);
  const nightEndMin   = timeToMinutes(nightWindow.end);

  const [th, tm] = targetTime.split(':').map(Number);
  const basePlannedAt = new Date(baseDate);
  basePlannedAt.setHours(th, tm, 0, 0);

  const { startOffsets } = calcOffsets(sections);
  const baseSteps = buildSteps(sections, basePlannedAt, startOffsets);

  // Alle langen Warteschritte als Kandidaten
  const candidates = baseSteps.filter(s => isPassive(s.step) && s.step.duration >= 180);

  if (candidates.length === 0) {
    return { options: [], hasViable: false, noNightSteps: true };
  }

  const options = candidates.map(c =>
    evalCandidate(c, sections, startOffsets, basePlannedAt, nightStartMin, nightEndMin)
  ).filter(Boolean);

  // Duplikate entfernen (gleicher Startpunkt)
  const seen = new Set();
  const unique = options.filter(o => {
    const key = o.plannedAt.toISOString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sortierung: viable zuerst, dann nach startTime
  unique.sort((a, b) => {
    if (a.viable !== b.viable) return a.viable ? -1 : 1;
    return a.startTime - b.startTime;
  });

  return {
    options: unique,
    hasViable: unique.some(o => o.viable),
  };
}

module.exports = { planWithNightWindow };

// ---------------------------------------------------------------------------
// CLI-Test
// ---------------------------------------------------------------------------
if (require.main === module) {
  const sections = [
    { name: '1. Stufe Anfrischsauer', ingredients: [],
      steps: [
        { instruction: 'Anstellgut im Wasser auflösen.', duration: 5, type: 'Kneten' },
        { instruction: 'Reifezeit 3 Stunden.', duration: 180, type: 'Warten' },
      ]},
    { name: '2. Stufe Grundsauer', ingredients: [{ name: 'reifer Anfrischsauer' }],
      steps: [
        { instruction: 'Anfrischsauer im Wasser auflösen.', duration: 5, type: 'Kneten' },
        { instruction: 'Reifezeit 8-10 Stunden.', duration: 540, type: 'Warten' },
      ]},
    { name: '3. Stufe Vollsauer', ingredients: [{ name: 'reifer Grundsauer' }],
      steps: [
        { instruction: 'Grundsauerteig im Wasser auflösen.', duration: 5, type: 'Kneten' },
        { instruction: 'Reifezeit 3 Stunden.', duration: 180, type: 'Warten' },
      ]},
    { name: 'Brotaroma', ingredients: [],
      steps: [
        { instruction: 'Weiches Restbrot pürieren.', duration: 5, type: 'Kneten' },
      ]},
    { name: 'Hauptteig', ingredients: [{ name: 'reifer Vollsauer' }, { name: 'eingeweichtes Brotaroma' }],
      steps: [
        { instruction: 'Zutaten 6 Min mischen.', duration: 6, type: 'Kneten' },
        { instruction: 'Teig 15-20 Min reifen lassen.', duration: 18, type: 'Warten' },
        { instruction: 'Teig formen.', duration: 5, type: 'Kneten' },
        { instruction: 'In Gärkörbchen legen.', duration: 5, type: 'Kneten' },
        { instruction: 'Endgare 50-60 Min.', duration: 55, type: 'Warten' },
        { instruction: 'Bei 250°C einschießen.', duration: 7, type: 'Backen' },
        { instruction: 'Ofentüre öffnen.', duration: 3, type: 'Kneten' },
        { instruction: 'Auf 195°C reduzieren, 55 Min backen.', duration: 55, type: 'Backen' },
      ]},
  ];

  const result = planWithNightWindow(sections, { start: '22:00', end: '06:30' }, '10:00', new Date('2026-03-11'));
  console.log(`hasViable: ${result.hasViable}, Optionen: ${result.options.length}\n`);

  result.options.forEach((o, i) => {
    console.log(`--- Option ${i + 1}: [${o.candidateSection}] "${o.candidateInstruction.slice(0, 40)}" (${o.candidateDuration} min)`);
    console.log(`    Start: ${o.startTime.toTimeString().slice(0,5)}  Nacht: ${o.nightStart}–${o.nightEnd}  viable: ${o.viable}`);
    if (o.nightActionWarnings.length) o.nightActionWarnings.forEach(w => console.log('   ', w));
    console.log();
  });
}