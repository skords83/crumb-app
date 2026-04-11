"use client";

import React, { useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhaseSegment {
  start: number;
  dur: number;
  type: "action" | "rest";
  teig: string;
  sectionIndex: number;
}

// ─── Helpers (mirrored from PlanModal / backplan-utils) ───────────────────────

const TEIG_ACTION_COLORS = [
  "#f0a500", // s0 amber
  "#60a5fa", // s1 blue
  "#a78bfa", // s2 purple
  "#34d399", // s3 teal
  "#f87171", // s4 red
];
const BAKE_COLOR = "#c0392b";
const REST_COLOR_LIGHT = "rgba(0,0,0,0.12)";
const REST_COLOR_DARK  = "rgba(255,255,255,0.08)";

function stepDur(step: any): number {
  const min = parseInt(step.duration_min);
  const max = parseInt(step.duration_max);
  if (!isNaN(min) && !isNaN(max)) return Math.round((min + max) / 2);
  return parseInt(step.duration) || 0;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\d+\.\s*/, "")
    .replace(/\bstufe\s+\d+\b/g, "")
    .replace(/\breifer?\b/g, "")
    .replace(/\bfrischer?\b/g, "")
    .replace(/\bfertig[a-z]*\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBakingStep(step: any): boolean {
  const instr = (step.instruction || "").toLowerCase();
  return /\bbac?k(en|t|st)?\b/.test(instr) && step.type !== "Warten" && step.type !== "Ruhen";
}

function sectionsToPhases(doughSections: any[]): PhaseSegment[] {
  const phases: PhaseSegment[] = [];
  if (!doughSections?.length) return phases;

  const phaseNames = doughSections.map((s: any) => s.name as string);

  const deps: Record<string, string[]> = {};
  doughSections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      const candidates = [ing.name || "", ing.temperature || ""];
      candidates.forEach((candidate) => {
        const ingName = normalizeName(candidate);
        phaseNames.forEach((otherName) => {
          if (otherName === section.name) return;
          const normOther = normalizeName(otherName);
          if (normOther.length < 4) return;
          const wb = new RegExp(
            `(?:^|\\s)${normOther.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`
          );
          if (wb.test(ingName) || ingName === normOther)
            if (!deps[section.name].includes(otherName))
              deps[section.name].push(otherName);
        });
      });
    });
  });

  const sectionMap = Object.fromEntries(doughSections.map((s: any) => [s.name, s]));
  const endO: Record<string, number> = {};
  const startO: Record<string, number> = {};

  function calcEnd(name: string, vis = new Set<string>()): number {
    if (name in endO) return endO[name];
    if (vis.has(name)) return 0;
    vis.add(name);
    const dependents = phaseNames.filter((n) => deps[n]?.includes(name));
    endO[name] =
      dependents.length === 0
        ? 0
        : Math.min(...dependents.map((d) => calcStart(d, new Set(vis))));
    return endO[name];
  }
  function calcStart(name: string, vis = new Set<string>()): number {
    if (name in startO) return startO[name];
    const dur = (sectionMap[name]?.steps || []).reduce(
      (s: number, st: any) => s + stepDur(st),
      0
    );
    startO[name] = calcEnd(name, vis) + dur;
    return startO[name];
  }
  phaseNames.forEach((n) => calcStart(n));

  const totalDur = Math.max(...phaseNames.map((n) => startO[n] || 0));

  doughSections.forEach((section: any, si: number) => {
    const sectionRelStart = totalDur - (startO[section.name] || 0);
    let t = sectionRelStart;
    (section.steps || []).forEach((step: any) => {
      const dur = stepDur(step);
      const isRest =
        step.type === "Warten" || step.type === "Kühl" || step.type === "Ruhen";
      phases.push({
        start: t,
        dur,
        type: isRest ? "rest" : "action",
        teig: `s${si}`,
        sectionIndex: si,
      });
      t += dur;
    });
  });

  return phases;
}

// ─── Summary text generator ───────────────────────────────────────────────────

