"use client";

import React, { useMemo, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhaseSegment {
  start: number;
  dur: number;
  type: "action" | "rest" | "bake";
  sectionIndex: number;
  label: string;
}

interface SectionRow {
  name: string;
  segments: PhaseSegment[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function fmt(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ─── Core ─────────────────────────────────────────────────────────────────────

function buildRows(doughSections: any[]): { rows: SectionRow[]; totalMin: number } {
  if (!doughSections?.length) return { rows: [], totalMin: 0 };

  const phaseNames = doughSections.map((s: any) => s.name as string);
  const deps: Record<string, string[]> = {};

  doughSections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      [ing.name || "", ing.temperature || ""].forEach((candidate) => {
        const ingName = normalizeName(candidate);
        phaseNames.forEach((otherName) => {
          if (otherName === section.name) return;
          const normOther = normalizeName(otherName);
          if (normOther.length < 4) return;
          const wb = new RegExp(
            `(?:^|\\s)${normOther.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`
          );
          if ((wb.test(ingName) || ingName === normOther) && !deps[section.name].includes(otherName))
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
    endO[name] = dependents.length === 0
      ? 0
      : Math.min(...dependents.map((d) => calcStart(d, new Set(vis))));
    return endO[name];
  }
  function calcStart(name: string, vis = new Set<string>()): number {
    if (name in startO) return startO[name];
    const dur = (sectionMap[name]?.steps || []).reduce((s: number, st: any) => s + stepDur(st), 0);
    startO[name] = calcEnd(name, vis) + dur;
    return startO[name];
  }
  phaseNames.forEach((n) => calcStart(n));

  const totalDur = Math.max(...phaseNames.map((n) => startO[n] || 0));

  const rows: SectionRow[] = doughSections.map((section: any, si: number) => {
    const sectionRelStart = totalDur - (startO[section.name] || 0);
    const segments: PhaseSegment[] = [];
    let t = sectionRelStart;
    (section.steps || []).forEach((step: any) => {
      const dur = stepDur(step);
      if (dur === 0) return;
      const isRest = step.type === "Warten" || step.type === "Kühl" || step.type === "Ruhen";
      const bake = !isRest && isBakingStep(step);
      const instr = (step.instruction || "").trim();
      segments.push({
        start: t,
        dur,
        type: isRest ? "rest" : bake ? "bake" : "action",
        sectionIndex: si,
        label: instr.length > 55 ? instr.slice(0, 52) + "…" : instr,
      });
      t += dur;
    });
    return { name: section.name, segments };
  });

  return { rows, totalMin: totalDur };
}

function buildSummary(rows: SectionRow[], totalMin: number): string {
  if (!rows.length) return "";
  const parts: string[] = [];
  const lastRow = rows[rows.length - 1];
  const mainStart = lastRow.segments.length ? Math.min(...lastRow.segments.map((s) => s.start)) : Infinity;
  const parallelRows = rows.slice(0, -1).filter((row) => {
    const end = row.segments.length ? Math.max(...row.segments.map((s) => s.start + s.dur)) : 0;
    return end <= mainStart + 5;
  });
  if (parallelRows.length > 1) parts.push(`${parallelRows.length} Vorstufen gleichzeitig ansetzen`);
  else if (parallelRows.length === 1) parts.push(`${parallelRows[0].name} ansetzen`);
  const mainActive = lastRow.segments
    .filter((s) => s.type === "action" || s.type === "bake")
    .reduce((sum, s) => sum + s.dur, 0);
  if (mainActive > 0) parts.push(`~${fmt(mainActive)} aktiv für Hauptteig`);
  const bakeMin = lastRow.segments.filter((s) => s.type === "bake").reduce((sum, s) => sum + s.dur, 0);
  if (bakeMin > 0) parts.push(`${fmt(bakeMin)} backen`);
  return parts.join("  ·  ");
}

// ─── Visual time mapping ──────────────────────────────────────────────────────
// Long rest segments get compressed visually. We map real-time to display-time
// so that rest segments longer than REST_CAP are shown at REST_CAP width.
// Action/bake segments keep their true proportional width.

const REST_CAP = 90; // minutes — rests longer than this get capped visually

function buildTimeMap(rows: SectionRow[], totalMin: number): {
  toDisplay: (realMin: number) => number; // real minutes → display %
  displayTotal: number;                   // total display units
  squeezedSegs: Array<{ realStart: number; realEnd: number; displayStart: number; displayEnd: number }>;
} {
  // Collect all unique rest segments across all rows (by real start/end)
  // We squeeze any contiguous real-time span where ALL rows are resting
  // (i.e. no action/bake happening anywhere)
  const resolution = 1; // 1-minute resolution
  const active = new Uint8Array(totalMin + 1);
  rows.forEach((row) => {
    row.segments.forEach((seg) => {
      if (seg.type !== "rest") {
        for (let t = seg.start; t < seg.start + seg.dur; t++) active[t] = 1;
      }
    });
  });

  // Build mapping: list of [realStart, realEnd, displayDur] spans
  type Span = { realStart: number; realEnd: number; isRest: boolean };
  const spans: Span[] = [];
  let spanStart = 0;
  let inRest = !active[0];

  for (let t = 1; t <= totalMin; t++) {
    const nowRest = !active[t];
    if (nowRest !== inRest || t === totalMin) {
      spans.push({ realStart: spanStart, realEnd: t, isRest: inRest });
      spanStart = t;
      inRest = nowRest;
    }
  }

  // Assign display durations
  let displayTotal = 0;
  const mappedSpans = spans.map((span) => {
    const realDur = span.realEnd - span.realStart;
    const displayDur = span.isRest ? Math.min(realDur, REST_CAP) : realDur;
    const ds = displayTotal;
    displayTotal += displayDur;
    return { ...span, displayStart: ds, displayEnd: ds + displayDur };
  });

  const toDisplay = (realMin: number): number => {
    // Find which span this real minute falls in
    for (const span of mappedSpans) {
      if (realMin >= span.realStart && realMin <= span.realEnd) {
        const frac = (realMin - span.realStart) / (span.realEnd - span.realStart || 1);
        return span.displayStart + frac * (span.displayEnd - span.displayStart);
      }
    }
    return displayTotal;
  };

  const squeezedSegs = mappedSpans
    .filter((s) => s.isRest && (s.realEnd - s.realStart) > REST_CAP)
    .map((s) => ({ realStart: s.realStart, realEnd: s.realEnd, displayStart: s.displayStart, displayEnd: s.displayEnd }));

  return { toDisplay, displayTotal, squeezedSegs };
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const ROW_COLORS = ["#f0a500", "#60a5fa", "#a78bfa", "#34d399", "#fb923c"];
const BAKE_COLOR = "#c0392b";

// ─── Component ────────────────────────────────────────────────────────────────

interface TipState {
  visible: boolean;
  rowIdx: number;
  segIdx: number;
  label: string;
  dur: number;
  type: PhaseSegment["type"];
  color: string;
  leftPct: number; // position within track (0–100)
}

export default function RecipeRhythmBar({ doughSections }: { doughSections: any[] }) {
  const { rows, totalMin } = useMemo(() => buildRows(doughSections), [doughSections]);
  const summaryText = useMemo(() => buildSummary(rows, totalMin), [rows, totalMin]);
  const { toDisplay, displayTotal, squeezedSegs } = useMemo(
    () => buildTimeMap(rows, totalMin),
    [rows, totalMin]
  );
  const [tip, setTip] = useState<TipState | null>(null);

  if (!rows.length || totalMin === 0) return null;

  const toPct = (realMin: number) => (toDisplay(realMin) / displayTotal) * 100;

  // Grid interval based on real total duration, but placed via display coords
  const gridInterval =
    totalMin <= 180 ? 60 : totalMin <= 360 ? 120 : totalMin <= 720 ? 180 : 240;
  const gridLines: number[] = [];
  for (let t = gridInterval; t < totalMin; t += gridInterval) gridLines.push(t);

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

      {/* Track area — label + bar */}
      <div className="flex flex-col gap-[4px]">
        {rows.map((row, ri) => {
          const color = ROW_COLORS[ri % ROW_COLORS.length];
          return (
            <div key={ri} className="flex items-center gap-2 group">
              {/* Phase label — fixed 5.5rem */}
              <span
                className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 truncate text-right leading-none"
                style={{ width: "5.5rem" }}
                title={row.name}
              >
                {row.name}
              </span>

              {/* Track */}
              <div className="relative flex-1 h-[14px] rounded bg-gray-100 dark:bg-gray-700/50 overflow-visible">

                {/* Squeeze markers — zigzag cut on squeezed rest zones */}
                {squeezedSegs.map((sq, sqi) => {
                  const leftPct = (sq.displayStart / displayTotal) * 100;
                  const widthPct = ((sq.displayEnd - sq.displayStart) / displayTotal) * 100;
                  return (
                    <div
                      key={sqi}
                      className="absolute top-0 h-full bg-gray-100 dark:bg-gray-700/50"
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    >
                      {/* Left edge marker */}
                      <div className="absolute left-0 top-0 h-full w-px bg-gray-300 dark:bg-gray-500 opacity-60" />
                      {/* Right edge marker */}
                      <div className="absolute right-0 top-0 h-full w-px bg-gray-300 dark:bg-gray-500 opacity-60" />
                      {/* Diagonal lines to indicate compression */}
                      <svg className="absolute inset-0 w-full h-full opacity-20" preserveAspectRatio="none">
                        <defs>
                          <pattern id={`hatch-${ri}-${sqi}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.5" className="text-gray-500 dark:text-gray-400" />
                          </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill={`url(#hatch-${ri}-${sqi})`} />
                      </svg>
                    </div>
                  );
                })}

                {/* Gridlines */}
                {gridLines.map((t) => (
                  <div
                    key={t}
                    className="absolute top-0 h-full w-px pointer-events-none bg-gray-300/50 dark:bg-gray-500/30"
                    style={{ left: `${toPct(t)}%` }}
                  />
                ))}

                {/* Segments */}
                {row.segments.map((seg, si) => {
                  const left = toPct(seg.start);
                  const right = toPct(seg.start + seg.dur);
                  const width = Math.max(right - left, 0.4);
                  const isRest = seg.type === "rest";
                  const bgColor =
                    seg.type === "bake" ? BAKE_COLOR
                    : seg.type === "action" ? color
                    : undefined;

                  return (
                    <div
                      key={si}
                      className={[
                        "absolute top-0 h-full rounded-sm",
                        isRest
                          ? "bg-black/[0.08] dark:bg-white/[0.07]"
                          : "cursor-default hover:brightness-125 transition-[filter] duration-100",
                      ].join(" ")}
                      style={{ left: `${left}%`, width: `${width}%`, backgroundColor: bgColor }}
                      onMouseEnter={() =>
                        !isRest &&
                        setTip({ visible: true, rowIdx: ri, segIdx: si, label: seg.label, dur: seg.dur, type: seg.type, color, leftPct: left + width / 2 })
                      }
                      onMouseLeave={() => setTip(null)}
                    />
                  );
                })}

                {/* Tooltip — only on the row that owns it */}
                {tip?.visible && tip.rowIdx === ri && (
                  <div
                    className="absolute bottom-[calc(100%+7px)] z-20 pointer-events-none -translate-x-1/2"
                    style={{ left: `${tip.leftPct}%` }}
                  >
                    <div className="bg-gray-900 dark:bg-gray-700 rounded-xl shadow-xl px-3 py-2 text-white whitespace-nowrap">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div
                          className="w-2 h-2 rounded-[2px] shrink-0"
                          style={{ backgroundColor: tip.type === "bake" ? BAKE_COLOR : tip.color }}
                        />
                        <span className="text-[11px] font-semibold tabular-nums">{fmt(tip.dur)}</span>
                      </div>
                      <span className="text-[11px] text-gray-300 max-w-[200px] block truncate">{tip.label}</span>
                    </div>
                    <div className="flex justify-center">
                      <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-gray-900 dark:border-t-gray-700" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time axis — purely flex, no absolute positioning */}
      <div className="flex items-center mt-1.5" style={{ paddingLeft: "calc(5.5rem + 0.5rem)" }}>
        <div className="relative flex-1">
          <span className="absolute left-0 text-[10px] text-gray-400 dark:text-gray-500">Start</span>
          {gridLines.map((t) => (
            <span
              key={t}
              className="absolute text-[10px] text-gray-300 dark:text-gray-600 -translate-x-1/2"
              style={{ left: `${toPct(t)}%` }}
            >
              +{fmt(t)}
            </span>
          ))}
          <span className="absolute right-0 text-[10px] text-gray-400 dark:text-gray-500">+{fmt(totalMin)}</span>
          {/* spacer so the div has height */}
          <span className="invisible text-[10px]">x</span>
        </div>
      </div>

      {/* Summary */}
      {summaryText && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50">
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
    </div>
  );
}