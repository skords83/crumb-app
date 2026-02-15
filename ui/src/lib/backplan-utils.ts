// src/lib/backplan-utils.ts

export interface TimelineStep {
  phase: string;
  instruction: string;
  start: Date;
  end: Date;
  duration: number;
}

/**
 * Berechnet die Timeline rückwärts ausgehend von einer Zielzeit.
 * Verwendet manuelle Zeitzerlegung, um Docker/Browser-Zeitzonenfehler zu vermeiden.
 */
export const calculateBackplan = (targetTimeStr: string, doughSections: any[]): TimelineStep[] => {
  if (!targetTimeStr || !doughSections) return [];

  // 1. Manueller Split für absolute lokale Präzision
  const [datePart, timePart] = targetTimeStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  // Monat - 1 weil JS Monate 0-basiert sind
  let currentMoment = new Date(year, month - 1, day, hours, minutes);
  
  const timeline: TimelineStep[] = [];
  const reversedSections = [...doughSections].reverse();

  reversedSections.forEach((section) => {
    const reversedSteps = [...(section.steps || [])].reverse();
    reversedSteps.forEach((step) => {
      const duration = parseInt(step.duration) || 0;
      const endTime = new Date(currentMoment.getTime());
      const startTime = new Date(currentMoment.getTime() - duration * 60000);
      
      timeline.push({
        phase: section.name,
        instruction: step.instruction,
        start: startTime,
        end: endTime,
        duration
      });

      currentMoment = startTime;
    });
  });

  return timeline.reverse();
};

/**
 * Formatiert ein Datum sauber als HH:mm ohne Zeitzonen-Shifting.
 */
export const formatTimeManual = (date: Date): string => {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};