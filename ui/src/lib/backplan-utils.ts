// ============================================================
// BACKPLAN UTILS
// Berechnet die Timeline für ein Rezept rückwärts vom Zielzeitpunkt.
//
// Dependency Graph: Wenn eine Phase "gesamte Sauerteigstufe 1" als
// Zutat enthält, wird automatisch erkannt dass sie von "Sauerteigstufe 1"
// abhängt. Kein is_parallel oder start_offset_minutes nötig.
// ============================================================

export interface BackplanStep {
  phase: string;
  instruction: string;
  type: string;
  duration: number;       // Effektive Dauer (Mittelwert bei Zeitfenster)
  duration_min?: number;  // Untere Grenze des Zeitfensters (optional)
  duration_max?: number;  // Obere Grenze des Zeitfensters (optional)
  start: Date;
  end: Date;
  isParallel?: boolean;
  ingredients?: any[];
}

// Berechnet die effektive Dauer eines Steps – Mittelwert bei Zeitfenster
function effectiveDuration(step: any): number {
  const min = parseInt(step.duration_min);
  const max = parseInt(step.duration_max);
  if (!isNaN(min) && !isNaN(max)) return Math.round((min + max) / 2);
  return parseInt(step.duration) || 0;
}

// Parst einen Datums-String korrekt in die lokale Zeitzone.
// - MIT Z-Suffix oder Offset (z.B. "…Z", "…+01:00"): new Date() parst UTC,
//   Browser konvertiert automatisch in Lokalzeit → korrekt.
// - OHNE Suffix (z.B. "2026-03-23T14:00"): manuell als Lokalzeit parsen,
//   da new Date() bei Strings ohne Suffix browser-abhängig ist.
export function parseLocalDate(dateStr: string): Date {
  if (/Z$/.test(dateStr) || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  const [datePart, timePart] = dateStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = (timePart || '00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

// ── Gemeinsame Dependency-Graph-Helfer ──────────────────────────────────────
// Wird von calculateBackplan, calculateDynamicTimeline, calcTotalDuration etc. genutzt.

function buildNormalizePhaseName(): (name: string) => string {
  return (name: string): string =>
    name
      .toLowerCase()
      .replace(/^\d+\.\s*/, '')           // "1. " am Anfang
      .replace(/\bstufe\s+\d+\b/g, '')    // "Stufe 1" irgendwo
      .replace(/\breifer?\b/g, '')         // "reifer" / "reife"
      .replace(/\bfrischer?\b/g, '')       // "frischer" / "frische"
      .replace(/\bfertig[a-z]*\b/g, '')   // "fertiger" etc.
      .replace(/\s+/g, ' ')
      .trim();
}

function buildDependencyGraph(sections: any[], phaseNames: string[]): Record<string, string[]> {
  const normalizePhaseName = buildNormalizePhaseName();
  const deps: Record<string, string[]> = {};
  sections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      const candidates = [ing.name || '', ing.temperature || ''];
      candidates.forEach(candidate => {
        const ingName = normalizePhaseName(candidate);
        phaseNames.forEach(otherName => {
          if (otherName === section.name) return;
          const normOther = normalizePhaseName(otherName);
          if (normOther.length < 4) return;
          const wb = new RegExp('(?:^|\\s)' + normOther.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)');
          if (wb.test(ingName) || ingName === normOther)
            if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
        });
      });
    });
  });
  return deps;
}

// ── calculateBackplan ───────────────────────────────────────────────────────