function buildSummaryText(doughSections: any[], phases: PhaseSegment[]): string {
  if (!phases.length) return "";

  const parallelSections = doughSections.filter((_, i) => {
    // A section is "parallel/pre-dough" if it ends before the last section starts
    const sPhases = phases.filter((p) => p.sectionIndex === i);
    if (!sPhases.length) return false;
    const lastSectionIndex = doughSections.length - 1;
    const mainPhases = phases.filter((p) => p.sectionIndex === lastSectionIndex);
    if (!mainPhases.length) return false;
    const sEnd = Math.max(...sPhases.map((p) => p.start + p.dur));
    const mainStart = Math.min(...mainPhases.map((p) => p.start));
    return sEnd <= mainStart + 5; // small tolerance
  });

  const totalMin = Math.max(...phases.map((p) => p.start + p.dur));

  // Active time: all action phases, excluding parallel rests
  const activeMin = phases
    .filter((p) => p.type === "action")
    .reduce((sum, p) => sum + p.dur, 0);

  // Longest contiguous rest across all sections (gap in global activity)
  // Simple: find contiguous rest-only minutes
  const active = new Uint8Array(totalMin + 1);
  phases.forEach((p) => {
    if (p.type === "action") {
      for (let t = p.start; t < p.start + p.dur; t++) active[t] = 1;
    }
  });
  let maxRest = 0, curRest = 0;
  for (let t = 0; t <= totalMin; t++) {
    if (!active[t]) { curRest++; maxRest = Math.max(maxRest, curRest); }
    else curRest = 0;
  }

  // Bake duration = last action segment(s) at the end
  const lastPhases = phases.filter((p) => p.type === "action").sort((a, b) => b.start - a.start);
  let bakeMin = 0;
  if (lastPhases.length) {
    const bakeEnd = lastPhases[0].start + lastPhases[0].dur;
    // Walk backwards collecting connected bake steps
    let cursor = bakeEnd;
    for (const p of lastPhases) {
      if (p.start + p.dur >= cursor - 2) { bakeMin += p.dur; cursor = p.start; }
      else break;
    }
  }

  const fmt = (min: number) => {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  };

  const parts: string[] = [];

  if (parallelSections.length > 1) {
    parts.push(`${parallelSections.length} Vorstufen gleichzeitig ansetzen`);
  } else if (parallelSections.length === 1) {
    parts.push(`${parallelSections[0].name} ansetzen`);
  }

  const mainActiveMin = activeMin - (parallelSections.length > 0 ? parallelSections.length * 5 : 0);
  if (mainActiveMin > 0) {
    parts.push(`~${fmt(Math.max(mainActiveMin, activeMin))} aktiv für Hauptteig`);
  }

  if (bakeMin > 0) {
    parts.push(`${fmt(bakeMin)} backen`);
  }

  return parts.join("  ·  ");
}

// ─── Component ────────────────────────────────────────────────────────────────

interface RecipeRhythmBarProps {
  doughSections: any[];
}

