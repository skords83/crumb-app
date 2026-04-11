"use client";

import React, { useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhaseSegment {
  start: number;
  dur: number;
  type: "action" | "rest" | "bake";
  sectionIndex: number;
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

// ─── Core: sections → per-row segments with absolute start times ──────────────

function buildRows(doughSections: any[]): { rows: SectionRow[]; totalMin: number } {
  if (!doughSections?.length) return { rows: [], totalMin: 0 };

  const phaseNames = doughSections.map((s: any) => s.name as string);

  // Build dependency graph (same logic as PlanModal / backplan-utils)
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
      segments.push({ start: t, dur, type: isRest ? "rest" : bake ? "bake" : "action", sectionIndex: si });
      t += dur;
    });
    return { name: section.name, segments };
  });

  return { rows, totalMin: totalDur };
}

// ─── Summary text ─────────────────────────────────────────────────────────────

function buildSummary(rows: SectionRow[], totalMin: number): string {
  if (!rows.length) return "";
  const parts: string[] = [];

  const lastRow = rows[rows.length - 1];
  const mainStart = lastRow.segments.length ? Math.min(...lastRow.segments.map((s) => s.start)) : Infinity;
  const parallelRows = rows.slice(0, -1).filter((row) => {
    const end = row.segments.length ? Math.max(...row.segments.map((s) => s.start + s.dur)) : 0;
    return end <= mainStart + 5;
  });

  if (parallelRows.length > 1) {
    parts.push(`${parallelRows.length} Vorstufen gleichzeitig ansetzen`);
  } else if (parallelRows.length === 1) {
    parts.push(`${parallelRows[0].name} ansetzen`);
  }

  const mainActive = lastRow.segments
    .filter((s) => s.type === "action" || s.type === "bake")
    .reduce((sum, s) => sum + s.dur, 0);
  if (mainActive > 0) parts.push(`~${fmt(mainActive)} aktiv für Hauptteig`);

  const bakeMin = lastRow.segments
    .filter((s) => s.type === "bake")
    .reduce((sum, s) => sum + s.dur, 0);
  if (bakeMin > 0) parts.push(`${fmt(bakeMin)} backen`);

  return parts.join("  ·  ");
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const ROW_COLORS = [
  "#f0a500",
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#fb923c",
];
const BAKE_COLOR = "#c0392b";

// ─── Component ────────────────────────────────────────────────────────────────

interface RecipeRhythmBarProps {
  doughSections: any[];
}

export default function RecipeRhythmBar({ doughSections }: RecipeRhythmBarProps) {
  const { rows, totalMin } = useMemo(() => buildRows(doughSections), [doughSections]);
  const summaryText = useMemo(() => buildSummary(rows, totalMin), [rows, totalMin]);

  if (!rows.length || totalMin === 0) return null;

  return (
    <div className="mb-10 p-5 bg-[#FDFCFB] dark:bg-gray-800/50 rounded-2xl border border-[#8B4513]/5 dark:border-[#8B4513]/20">

      {/* Header */}
      <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4 flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[#8B7355]">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M6 3v3l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        Tagesrhythmus
      </h3>

      {/* Gantt rows */}
      <div className="flex flex-col gap-[5px]">
        {rows.map((row, ri) => {
          const color = ROW_COLORS[ri % ROW_COLORS.length];
          return (
            <div key={ri} className="flex items-center gap-2">
              {/* Phase label */}
              <span
                className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 truncate text-right"
                style={{ width: "6rem" }}
                title={row.name}
              >
                {row.name}
              </span>

              {/* Track */}
              <div className="relative flex-1 h-[14px] rounded bg-gray-100 dark:bg-gray-700/50">
                {row.segments.map((seg, si) => {
                  const left = (seg.start / totalMin) * 100;
                  const width = (seg.dur / totalMin) * 100;
                  return (
                    <div
                      key={si}
                      className={
                        seg.type === "rest"
                          ? "absolute top-0 h-full rounded-sm bg-black/[0.08] dark:bg-white/[0.07]"
                          : "absolute top-0 h-full rounded-sm"
                      }
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 0.5)}%`,
                        backgroundColor:
                          seg.type === "bake"
                            ? BAKE_COLOR
                            : seg.type === "action"
                            ? color
                            : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time axis */}
      <div className="flex justify-between mt-1.5" style={{ paddingLeft: "calc(6rem + 0.5rem)" }}>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">Start</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">+{fmt(totalMin)}</span>
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