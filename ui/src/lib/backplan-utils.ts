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

export function calculateBackplan(targetDate: Date | string, sections: any[]): BackplanStep[] {
  if (!sections || sections.length === 0) return [];
  const target = new Date(typeof targetDate === 'string' ? targetDate : targetDate.getTime());
  const timeline: BackplanStep[] = [];
  const phaseNames = sections.map((s: any) => s.name as string);

  // Dependency Graph aufbauen
  // Matcht auch wenn der Phasename nummeriert ist ("1. Stufe Anfrischsauer")
  // und die Zutat nur den Kern-Begriff enthält ("reifer Anfrischsauer").
  // Strategie: Phasename normalisieren → Ziffern/Stufenpräfixe entfernen,
  // dann prüfen ob der normalisierte Kern in der Zutat vorkommt.
  const normalizePhaseName = (name: string): string =>
    name
      .toLowerCase()
      .replace(/^\d+\.\s*/, '')           // "1. " am Anfang
      .replace(/\bstufe\s+\d+\b/g, '')    // "Stufe 1" irgendwo
      .replace(/\breifer?\b/g, '')         // "reifer" / "reife"
      .replace(/\bfrischer?\b/g, '')       // "frischer" / "frische"
      .replace(/\bfertig[a-z]*\b/g, '')   // "fertiger" etc.
      .replace(/\s+/g, ' ')
      .trim();

  const deps: Record<string, string[]> = {};
  sections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      // Check both name and temperature — some scrapers store phase refs in temperature field
      const candidates = [ing.name || '', ing.temperature || ''];
      candidates.forEach(candidate => {
        const ingName = normalizePhaseName(candidate);
        phaseNames.forEach(otherName => {
          if (otherName === section.name) return;
          const normOther = normalizePhaseName(otherName);
          if (normOther.length < 4) return;
          // Word-boundary: avoid "vorteig" matching inside "roggensauerteig"
          const wb = new RegExp('(?:^|\\s)' + normOther.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)');
          if (wb.test(ingName) || ingName === normOther)
            if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
        });
      });
    });
  });

  const sectionMap: Record<string, any> = Object.fromEntries(sections.map((s: any) => [s.name, s]));
  const endOffsets: Record<string, number> = {};
  const startOffsets: Record<string, number> = {};

  function calcEndOffset(name: string, visited = new Set<string>()): number {
    if (name in endOffsets) return endOffsets[name];
    if (visited.has(name)) return 0;
    visited.add(name);
    const dependents = phaseNames.filter(n => deps[n]?.includes(name));
    endOffsets[name] = dependents.length === 0 ? 0
      : Math.min(...dependents.map(d => calcStartOffset(d, new Set(visited))));
    return endOffsets[name];
  }

  function calcStartOffset(name: string, visited = new Set<string>()): number {
    if (name in startOffsets) return startOffsets[name];
    const end = calcEndOffset(name, visited);
    const dur = (sectionMap[name]?.steps || []).reduce(
      (sum: number, s: any) => sum + effectiveDuration(s), 0
    );
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

// Berechnet Gesamtdauer via Dependency Graph – verwendbar in PlanModal, RecipeCard, RecipeDetail
export function calcTotalDuration(sections: any[]): number {
  if (!sections?.length) return 0;
  const phaseNames = sections.map((s: any) => s.name as string);
  const normalizePhaseName = (name: string): string =>
    name
      .toLowerCase()
      .replace(/^\d+\.\s*/, '')
      .replace(/\bstufe\s+\d+\b/g, '')
      .replace(/\breifer?\b/g, '')
      .replace(/\bfrischer?\b/g, '')
      .replace(/\bfertig[a-z]*\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const deps: Record<string, string[]> = {};
  sections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      const candidates = [ing.name || '', ing.temperature || ''];
      candidates.forEach(candidate => {
        const ingName = normalizePhaseName(candidate);
        phaseNames.forEach((otherName: string) => {
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
// Gibt { min, max } zurück wenn mindestens ein Step ein Zeitfenster hat,
// sonst { min: total, max: total } für feste Dauer
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
  // Min-Summe und Max-Summe separat berechnen (vereinfacht: gleiche Dependency-Logik)
  const calcVariant = (useMax: boolean): number => {
    const phaseNames = sections.map((s: any) => s.name as string);
    const normalizePhaseName = (name: string): string =>
      name.toLowerCase().replace(/^\d+\.\s*/, '').replace(/\bstufe\s+\d+\b/g, '')
        .replace(/\breifer?\b/g, '').replace(/\bfrischer?\b/g, '')
        .replace(/\bfertig[a-z]*\b/g, '').replace(/\s+/g, ' ').trim();
    const deps: Record<string, string[]> = {};
    sections.forEach((section: any) => {
      deps[section.name] = [];
      (section.ingredients || []).forEach((ing: any) => {
        const candidates = [ing.name || '', ing.temperature || ''];
        candidates.forEach(candidate => {
          const ingName = normalizePhaseName(candidate);
          phaseNames.forEach((otherName: string) => {
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


// Neuberechnung wenn Schritte früher abgehakt wurden.
// stepCompletedAt: { "recipeId-stepIndex": timestampMs }
// Abgeschlossene Schritte dienen als Ankerpunkte; alle Folge-
// schritte werden vorwärts ab dem tatsächlichen Abschluss-
// zeitpunkt neu berechnet. Parallele Phasen werden unabhängig
// behandelt — nur Schritte nach dem Ankerpunkt verschieben sich.
// ============================================================

export interface DynamicTimelineResult {
  timeline: BackplanStep[];
  newPlannedAt: Date;          // neuer voraussichtlicher Fertigzeitpunkt
  shifted: boolean;            // hat sich etwas gegenüber der Originalplanung verschoben?
}

export function calculateDynamicTimeline(
  originalPlannedAt: Date | string,
  sections: any[],
  stepCompletedAt: Record<string, number>, // key: "recipeId-stepIdx" oder "stepIdx"
  recipeId: number | string
): DynamicTimelineResult {
  // Basis-Timeline (rückwärts berechnet, unveränderter Plan)
  const base = calculateBackplan(originalPlannedAt, sections);
  if (base.length === 0) return { timeline: base, newPlannedAt: new Date(originalPlannedAt), shifted: false };

  // Kopie zum Anpassen
  const result: BackplanStep[] = base.map(s => ({ ...s, start: new Date(s.start), end: new Date(s.end) }));

  // Für jede Phase unabhängig: prüfen ob ein Schritt früher abgehakt wurde
  // und alle Folgeschritte dieser Phase nach vorne verschieben.
  const phaseNames = [...new Set(result.map(s => s.phase))];

  phaseNames.forEach(phase => {
    const phaseSteps = result
      .map((s, i) => ({ step: s, idx: i }))
      .filter(({ step }) => step.phase === phase);

    let shiftMs = 0;

    phaseSteps.forEach(({ step, idx }, localIdx) => {
      const key = `${recipeId}-${idx}`;
      const completedAt = stepCompletedAt[key];

      if (completedAt) {
        // Schritt wurde früher abgehakt — berechne wie viel früher
        const originalEnd = base[idx].end.getTime();
        const actualEnd = completedAt;
        const gain = originalEnd - actualEnd; // positiv = früher fertig
        shiftMs = Math.max(shiftMs, gain);    // größten Gewinn dieser Phase merken

        // Schritt selbst: end = completedAt
        step.end = new Date(actualEnd);
      } else if (shiftMs > 0) {
        // Folgeschritt: um shiftMs nach vorne verschieben
        step.start = new Date(step.start.getTime() - shiftMs);
        step.end   = new Date(step.end.getTime()   - shiftMs);
      }
    });
  });

  // Neu sortieren (Parallelität kann Reihenfolge ändern)
  result.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Neuer Fertigzeitpunkt = Ende des letzten Schritts
  const newPlannedAt = new Date(Math.max(...result.map(s => s.end.getTime())));
  const originalEnd  = new Date(Math.max(...base.map(s => s.end.getTime())));
  const shifted      = newPlannedAt.getTime() < originalEnd.getTime();

  return { timeline: result, newPlannedAt, shifted };
}