export function calculateBackplan(targetDate: Date | string, sections: any[]): BackplanStep[] {
  if (!sections || sections.length === 0) return [];
  const target = typeof targetDate === 'string' ? parseLocalDate(targetDate) : targetDate;
  const timeline: BackplanStep[] = [];
  const phaseNames = sections.map((s: any) => s.name as string);

  const deps = buildDependencyGraph(sections, phaseNames);

  const sectionMap: Record<string, any> = Object.fromEntries(sections.map((s: any) => [s.name, s]));
  const endOffsets: Record<string, number> = {};
  const startOffsets: Record<string, number> = {};

  function calcEndOffset(name: string, visited = new Set<string>()): number {
    if (name in endOffsets) return endOffsets[name];
    if (visited.has(name)) return 0;
    visited.add(name);
    const dependents = phaseNames.filter(n => deps[n]?.includes(name));
    endOffsets[name] = dependents.length === 0
      ? 0
      : Math.min(...dependents.map(d => calcStartOffset(d, new Set(visited))));
    return endOffsets[name];
  }

  function calcStartOffset(name: string, visited = new Set<string>()): number {
    if (name in startOffsets) return startOffsets[name];
    const end = calcEndOffset(name, visited);
    const dur = (sectionMap[name]?.steps || []).reduce(
      (sum: number, s: any) => sum + effectiveDuration(s), 0
    );
    startOffsets[name] = end + dur;
    return startOffsets[name];
  }

  phaseNames.forEach(name => calcStartOffset(name));

  sections.forEach((section: any) => {
    const offset = startOffsets[section.name] || 0;
    const sectionStart = new Date(target.getTime() - offset * 60000);
    let stepMoment = new Date(sectionStart.getTime());
    (section.steps || []).forEach((step: any) => {
      const duration = effectiveDuration(step);
      const duration_min = parseInt(step.duration_min) || undefined;
      const duration_max = parseInt(step.duration_max) || undefined;
      const stepStart = new Date(stepMoment.getTime());
      const stepEnd = new Date(stepMoment.getTime() + duration * 60000);
      timeline.push({
        phase: section.name,
        instruction: step.instruction,
        type: step.type || 'Aktion',
        duration,
        duration_min,
        duration_max,
        start: stepStart,
        end: stepEnd,
        isParallel: (endOffsets[section.name] || 0) > 0,
        ingredients: section.ingredients || [],
      });
      stepMoment = stepEnd;
    });
  });

  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
  return timeline;
}

