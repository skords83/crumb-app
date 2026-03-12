/**
 * nightWindowPlanner.js
 * Crumb – Nachtfenster-Planungsalgorithmus
 *
 * Logik:
 * - Baue den Zeitstrahl mit plannedAt = nightStart (letzte Aktion endet um nightStart)
 * - Finde alle Aktionsschritte und prüfe für jeden:
 *   wenn DIESE Aktion um nightStart endet → kommt die nächste erst nach nightEnd?
 * - Wähle den ersten passenden Kandidaten bei dem auch der Start in der Zukunft liegt
 */

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(date) {
  return date.toTimeString().slice(0, 5);
}

function isActive(step) {
  return step.type !== 'Warten';
}

// ---------------------------------------------------------------------------
// Offsets (analog calculateTimeline in index.js)
// ---------------------------------------------------------------------------
function normalizePhaseName(name) {
  return (name || '').toLowerCase()
    .replace(/^\d+\.\s*stufe\s*/i, '')
    .replace(/^stufe\s*/i, '')
    .replace(/reifer?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function calcOffsets(sections) {
  const phaseNames = sections.map(s => s.name);
  const deps = {};
  sections.forEach(section => {
    deps[section.name] = [];
    (section.ingredients || []).forEach(ing => {
      const ingName = (ing.name || '').toLowerCase();
      const ingNameNorm = normalizePhaseName(ing.name || '');
      phaseNames.forEach(otherName => {
        if (otherName !== section.name) {
          const otherNorm = normalizePhaseName(otherName);
          if (ingName.includes(otherName.toLowerCase()) || 
              (otherNorm.length > 3 && ingName.includes(otherNorm)) ||
              (otherNorm.length > 3 && ingNameNorm.includes(otherNorm))) {
            if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
          }
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
      ? 0 : Math.min(...dependents.map(d => calcStartOffset(d, new Set(visited))));
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
      steps.push({ section: section.name, step, startTime: new Date(cursor), endTime: new Date(cursor.getTime() + duration * 60000) });
      cursor = new Date(cursor.getTime() + duration * 60000);
    });
  });
  steps.sort((a, b) => a.startTime - b.startTime);
  return steps;
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------
function planWithNightWindow(sections, nightWindow, baseDate = new Date()) {
  const nightStartMin = timeToMinutes(nightWindow.start);
  const nightEndMin   = timeToMinutes(nightWindow.end);
  const nightDuration = nightStartMin > nightEndMin
    ? (1440 - nightStartMin) + nightEndMin
    : nightEndMin - nightStartMin;

  const { startOffsets } = calcOffsets(sections);
  const now = baseDate;

  // Ankerpunkt: baseDate @ nightStart
  const anchorDate = new Date(baseDate);
  anchorDate.setHours(Math.floor(nightStartMin / 60), nightStartMin % 60, 0, 0);

  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    // targetNightStart = der nightStart dieses Tages
    const targetNightStart = new Date(anchorDate.getTime() + dayOffset * 1440 * 60000);
    const targetNightEnd   = new Date(targetNightStart.getTime() + nightDuration * 60000);

    // Baue Zeitstrahl mit plannedAt = targetNightStart
    // (= das Rezeptende liegt bei nightStart wenn keine Offset-Verschiebung)
    const baseSteps = buildSteps(sections, targetNightStart, startOffsets);
    const actionSteps = baseSteps.filter(s => isActive(s.step));

    // Für jeden Aktionsschritt testen: wenn DIESER als letzter vor der Nacht läuft
    for (let i = 0; i < actionSteps.length; i++) {
      const candidate = actionSteps[i];
      const nextAction = actionSteps[i + 1]; // kann undefined sein (letzter Schritt)

      // Verschiebe Plan so dass candidate.endTime = targetNightStart
      const shiftMs = targetNightStart - candidate.endTime;
      const shiftedPlannedAt = new Date(targetNightStart.getTime() + shiftMs);
      const trialSteps = buildSteps(sections, shiftedPlannedAt, startOffsets);
      const trialActions = trialSteps.filter(s => isActive(s.step));

      // Startzeit muss in der Zukunft liegen
      const trialStart = trialSteps[0]?.startTime;
      if (!trialStart || trialStart <= now) continue;

      // Prüfe: keine Aktion zwischen nightStart und nightEnd
      const hasNightAction = trialActions.some(s =>
        s.startTime < targetNightEnd && s.endTime > targetNightStart
      );
      if (hasNightAction) continue;

      // Prüfe: die erste Aktion nach nightStart beginnt ≥ nightEnd
      const actionsAfter = trialActions.filter(s => s.startTime >= targetNightStart);
      if (actionsAfter.length > 0 && actionsAfter[0].startTime < targetNightEnd) continue;

      // Prüfe: Planende darf nicht in der Nachtphase liegen (z.B. Backen um 01:00)
      const planEnd = trialSteps[trialSteps.length - 1]?.endTime;
      if (planEnd && planEnd > targetNightStart && planEnd < targetNightEnd) continue;

      // Erfolg!
      const actionsBefore = trialActions.filter(s => s.endTime <= targetNightStart);
      const lastBefore = actionsBefore[actionsBefore.length - 1];
      const firstAfter = actionsAfter[0];

      const plan = trialSteps.map(item => ({
        phase:       item.section,
        instruction: item.step.instruction,
        type:        item.step.type,
        duration:    item.step.duration,
        start:       item.startTime,
        end:         item.endTime,
        isNightStep: item.startTime >= targetNightStart && item.endTime <= targetNightEnd,
      }));

      return {
        viable:           true,
        startTime:        trialSteps[0].startTime,
        endTime:          trialSteps[trialSteps.length - 1].endTime,
        lastActionBefore: lastBefore ? formatTime(lastBefore.endTime) : nightWindow.start,
        firstActionAfter: firstAfter ? formatTime(firstAfter.startTime) : nightWindow.end,
        plan,
        fallbackStartTime: null,
        fallbackEndTime:   null,
      };
    }
  }

  // Fallback
  const totalDuration = sections.reduce((sum, s) =>
    sum + (s.steps || []).reduce((s2, step) => s2 + (parseInt(step.duration) || 0), 0), 0);

  let fallbackEndAt   = new Date(anchorDate);
  let fallbackStartAt = new Date(fallbackEndAt.getTime() - totalDuration * 60000);
  if (fallbackStartAt <= now) {
    fallbackEndAt   = new Date(anchorDate.getTime() + 1440 * 60000);
    fallbackStartAt = new Date(fallbackEndAt.getTime() - totalDuration * 60000);
  }

  return {
    viable: false, startTime: null, endTime: null,
    lastActionBefore: null, firstActionAfter: null, plan: [],
    fallbackStartTime: fallbackStartAt, fallbackEndTime: fallbackEndAt,
  };
}

module.exports = { planWithNightWindow };

// CLI-Test
if (require.main === module) {
  const now = new Date(); now.setHours(14, 0, 0, 0);
  const nightWindow = { start: '22:00', end: '06:30' };

  const roggenmisch = [
    { name: '1. Stufe Anfrischsauer', ingredients: [],
      steps: [{ instruction: 'Anstellgut auflösen.', duration: 5, type: 'Kneten' }, { instruction: 'Reifezeit 3h.', duration: 180, type: 'Warten' }]},
    { name: '2. Stufe Grundsauer', ingredients: [{ name: 'reifer Anfrischsauer' }],
      steps: [{ instruction: 'Grundsauer ansetzen.', duration: 5, type: 'Kneten' }, { instruction: 'Reifezeit 9h.', duration: 540, type: 'Warten' }]},
    { name: '3. Stufe Vollsauer', ingredients: [{ name: 'reifer Grundsauer' }],
      steps: [{ instruction: 'Vollsauer ansetzen.', duration: 5, type: 'Kneten' }, { instruction: 'Reifezeit 3h.', duration: 180, type: 'Warten' }]},
    { name: 'Brotaroma', ingredients: [],
      steps: [{ instruction: 'Restbrot pürieren.', duration: 5, type: 'Kneten' }]},
    { name: 'Hauptteig', ingredients: [{ name: 'reifer Vollsauer' }, { name: 'eingeweichtes Brotaroma' }],
      steps: [
        { instruction: 'Kneten.', duration: 6, type: 'Kneten' },
        { instruction: 'Reifen.', duration: 18, type: 'Warten' },
        { instruction: 'Formen.', duration: 5, type: 'Kneten' },
        { instruction: 'Einlegen.', duration: 5, type: 'Kneten' },
        { instruction: 'Endgare.', duration: 55, type: 'Warten' },
        { instruction: 'Backen.', duration: 7, type: 'Backen' },
        { instruction: 'Ofentüre.', duration: 3, type: 'Kneten' },
        { instruction: 'Ausbacken.', duration: 55, type: 'Backen' },
      ]},
  ];

  const hafer = [
    { name: 'Brühstück', ingredients: [],
      steps: [{ instruction: 'Übergießen.', duration: 5, type: 'Kneten' }, { instruction: '12h quellen.', duration: 720, type: 'Warten' }]},
    { name: 'Hauptteig', ingredients: [{ name: 'gesamtes Brühstück' }],
      steps: [{ instruction: 'Mischen.', duration: 15, type: 'Kneten' }, { instruction: '1h Stückgare.', duration: 60, type: 'Warten' }, { instruction: 'Backen.', duration: 75, type: 'Backen' }]},
  ];

  for (const [name, recipe] of [['ROGGENMISCHBROT', roggenmisch], ['HAFERFLOCKENBROT', hafer]]) {
    console.log('===', name, '===');
    const r = planWithNightWindow(recipe, nightWindow, now);
    console.log('viable:', r.viable);
    if (r.viable) {
      console.log('Start:', r.startTime.toLocaleString('de-AT'));
      console.log('Letzte Aktion vor Nacht:', r.lastActionBefore);
      console.log('Erste Aktion nach Nacht:', r.firstActionAfter);
      console.log('Fertig:', r.endTime.toLocaleString('de-AT'));
    } else {
      console.log('Fallback Start:', r.fallbackStartTime.toLocaleString('de-AT'));
      console.log('Fallback Fertig:', r.fallbackEndTime.toLocaleString('de-AT'));
    }
    console.log('');
  }
}