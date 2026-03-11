/**
 * nightWindowPlanner.js
 * Crumb – Nachtfenster-Planungsalgorithmus
 *
 * Logik:
 * - Suche eine lange Wartephase die komplett ins Nachtfenster passt
 * - Kein Aktionsschritt darf zwischen nightStart und nightEnd fallen
 *   (weder in der Nachtphase selbst noch in parallel laufenden Phasen)
 * - Keine Endzeit-Eingabe – das Brot ist fertig wann es fertig ist
 * - Wenn nicht möglich: Rückwärtsberechnung von nightStart als Zielzeit
 */

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
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
// Prüfe ob ein Plan komplett nachtfenster-kompatibel ist
// ---------------------------------------------------------------------------

function hasNightActions(steps, nightStartMin, nightEndMin) {
  return steps.some(s =>
    !isPassive(s.step) &&
    isInNightWindow(minOfDay(s.startTime), nightStartMin, nightEndMin)
  );
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

/**
 * @param {Object[]} sections
 * @param {Object}   nightWindow  - { start: "22:00", end: "06:30" }
 * @param {Date}     [baseDate]   - Referenzdatum (default: heute)
 *
 * @returns {{
 *   viable: boolean,
 *   startTime: Date,       // wann der Bäcker anfangen muss
 *   endTime: Date,         // wann das Brot fertig ist
 *   nightPhase: string,    // welche Phase nachts läuft (nur wenn viable)
 *   nightStart: string,    // "HH:MM" wann die Nachtphase beginnt
 *   nightEnd: string,      // "HH:MM" wann die Nachtphase endet
 *   plan: Object[],        // annotierte Schritt-Liste
 *   fallbackStartTime: Date|null,  // wenn nicht viable: Start damit fertig um nightStart
 *   fallbackEndTime: Date|null,
 * }}
 */
function planWithNightWindow(sections, nightWindow, baseDate = new Date()) {
  const nightStartMin = timeToMinutes(nightWindow.start);
  const nightEndMin   = timeToMinutes(nightWindow.end);

  const { startOffsets } = calcOffsets(sections);

  // Wir brauchen einen Referenz-plannedAt um Schritte zu bauen.
  // Wir nutzen baseDate + nightStart als ersten Ankerpunkt.
  const anchorDate = new Date(baseDate);
  anchorDate.setHours(Math.floor(nightStartMin / 60), nightStartMin % 60, 0, 0);

  const baseSteps = buildSteps(sections, anchorDate, startOffsets);

  // Alle langen Warteschritte als Kandidaten (≥ 3h)
  const candidates = baseSteps.filter(s => isPassive(s.step) && s.step.duration >= 180);

  // Jeden Kandidaten testen: Kandidat startet genau um nightStart
  for (const candidate of candidates) {
    // Verschiebung berechnen damit candidate.startTime = nightStart
    const currentStartMod = minOfDay(candidate.startTime);
    let shift = nightStartMin - currentStartMod;

    // Versuche mit dayOffset 0 und +1
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      const totalShift = shift + dayOffset * 1440;
      const trialPlannedAt = new Date(anchorDate.getTime() + totalShift * 60000);
      const trialSteps = buildSteps(sections, trialPlannedAt, startOffsets);

      // Prüfe: kein Aktionsschritt im Nachtfenster
      if (!hasNightActions(trialSteps, nightStartMin, nightEndMin)) {
        // Startzeit human-friendly? (06:00–23:00)
        const startMod = minOfDay(trialSteps[0].startTime);
        if (startMod < 360 || startMod > 1380) continue;

        // Nachtphase im Plan finden
        const nightStep = trialSteps.find(
          s => s.section === candidate.section &&
               s.step.instruction === candidate.step.instruction
        );

        const plan = trialSteps.map(item => ({
          section:     item.section,
          instruction: item.step.instruction,
          type:        item.step.type,
          duration:    item.step.duration,
          startTime:   item.startTime,
          endTime:     item.endTime,
          isNightStep: item.step.duration > 0 &&
            isInNightWindow(minOfDay(item.startTime), nightStartMin, nightEndMin) &&
            isInNightWindow(minOfDay(item.endTime), nightStartMin, nightEndMin),
        }));

        return {
          viable:      true,
          startTime:   trialSteps[0].startTime,
          endTime:     trialSteps[trialSteps.length - 1].endTime,
          nightPhase:  candidate.section,
          nightStart:  nightStep ? formatTime(nightStep.startTime) : nightWindow.start,
          nightEnd:    nightStep ? formatTime(nightStep.endTime) : '?',
          plan,
          fallbackStartTime: null,
          fallbackEndTime:   null,
        };
      }
    }
  }

  // Kein vibler Plan gefunden → Fallback: fertig um nightStart
  // "Wenn du um 22:00 fertig sein willst, musst du um X Uhr anfangen"
  const fallbackPlannedAt = new Date(anchorDate);
  // plannedAt = nightStart → startTime = nightStart - totalDuration
  const fallbackSteps = buildSteps(sections, fallbackPlannedAt, startOffsets);
  const fallbackStart = fallbackSteps[0]?.startTime ?? fallbackPlannedAt;

  // Sicherstellen dass fallback startTime am selben oder vorherigen Tag liegt
  const fallbackPlan = fallbackSteps.map(item => ({
    section:     item.section,
    instruction: item.step.instruction,
    type:        item.step.type,
    duration:    item.step.duration,
    startTime:   item.startTime,
    endTime:     item.endTime,
    isNightStep: false,
  }));

  return {
    viable:            false,
    startTime:         null,
    endTime:           null,
    nightPhase:        null,
    nightStart:        null,
    nightEnd:          null,
    plan:              [],
    fallbackStartTime: fallbackStart,
    fallbackEndTime:   fallbackPlannedAt,
  };
}