export default function RecipeRhythmBar({ doughSections }: RecipeRhythmBarProps) {
  const phases = useMemo(() => sectionsToPhases(doughSections), [doughSections]);
  const summaryText = useMemo(
    () => buildSummaryText(doughSections, phases),
    [doughSections, phases]
  );

  const totalMin = useMemo(
    () => (phases.length ? Math.max(...phases.map((p) => p.start + p.dur)) : 0),
    [phases]
  );

  // Determine unique section indices that are actually "parallel pre-doughs"
  const parallelIndices = useMemo(() => {
    if (!phases.length) return new Set<number>();
    const lastIdx = doughSections.length - 1;
    const mainPhases = phases.filter((p) => p.sectionIndex === lastIdx);
    const mainStart = mainPhases.length ? Math.min(...mainPhases.map((p) => p.start)) : Infinity;
    const result = new Set<number>();
    doughSections.forEach((_, i) => {
      if (i === lastIdx) return;
      const sPhases = phases.filter((p) => p.sectionIndex === i);
      if (!sPhases.length) return;
      const sEnd = Math.max(...sPhases.map((p) => p.start + p.dur));
      if (sEnd <= mainStart + 5) result.add(i);
    });
    return result;
  }, [phases, doughSections]);

  if (!phases.length || totalMin === 0) return null;

  // Build legend entries
  type LegendEntry = { color: string; label: string };
  const legendEntries: LegendEntry[] = [];
  const seenTeigs = new Set<string>();
  phases.forEach((p) => {
    if (p.type !== "action") return;
    if (seenTeigs.has(p.teig)) return;
    seenTeigs.add(p.teig);
    const idx = parseInt(p.teig.replace("s", ""));
    const isBakePhase = phases
      .filter((ph) => ph.teig === p.teig && ph.type === "action")
      .some((ph) => {
        const steps = doughSections[idx]?.steps || [];
        // find matching step by position
        let t = 0;
        const lastIdx = doughSections.length - 1;
        const sStart = Math.min(...phases.filter((x) => x.sectionIndex === idx).map((x) => x.start));
        return steps.some((st: any) => isBakingStep(st));
      });
    const isParallel = parallelIndices.has(idx);
    const color = TEIG_ACTION_COLORS[idx % TEIG_ACTION_COLORS.length];
    const name = doughSections[idx]?.name || `Phase ${idx + 1}`;
    legendEntries.push({ color, label: name });
  });

  // Check if last section contains baking steps → show bake legend
  const lastIdx = doughSections.length - 1;
  const hasBake = (doughSections[lastIdx]?.steps || []).some(isBakingStep);

  return (
    <div className="mb-10 p-5 bg-[#FDFCFB] dark:bg-gray-800/50 rounded-2xl border border-[#8B4513]/5 dark:border-[#8B4513]/20">
      {/* Header */}
      <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3 flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[#8B7355]">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M6 3v3l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        Tagesrhythmus
      </h3>

      {/* Bar */}
      <div className="flex h-[18px] rounded-md overflow-hidden gap-[2px] bg-gray-100 dark:bg-gray-700/50 p-[2px]">
        {phases.map((seg, i) => {
          const pct = (seg.dur / totalMin) * 100;
          const idx = seg.sectionIndex;

          let color: string;
          if (seg.type === "rest") {
            // Subtle: slightly tinted per section
            color = "transparent";
          } else {
            // Check if this is a baking step
            const steps = doughSections[idx]?.steps || [];
            let stepIdx = 0;
            let t = Math.min(...phases.filter((p) => p.sectionIndex === idx).map((p) => p.start));
            for (let si = 0; si < steps.length; si++) {
              if (Math.abs(t - seg.start) < 2) { stepIdx = si; break; }
              t += stepDur(steps[si]);
            }
            const step = steps[stepIdx];
            color =
              step && isBakingStep(step)
                ? BAKE_COLOR
                : TEIG_ACTION_COLORS[idx % TEIG_ACTION_COLORS.length];
          }

          return (
            <div
              key={i}
              style={{
                width: `${Math.max(pct, 0.4)}%`,
                flexShrink: 0,
                borderRadius: 2,
                backgroundColor:
                  seg.type === "rest"
                    ? undefined
                    : color,
              }}
              className={
                seg.type === "rest"
                  ? "bg-black/[0.07] dark:bg-white/[0.06]"
                  : ""
              }
            />
          );
        })}
      </div>

      {/* Time labels */}
      <div className="flex justify-between mt-1 mb-3">
        <span className="text-[10px] text-gray-400 dark:text-gray-500">Start</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {totalMin >= 60
            ? `+${Math.floor(totalMin / 60)} h${totalMin % 60 ? ` ${totalMin % 60} min` : ""}`
            : `+${totalMin} min`}
        </span>
      </div>

      {/* Summary sentence */}
      {summaryText && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
          {summaryText.split("  ·  ").map((part, i, arr) => (
            <React.Fragment key={i}>
              <span className="font-semibold text-gray-700 dark:text-gray-300">{part}</span>
              {i < arr.length - 1 && (
                <span className="mx-1.5 text-gray-300 dark:text-gray-600">·</span>
              )}
            </React.Fragment>
          ))}
        </p>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-3 border-t border-gray-100 dark:border-gray-700/50">
        {legendEntries.map((e, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0"
              style={{ backgroundColor: e.color }}
            />
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{e.label}</span>
          </div>
        ))}
        {hasBake && (
          <div className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0"
              style={{ backgroundColor: BAKE_COLOR }}
            />
            <span className="text-[10px] text-gray-500 dark:text-gray-400">Backen</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0 bg-black/[0.1] dark:bg-white/[0.1]" />
          <span className="text-[10px] text-gray-500 dark:text-gray-400">Ruhe</span>
        </div>
      </div>
    </div>
  );
}