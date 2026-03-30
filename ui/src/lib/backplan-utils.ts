// ui/src/lib/backplan-utils.ts
// ============================================================
// BACKPLAN UTILS v2 — State-Machine-basiert
//
// Die meiste Logik liegt jetzt server-seitig (bake-engine.js).
// Dieses File enthält nur noch:
// - TypeScript Types
// - Formatierungs-Helpers
// - Die alte calculateBackplan/calcTotalDuration für den PlanModal
// ============================================================

// ── Types ───────────────────────────────────────────────────

export type StepState = 'locked' | 'ready' | 'active' | 'soft_done' | 'done';

export interface TimelineStep {
  globalIdx: number;
  phase: string;
  instruction: string;
  type: string;
  duration: number;
  duration_min: number | null;
  duration_max: number | null;
  state: StepState;
  start: string | null;   // ISO timestamp
  end: string | null;     // ISO timestamp
  remaining: number | null; // seconds
  temperature: number | null;
  extended_by: number;
}

export interface PhaseGate {
  phase: string;
  dependencies: string[];
  firstStepIdx: number;
}

export interface BakeSession {
  id: number;
  recipe_id: number;
  title: string;
  image_url: string;
  category: string;
  planned_at: string;
  started_at: string;
  multiplier: number;
  projected_end: string;
  step_states: Record<string, StepState>;
  step_timestamps: Record<string, any>;
  timeline: TimelineStep[];
  gates: PhaseGate[];
  dough_sections: any[];
  temperature_log: any[];
}

export interface BakeHistoryEntry {
  id: number;
  recipe_id: number;
  title: string;
  image_url: string;
  planned_at: string;
  started_at: string;
  finished_at: string;
  multiplier: number;
  notes: string | null;
  temperature_log: any[];
  step_timestamps: Record<string, any>;
  total_actual_duration: number;
  step_count: number;
}

export interface RecipeStats {
  bake_count: number;
  last_baked: string | null;
  avg_duration_minutes: number | null;
}

// ── Helpers ─────────────────────────────────────────────────