module.exports = { planWithNightWindow };

// ---------------------------------------------------------------------------
// CLI-Test
// ---------------------------------------------------------------------------
if (require.main === module) {
  const roggenmisch = [
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
      steps: [{ instruction: 'Restbrot pürieren.', duration: 5, type: 'Kneten' }]},
    { name: 'Hauptteig', ingredients: [{ name: 'reifer Vollsauer' }, { name: 'eingeweichtes Brotaroma' }],
      steps: [
        { instruction: 'Zutaten mischen.', duration: 6, type: 'Kneten' },
        { instruction: 'Teig reifen lassen.', duration: 18, type: 'Warten' },
        { instruction: 'Formen.', duration: 5, type: 'Kneten' },
        { instruction: 'In Gärkörbchen legen.', duration: 5, type: 'Kneten' },
        { instruction: 'Endgare.', duration: 55, type: 'Warten' },
        { instruction: 'Backen 250°C.', duration: 7, type: 'Backen' },
        { instruction: 'Ofentüre öffnen.', duration: 3, type: 'Kneten' },
        { instruction: 'Auf 195°C, 55 Min backen.', duration: 55, type: 'Backen' },
      ]},
  ];

  const haferflockenbrot = [
    { name: 'Hafersauerteig', ingredients: [],
      steps: [
        { instruction: 'Vermischen.', duration: 5, type: 'Kneten' },
        { instruction: '12 Stunden reifen lassen.', duration: 720, type: 'Warten' },
      ]},
    { name: 'Brühstück', ingredients: [],
      steps: [
        { instruction: 'Übergießen und vermischen.', duration: 5, type: 'Kneten' },
        { instruction: '12 Stunden quellen lassen.', duration: 720, type: 'Warten' },
      ]},
    { name: 'Hauptteig', ingredients: [{ name: 'gesamter Hafersauerteig' }, { name: 'gesamtes Brühstück' }],
      steps: [
        { instruction: 'Teig mischen.', duration: 15, type: 'Kneten' },
        { instruction: 'Stückgare 1h.', duration: 60, type: 'Warten' },
        { instruction: 'Backen 75 min.', duration: 75, type: 'Backen' },
      ]},
  ];

  console.log('=== ROGGENMISCHBROT ===');
  const r1 = planWithNightWindow(roggenmisch, { start: '22:00', end: '06:30' });
  console.log('viable:', r1.viable);
  if (r1.viable) {
    console.log('Start:', r1.startTime.toTimeString().slice(0,5));
    console.log('Fertig:', r1.endTime.toTimeString().slice(0,5));
    console.log('Nachtphase:', r1.nightPhase, r1.nightStart, '–', r1.nightEnd);
  } else {
    console.log('Fallback Start:', r1.fallbackStartTime.toTimeString().slice(0,5));
    console.log('Fallback Fertig (= 22:00):', r1.fallbackEndTime.toTimeString().slice(0,5));
  }

  console.log('\n=== HAFERFLOCKENBROT ===');
  const r2 = planWithNightWindow(haferflockenbrot, { start: '22:00', end: '06:30' });
  console.log('viable:', r2.viable);
  if (r2.viable) {
    console.log('Start:', r2.startTime.toTimeString().slice(0,5));
    console.log('Fertig:', r2.endTime.toTimeString().slice(0,5));
    console.log('Nachtphase:', r2.nightPhase, r2.nightStart, '–', r2.nightEnd);
  }
}