export function formatTimeManual(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// ── calcTotalDuration ───────────────────────────────────────────────────────

export function calcTotalDuration(sections: any[]): number {
  if (!sections?.length) return 0;
  const phaseNames = sections.map((s: any) => s.name as string);
  const deps = buildDependencyGraph(sections, phaseNames);
  const sectionMap = Object.fromEntries(sections.map((s: any) => [s.name, s]));
  const endO: Record<string, number> = {};
  const startO: Record<string, number> = {};
  function calcEnd(name: string, vis = new Set<string>()): number {
    if (name in endO) return endO[name];
    if (vis.has(name)) return 0;
    vis.add(name);
    const deps2 = phaseNames.filter((n: string) => deps[n]?.includes(name));
    endO[name] = deps2.length === 0 ? 0
      : Math.min(...deps2.map((d: string) => calcStart(d, new Set(vis))));
    return endO[name];
  }
  function calcStart(name: string, vis = new Set<string>()): number {
    if (name in startO) return startO[name];
    const dur = (sectionMap[name]?.steps || []).reduce(
      (s: number, st: any) => {
        const min = parseInt(st.duration_min);
        const max = parseInt(st.duration_max);
        return s + (!isNaN(min) && !isNaN(max) ? Math.round((min + max) / 2) : (parseInt(st.duration) || 0));
      }, 0
    );
    startO[name] = calcEnd(name, vis) + dur;
    return startO[name];
  }
  phaseNames.forEach((n: string) => calcStart(n));
  return phaseNames.length ? Math.max(...phaseNames.map((n: string) => startO[n] || 0)) : 0;
}

// ── calcTotalDurationRange ──────────────────────────────────────────────────

export function calcTotalDurationRange(sections: any[]): { min: number; max: number } {
  if (!sections?.length) return { min: 0, max: 0 };
  let hasRange = false;
  sections.forEach((s: any) => {
    (s.steps || []).forEach((st: any) => {
      if (!isNaN(parseInt(st.duration_min)) && !isNaN(parseInt(st.duration_max))) hasRange = true;
    });
  });
  if (!hasRange) {
    const total = calcTotalDuration(sections);
    return { min: total, max: total };
  }
  const calcVariant = (useMax: boolean): number => {
    const phaseNames = sections.map((s: any) => s.name as string);
    const deps = buildDependencyGraph(sections, phaseNames);
    const sectionMap = Object.fromEntries(sections.map((s: any) => [s.name, s]));
    const endO: Record<string, number> = {};
    const startO: Record<string, number> = {};
    const getDur = (st: any): number => {
      const min = parseInt(st.duration_min);
      const max = parseInt(st.duration_max);
      if (!isNaN(min) && !isNaN(max)) return useMax ? max : min;
      return parseInt(st.duration) || 0;
    };
    function calcEnd(name: string, vis = new Set<string>()): number {
      if (name in endO) return endO[name];
      if (vis.has(name)) return 0;
      vis.add(name);
      const deps2 = phaseNames.filter((n: string) => deps[n]?.includes(name));
      endO[name] = deps2.length === 0 ? 0 : Math.min(...deps2.map((d: string) => calcStart(d, new Set(vis))));
      return endO[name];
    }
    function calcStart(name: string, vis = new Set<string>()): number {
      if (name in startO) return startO[name];
      const dur = (sectionMap[name]?.steps || []).reduce((s: number, st: any) => s + getDur(st), 0);
      startO[name] = calcEnd(name, vis) + dur;
      return startO[name];
    }
    phaseNames.forEach((n: string) => calcStart(n));
    return phaseNames.length ? Math.max(...phaseNames.map((n: string) => startO[n] || 0)) : 0;
  };
  return { min: calcVariant(false), max: calcVariant(true) };
}


// ═══════════════════════════════════════════════════════════════
// calculateDynamicTimeline — Neuberechnung wenn Schritte
// früher abgehakt wurden.
//
// Pass 1: Phase-intern (Schritte innerhalb gleicher Phase vorziehen)
// Pass 2: Phasenübergreifend (wenn ALLE Abhängigkeiten einer Phase
//          completed sind, wird die Folgephase vorgezogen)
// ═══════════════════════════════════════════════════════════════

export interface DynamicTimelineResult {
  timeline: BackplanStep[];
  newPlannedAt: Date;
  shifted: boolean;
}

export function calculateDynamicTimeline(
  originalPlannedAt: Date | string,
  sections: any[],
  stepCompletedAt: Record<string, number>,
  recipeId: number | string
): DynamicTimelineResult {
  const base = calculateBackplan(originalPlannedAt, sections);
  if (base.length === 0) {
    const fallback = typeof originalPlannedAt === 'string'
      ? parseLocalDate(originalPlannedAt) : originalPlannedAt;
    return { timeline: base, newPlannedAt: fallback, shifted: false };
  }

  const result: BackplanStep[] = base.map(s => ({
    ...s, start: new Date(s.start), end: new Date(s.end)
  }));

  // ── Dependency Graph ──
  const phaseNames = sections.map((s: any) => s.name as string);
  const deps = buildDependencyGraph(sections, phaseNames);

  // ── Hilfsfunktionen ──
  const uniquePhases = [...new Set(result.map(s => s.phase))];

  const phaseGlobalIndices = (phase: string): number[] =>
    result.map((s, i) => s.phase === phase ? i : -1).filter(i => i >= 0);

  const isPhaseEarlyCompleted = (phase: string): boolean => {
    const indices = phaseGlobalIndices(phase);
    return indices.length > 0 &&
      indices.every(i => !!stepCompletedAt[`${recipeId}-${i}`]);
  };

  const getPhaseCompletedAt = (phase: string): number | null => {
    const indices = phaseGlobalIndices(phase);
    const times = indices
      .map(i => stepCompletedAt[`${recipeId}-${i}`])
      .filter(Boolean);
    return times.length === indices.length ? Math.max(...times) : null;
  };

  // ── Pass 1: Phase-interne Verschiebung ──
  uniquePhases.forEach(phase => {
    const phaseSteps = result
      .map((s, i) => ({ step: s, idx: i }))
      .filter(({ step }) => step.phase === phase);

    let shiftMs = 0;
    phaseSteps.forEach(({ step, idx }) => {
      const key = `${recipeId}-${idx}`;
      const completedAt = stepCompletedAt[key];
      if (completedAt) {
        const originalEnd = base[idx].end.getTime();
        const gain = originalEnd - completedAt;
        shiftMs = Math.max(shiftMs, gain);
        step.end = new Date(completedAt);
      } else if (shiftMs > 0) {
        step.start = new Date(step.start.getTime() - shiftMs);
        step.end = new Date(step.end.getTime() - shiftMs);
      }
    });
  });

  // ── Pass 2: Phasenübergreifende Verschiebung (NEU) ──
  // Iteriert bis stabil (für Kaskaden: Vorteig → Hauptteig → Backen)
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;

    uniquePhases.forEach(phase => {
      const phaseDeps = deps[phase] || [];
      if (phaseDeps.length === 0) return;

      // Alle Abhängigkeiten müssen komplett abgeschlossen sein
      const allDepsCompleted = phaseDeps.every(dep => isPhaseEarlyCompleted(dep));
      if (!allDepsCompleted) return;

      // Frühester möglicher Start = spätester Abschluss aller Abhängigkeiten
      const depCompletionTimes = phaseDeps
        .map(dep => getPhaseCompletedAt(dep))
        .filter((t): t is number => t !== null);
      if (depCompletionTimes.length === 0) return;

      const latestDepCompletion = Math.max(...depCompletionTimes);

      const phaseStepEntries = result
        .map((s, i) => ({ step: s, idx: i }))
        .filter(({ step }) => step.phase === phase);
      if (phaseStepEntries.length === 0) return;

      // Finde den ersten nicht-abgeschlossenen Schritt
      const firstPending = phaseStepEntries.find(
        ({ idx }) => !stepCompletedAt[`${recipeId}-${idx}`]
      );
      if (!firstPending) return;

      const currentPhaseStart = firstPending.step.start.getTime();

      // Nur verschieben wenn die Phase tatsächlich früher starten kann
      if (latestDepCompletion >= currentPhaseStart) return;

      const crossPhaseShift = currentPhaseStart - latestDepCompletion;
      if (crossPhaseShift <= 0) return;

      changed = true;

      // Alle nicht-abgeschlossenen Schritte dieser Phase vorziehen
      phaseStepEntries.forEach(({ step, idx }) => {
        if (!stepCompletedAt[`${recipeId}-${idx}`]) {
          step.start = new Date(step.start.getTime() - crossPhaseShift);
          step.end = new Date(step.end.getTime() - crossPhaseShift);
        }
      });
    });
  }

  // Neu sortieren
  result.sort((a, b) => a.start.getTime() - b.start.getTime());

  const newPlannedAt = new Date(Math.max(...result.map(s => s.end.getTime())));
  const originalEnd = new Date(Math.max(...base.map(s => s.end.getTime())));
  const shifted = newPlannedAt.getTime() < originalEnd.getTime();

  return { timeline: result, newPlannedAt, shifted };
}

