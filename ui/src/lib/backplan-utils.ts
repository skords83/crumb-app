// ============================================================
// BACKPLAN UTILS
// Berechnet die Timeline für ein Rezept rückwärts vom Zielzeitpunkt.
//
// Variante B: Wenn start_offset_minutes in dough_sections vorhanden
// (aus importiertem Planungsbeispiel), werden diese exakten Versätze
// genutzt. Andernfalls Fallback auf is_parallel-Logik.
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

  // Variante B: start_offset_minutes aus Planungsbeispiel
  const hasOffsets = sections.some((s: any) => s.start_offset_minutes != null);

  if (hasOffsets) {
    // Exakte Startzeiten: Jede Phase startet offset Minuten VOR dem Zielzeitpunkt
    sections.forEach((section: any) => {
      const offset: number = section.start_offset_minutes ?? 0;
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
          isParallel: section.is_parallel,
          ingredients: section.ingredients || [],
        });
        stepMoment = stepEnd;
      });
    });

  } else {
    // Fallback: is_parallel Logik – rückwärts vom Ziel
    let currentMoment = new Date(target.getTime());
    const reversedSections = [...sections].reverse();
    let mergePoint = new Date(currentMoment.getTime());

    reversedSections.forEach((section: any) => {
      const steps = section.steps || [];
      const totalDuration = steps.reduce(
        (sum: number, step: any) => sum + (parseInt(step.duration) || 0), 0
      );
      const isParallel =
        (section.name || '').toLowerCase().includes('vorteig') || section.is_parallel;
      const endTime = isParallel
        ? new Date(mergePoint.getTime())
        : new Date(currentMoment.getTime());
      const startTime = new Date(endTime.getTime() - totalDuration * 60000);
      let stepMoment = new Date(startTime.getTime());

      steps.forEach((step: any) => {
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
          isParallel,
          ingredients: section.ingredients || [],
        });
        stepMoment = stepEnd;
      });

      if (!isParallel) {
        currentMoment = startTime;
        mergePoint = startTime;
      }
    });
  }

  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
  return timeline;
}

export function formatTimeManual(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}