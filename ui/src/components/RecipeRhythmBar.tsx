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

const ROW_COLORS = ["#f0a500", "#60a5fa", "#a78bfa", "#34d399", "#fb923c"];
const BAKE_COLOR = "#c0392b";
const LABEL_W = "5.5rem";

// ─── Component ────────────────────────────────────────────────────────────────

interface TooltipInfo {
  visible: boolean;
  segKey: string;
  label: string;
  dur: number;
  type: PhaseSegment["type"];
  color: string;
}

export default function RecipeRhythmBar({ doughSections }: { doughSections: any[] }) {
  const { rows, totalMin } = useMemo(() => buildRows(doughSections), [doughSections]);
  const summaryText = useMemo(() => buildSummary(rows, totalMin), [rows, totalMin]);
  const [tip, setTip] = useState<TooltipInfo>({ visible: false, segKey: "", label: "", dur: 0, type: "action", color: "" });

  if (!rows.length || totalMin === 0) return null;

  // Grid interval: pick a round number so labels don't crowd
  const gridInterval =
    totalMin <= 180 ? 60
    : totalMin <= 360 ? 120
    : totalMin <= 720 ? 180
    : 240;

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

      {/* Gantt rows */}
      <div className="flex flex-col gap-[4px]">
        {rows.map((row, ri) => {
          const color = ROW_COLORS[ri % ROW_COLORS.length];
          return (
            <div key={ri} className="flex items-center gap-2">
              {/* Phase label */}
              <span
                className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 truncate text-right leading-none"
                style={{ width: LABEL_W }}
                title={row.name}
              >
                {row.name}
              </span>

              {/* Track */}
              <div className="relative flex-1 h-[14px] rounded bg-gray-100 dark:bg-gray-700/50">

                {/* Gridlines through track */}
                {gridLines.map((t) => (
                  <div
                    key={t}
                    className="absolute top-0 h-full w-px pointer-events-none bg-gray-300/60 dark:bg-gray-500/40"
                    style={{ left: `${(t / totalMin) * 100}%` }}
                  />
                ))}

                {/* Segments */}
                {row.segments.map((seg, si) => {
                  const segKey = `${ri}-${si}`;
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
                      style={{
                        left: `${(seg.start / totalMin) * 100}%`,
                        width: `${Math.max((seg.dur / totalMin) * 100, 0.5)}%`,
                        backgroundColor: bgColor,
                      }}
                      onMouseEnter={() =>
                        !isRest && setTip({ visible: true, segKey, label: seg.label, dur: seg.dur, type: seg.type, color })
                      }
                      onMouseLeave={() => setTip((p) => ({ ...p, visible: false }))}
                    />
                  );
                })}

                {/* Inline tooltip — renders inside the track row so it never clips */}
                {tip.visible && row.segments.some((_, si) => `${ri}-${si}` === tip.segKey) && (
                  <div
                    className="absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-20 pointer-events-none"
                    style={{
                      // nudge toward the hovered segment's center
                      left: (() => {
                        const segIdx = parseInt(tip.segKey.split("-")[1]);
                        const seg = row.segments[segIdx];
                        if (!seg) return "50%";
                        return `${((seg.start + seg.dur / 2) / totalMin) * 100}%`;
                      })(),
                    }}
                  >
                    <div className="bg-gray-900 dark:bg-gray-700 rounded-xl shadow-xl px-3 py-2 text-white whitespace-nowrap">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div
                          className="w-2 h-2 rounded-[2px] shrink-0"
                          style={{ backgroundColor: tip.type === "bake" ? BAKE_COLOR : tip.color }}
                        />
                        <span className="text-[11px] font-semibold tabular-nums">{fmt(tip.dur)}</span>
                      </div>
                      <span className="text-[11px] text-gray-300 max-w-[180px] block truncate">{tip.label}</span>
                    </div>
                    {/* Arrow */}
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

      {/* Time axis */}
      <div
        className="relative mt-1.5 h-4"
        style={{ paddingLeft: `calc(${LABEL_W} + 0.5rem)` }}
      >
        {/* Start label */}
        <span className="absolute left-[calc(5.5rem+0.5rem)] text-[10px] text-gray-400 dark:text-gray-500">
          Start
        </span>

        {/* Intermediate labels */}
        {gridLines.map((t) => {
          const pct = (t / totalMin) * 100;
          return (
            <span
              key={t}
              className="absolute text-[10px] text-gray-300 dark:text-gray-600 -translate-x-1/2"
              style={{ left: `calc(${LABEL_W} + 0.5rem + ${pct}% * (100% - ${LABEL_W} - 0.5rem) / 100)` }}
            >
              +{fmt(t)}
            </span>
          );
        })}

        {/* End label */}
        <span className="absolute right-0 text-[10px] text-gray-400 dark:text-gray-500">
          +{fmt(totalMin)}
        </span>
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