// ── Hilfsfunktion für die UI: Erkennt ob parallele Phasen noch offen sind ──
// Wird von backplan/page.tsx genutzt um das Modal anzuzeigen.

export interface PendingParallelInfo {
  completedPhase: string;
  pendingPhases: string[];
  stepIndices: Record<string, number[]>; // phase → globale Indizes der offenen Steps
}

export function findPendingParallelPhases(
  recipeId: number | string,
  stepIdx: number,
  newStepCompletedAt: Record<string, number>,
  sections: any[],
  timeline: BackplanStep[]
): PendingParallelInfo | null {
  const completedStep = timeline[stepIdx];
  if (!completedStep) return null;
  const completedPhase = completedStep.phase;

  // Sind ALLE Schritte dieser Phase jetzt completed?
  const phaseIndices = timeline
    .map((s, i) => s.phase === completedPhase ? i : -1)
    .filter(i => i >= 0);
  const allPhaseCompleted = phaseIndices.every(
    i => !!newStepCompletedAt[`${recipeId}-${i}`]
  );
  if (!allPhaseCompleted) return null;

  // Dependency Graph
  const phaseNames = sections.map((s: any) => s.name as string);
  const deps = buildDependencyGraph(sections, phaseNames);

  // Finde Phasen die von completedPhase abhängen
  const dependentPhases = phaseNames.filter(p => (deps[p] || []).includes(completedPhase));
  if (dependentPhases.length === 0) return null;

  // Für jede Folgephase: welche ANDEREN Abhängigkeiten sind noch nicht completed?
  const pendingPhases: string[] = [];
  const stepIndicesMap: Record<string, number[]> = {};

  dependentPhases.forEach(depPhase => {
    const otherDeps = (deps[depPhase] || []).filter(d => d !== completedPhase);
    otherDeps.forEach(otherDep => {
      const otherIndices = timeline
        .map((s, i) => s.phase === otherDep ? i : -1)
        .filter(i => i >= 0);

      const hasOpenSteps = otherIndices.some(
        i => !newStepCompletedAt[`${recipeId}-${i}`]
      );

      if (hasOpenSteps && !pendingPhases.includes(otherDep)) {
        pendingPhases.push(otherDep);
        stepIndicesMap[otherDep] = otherIndices.filter(
          i => !newStepCompletedAt[`${recipeId}-${i}`]
        );
      }
    });
  });

  if (pendingPhases.length === 0) return null;
  return { completedPhase, pendingPhases, stepIndices: stepIndicesMap };
}