export function parseLocalDate(dateStr: string): Date {
  if (/Z$/.test(dateStr) || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  const [datePart, timePart] = dateStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = (timePart || '00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

export function formatLocalISO(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatSmartTime(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  if (!minutes || minutes === 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

export function formatStepDuration(step: { duration: number; duration_min?: number | null; duration_max?: number | null }): string {
  const min = step.duration_min;
  const max = step.duration_max;
  if (min != null && max != null && !isNaN(min) && !isNaN(max)) {
    return `${formatDuration(min)} – ${formatDuration(max)}`;
  }
  return formatDuration(step.duration);
}

export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── State Helpers ───────────────────────────────────────────

export function getActiveStep(timeline: TimelineStep[]): TimelineStep | null {
  return timeline.find(s => s.state === 'active') || null;
}

export function getSoftDoneStep(timeline: TimelineStep[]): TimelineStep | null {
  return timeline.find(s => s.state === 'soft_done') || null;
}

export function getNextPendingStep(timeline: TimelineStep[]): TimelineStep | null {
  return timeline.find(s => s.state === 'ready' || s.state === 'locked') || null;
}

export function getProgress(timeline: TimelineStep[]): number {
  if (timeline.length === 0) return 0;
  const done = timeline.filter(s => s.state === 'done').length;
  return done / timeline.length;
}

export function getPhases(timeline: TimelineStep[]): string[] {
  return [...new Set(timeline.map(s => s.phase))];
}

export function getPhaseProgress(timeline: TimelineStep[], phase: string): { done: number; total: number } {
  const phaseSteps = timeline.filter(s => s.phase === phase);
  const done = phaseSteps.filter(s => s.state === 'done').length;
  return { done, total: phaseSteps.length };
}

// ── Alte Funktionen (für PlanModal) ─────────────────────────
// Diese werden nur noch im PlanModal verwendet für die Dauer-Berechnung

function effectiveDuration(step: any): number {
  const min = parseInt(step.duration_min);
  const max = parseInt(step.duration_max);
  if (!isNaN(min) && !isNaN(max)) return Math.round((min + max) / 2);
  return parseInt(step.duration) || 0;
}

export function calcTotalDuration(sections: any[]): number {
  if (!sections || sections.length === 0) return 0;
  const phaseNames = sections.map((s: any) => s.name as string);
  const normalize = (name: string) =>
    name.toLowerCase()
      .replace(/^\d+\.\s*/, '').replace(/\bstufe\s+\d+\b/g, '')
      .replace(/\breifer?\b/g, '').replace(/\bfrischer?\b/g, '')
      .replace(/\bfertig[a-z]*\b/g, '').replace(/\bgesamte?s?\b/g, '')
      .replace(/\beingeweicht\w*\b/g, '').replace(/\s+/g, ' ').trim();

  const deps: Record<string, string[]> = {};
  sections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      const candidates = [ing.name || '', ing.temperature || ''];
      candidates.forEach(candidate => {
        const ingName = normalize(candidate);
        phaseNames.forEach(otherName => {
          if (otherName === section.name) return;
          const normOther = normalize(otherName);
          if (normOther.length < 4) return;
          const wb = new RegExp(`(?:^|\\s)${normOther.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
          if (wb.test(ingName) || ingName === normOther)
            if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
        });
      });
    });
  });

  const sectionMap = Object.fromEntries(sections.map((s: any) => [s.name, s]));
  const calcVariant = (useMax: boolean) => {
    const endO: Record<string, number> = {};
    const startO: Record<string, number> = {};
    const getDur = (st: any) => {
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

  // Mittelwert zurückgeben
  return Math.round((calcVariant(false) + calcVariant(true)) / 2);
}

// Min/Max-Range der Gesamtdauer (für Rezept-Detail-Anzeige)
export function calcTotalDurationRange(sections: any[]): { min: number; max: number } {
  if (!sections || sections.length === 0) return { min: 0, max: 0 };
  const phaseNames = sections.map((s: any) => s.name as string);
  const normalize = (name: string) =>
    name.toLowerCase()
      .replace(/^\d+\.\s*/, '').replace(/\bstufe\s+\d+\b/g, '')
      .replace(/\breifer?\b/g, '').replace(/\bfrischer?\b/g, '')
      .replace(/\bfertig[a-z]*\b/g, '').replace(/\bgesamte?s?\b/g, '')
      .replace(/\beingeweicht\w*\b/g, '').replace(/\s+/g, ' ').trim();

  const deps: Record<string, string[]> = {};
  sections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      const candidates = [ing.name || '', ing.temperature || ''];
      candidates.forEach(candidate => {
        const ingName = normalize(candidate);
        phaseNames.forEach(otherName => {
          if (otherName === section.name) return;
          const normOther = normalize(otherName);
          if (normOther.length < 4) return;
          const wb = new RegExp(`(?:^|\\s)${normOther.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
          if (wb.test(ingName) || ingName === normOther)
            if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
        });
      });
    });
  });

  const sectionMap = Object.fromEntries(sections.map((s: any) => [s.name, s]));
  const calcVariant = (useMax: boolean) => {
    const endO: Record<string, number> = {};
    const startO: Record<string, number> = {};
    const getDur = (st: any) => {
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

// Für den PlanModal — berechnet Timeline rückwärts vom Zielzeitpunkt
// (wird nur noch für die Vorschau im PlanModal verwendet, nicht im Backplan selbst)
export interface BackplanStep {
  phase: string;
  instruction: string;
  type: string;
  duration: number;
  duration_min?: number;
  duration_max?: number;
  start: Date;
  end: Date;
  isParallel?: boolean;
  ingredients?: any[];
}

export function calculateBackplan(targetDate: Date | string, sections: any[]): BackplanStep[] {
  if (!sections || sections.length === 0) return [];
  const target = typeof targetDate === 'string' ? parseLocalDate(targetDate) : targetDate;
  const timeline: BackplanStep[] = [];
  const phaseNames = sections.map((s: any) => s.name as string);

  const normalize = (name: string) =>
    name.toLowerCase()
      .replace(/^\d+\.\s*/, '').replace(/\bstufe\s+\d+\b/g, '')
      .replace(/\breifer?\b/g, '').replace(/\bfrischer?\b/g, '')
      .replace(/\bfertig[a-z]*\b/g, '').replace(/\bgesamte?s?\b/g, '')
      .replace(/\beingeweicht\w*\b/g, '').replace(/\s+/g, ' ').trim();

  const deps: Record<string, string[]> = {};
  sections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      const candidates = [ing.name || '', ing.temperature || ''];
      candidates.forEach(candidate => {
        const ingName = normalize(candidate);
        phaseNames.forEach(otherName => {
          if (otherName === section.name) return;
          const normOther = normalize(otherName);
          if (normOther.length < 4) return;
          const wb = new RegExp(`(?:^|\\s)${normOther.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
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
    endO[name] = deps2.length === 0 ? 0 : Math.min(...deps2.map((d: string) => calcStart(d, new Set(vis))));
    return endO[name];
  }

  function calcStart(name: string, vis = new Set<string>()): number {
    if (name in startO) return startO[name];
    const dur = (sectionMap[name]?.steps || []).reduce(
      (s: number, st: any) => s + effectiveDuration(st), 0
    );
    startO[name] = calcEnd(name, vis) + dur;
    return startO[name];
  }

  phaseNames.forEach((n: string) => calcStart(n));

  sections.forEach((section: any) => {
    const offset = startO[section.name] || 0;
    const sectionStart = new Date(target.getTime() - offset * 60000);
    let stepMoment = new Date(sectionStart.getTime());

    (section.steps || []).forEach((step: any) => {
      const duration = effectiveDuration(step);
      const stepStart = new Date(stepMoment.getTime());
      const stepEnd = new Date(stepMoment.getTime() + duration * 60000);
      timeline.push({
        phase: section.name,
        instruction: step.instruction || '',
        type: step.type || 'Aktion',
        duration,
        duration_min: parseInt(step.duration_min) || undefined,
        duration_max: parseInt(step.duration_max) || undefined,
        start: stepStart,
        end: stepEnd,
        isParallel: (endO[section.name] || 0) > 0,
        ingredients: section.ingredients,
      });
      stepMoment = stepEnd;
    });
  });

  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
  return timeline;
}