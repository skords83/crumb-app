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
  duration: number;
  start: Date;
  end: Date;
  isParallel?: boolean;
  ingredients?: any[];
}

export function calculateBackplan(targetDate: Date | string, sections: any[]): BackplanStep[] {
  if (!sections || sections.length === 0) return [];
  const target = new Date(typeof targetDate === 'string' ? targetDate : targetDate.getTime());
  const timeline: BackplanStep[] = [];
  const phaseNames = sections.map((s: any) => s.name as string);

  // Dependency Graph aufbauen
  const deps: Record<string, string[]> = {};
  sections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      const ingName = (ing.name || '').toLowerCase();
      phaseNames.forEach(otherName => {
        if (otherName !== section.name && ingName.includes(otherName.toLowerCase())) {
          if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
        }
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
      (sum: number, s: any) => sum + (parseInt(s.duration) || 0), 0
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
      const duration = parseInt(step.duration) || 0;
      const stepStart = new Date(stepMoment.getTime());
      const stepEnd = new Date(stepMoment.getTime() + duration * 60000);
      timeline.push({
        phase: section.name,
        instruction: step.instruction,
        type: step.type || 'Aktion',
        duration,
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