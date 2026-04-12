"use client";

import React, { useEffect, useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as Icons from 'lucide-react';
import { calcTotalDuration, calcTotalDurationRange } from '@/lib/backplan-utils';
import { calcHydration, FLOUR_KEYWORDS } from '@/lib/hydration';
import PlanModal from "@/components/PlanModal";
import { RecipeDetailSkeleton } from "@/components/LoadingSkeletons";

// ── BÄCKERPROZENTE ──────────────────────────────────────────
const isFlour = (name: string) => {
  const lower = name.toLowerCase();
  return FLOUR_KEYWORDS.some(kw => lower.includes(kw));
};

const calcFlourBase = (ingredients: any[]): number => {
  return ingredients
    .filter(ing => isFlour(ing.name || ''))
    .reduce((sum, ing) => {
      const parsed = parseFloat(String(ing.amount || '0').replace(',', '.'));
      return sum + (isNaN(parsed) ? 0 : parsed);
    }, 0);
};

const toBakersPercent = (amount: number, flourBase: number): string | null => {
  if (!flourBase || flourBase === 0) return null;
  const pct = (amount / flourBase) * 100;
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(1)}%`;
};

// ── HILFSFUNKTIONEN ─────────────────────────────────────────
function DescriptionBox({ description }: { description: string }) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const preview = description.substring(0, 150);
  const needsExpansion = description.length > 150;
  return (
    <div className="mb-10 p-6 bg-amber-50/50 dark:bg-amber-900/20 rounded-2xl border border-amber-100/50 dark:border-amber-800/50">
      <p className="print-description-full hidden text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
        {description}
      </p>
      <p className="print-description-preview text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
        {isExpanded ? description : preview + (needsExpansion ? '...' : '')}
      </p>
      {needsExpansion && (
        <button onClick={() => setIsExpanded(!isExpanded)}
          className="print-description-toggle mt-3 text-xs font-bold text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 flex items-center gap-1 transition-colors">
          {isExpanded ? (
            <><Icons.ChevronUp size={14} /> Weniger anzeigen</>
          ) : (
            <><Icons.ChevronDown size={14} /> Mehr anzeigen</>
          )}
        </button>
      )}
    </div>
  );
}

function DeleteConfirmModal({ recipeName, onConfirm, onCancel }: { recipeName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-xl">
        <h3 className="font-black text-lg text-gray-900 dark:text-gray-100 mb-2">Rezept löschen?</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          „{recipeName}" wird unwiderruflich gelöscht.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            Abbrechen
          </button>
          <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-red-500 text-sm font-bold text-white hover:bg-red-600 transition-colors">
            Löschen
          </button>
        </div>
      </div>
    </div>
  );
}

function scaleAmount(amount: string | number, multiplier: number): string {
  if (!amount && amount !== 0) return '';
  const str = String(amount).replace(',', '.');
  const num = parseFloat(str);
  if (isNaN(num)) return String(amount);
  const scaled = num * multiplier;
  const rounded = Math.round(scaled * 100) / 100;
  return String(rounded).replace('.', ',');
}

// ── RECIPE RHYTHM BAR ───────────────────────────────────────

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

function stepDurRhythm(step: any): number {
  const min = parseInt(step.duration_min);
  const max = parseInt(step.duration_max);
  if (!isNaN(min) && !isNaN(max)) return Math.round((min + max) / 2);
  return parseInt(step.duration) || 0;
}
function normalizeNameRhythm(name: string): string {
  return name.toLowerCase().replace(/^\d+\.\s*/, "").replace(/\bstufe\s+\d+\b/g, "")
    .replace(/\breifer?\b/g, "").replace(/\bfrischer?\b/g, "").replace(/\bfertig[a-z]*\b/g, "")
    .replace(/\s+/g, " ").trim();
}
function isBakingStepRhythm(step: any): boolean {
  const instr = (step.instruction || "").toLowerCase();
  return /\bbac?k(en|t|st)?\b/.test(instr) && step.type !== "Warten" && step.type !== "Ruhen";
}
function fmtRhythm(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
function buildRows(doughSections: any[]): { rows: SectionRow[]; totalMin: number } {
  if (!doughSections?.length) return { rows: [], totalMin: 0 };
  const phaseNames = doughSections.map((s: any) => s.name as string);
  const deps: Record<string, string[]> = {};
  doughSections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      [ing.name || "", ing.temperature || ""].forEach((candidate) => {
        const ingName = normalizeNameRhythm(candidate);
        phaseNames.forEach((otherName) => {
          if (otherName === section.name) return;
          const normOther = normalizeNameRhythm(otherName);
          if (normOther.length < 4) return;
          const wb = new RegExp(`(?:^|\\s)${normOther.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`);
          if ((wb.test(ingName) || ingName === normOther) && !deps[section.name].includes(otherName))
            deps[section.name].push(otherName);
        });
      });
    });
  });
  const sectionMap = Object.fromEntries(doughSections.map((s: any) => [s.name, s]));
  const endO: Record<string, number> = {};
  const startO: Record<string, number> = {};
  function calcEndR(name: string, vis = new Set<string>()): number {
    if (name in endO) return endO[name];
    if (vis.has(name)) return 0;
    vis.add(name);
    const dependents = phaseNames.filter((n) => deps[n]?.includes(name));
    endO[name] = dependents.length === 0 ? 0 : Math.min(...dependents.map((d) => calcStartR(d, new Set(vis))));
    return endO[name];
  }
  function calcStartR(name: string, vis = new Set<string>()): number {
    if (name in startO) return startO[name];
    const dur = (sectionMap[name]?.steps || []).reduce((s: number, st: any) => s + stepDurRhythm(st), 0);
    startO[name] = calcEndR(name, vis) + dur;
    return startO[name];
  }
  phaseNames.forEach((n) => calcStartR(n));
  const totalDur = Math.max(...phaseNames.map((n) => startO[n] || 0));
  const rows: SectionRow[] = doughSections.map((section: any, si: number) => {
    const sectionRelStart = totalDur - (startO[section.name] || 0);
    const segments: PhaseSegment[] = [];
    let t = sectionRelStart;
    (section.steps || []).forEach((step: any) => {
      const dur = stepDurRhythm(step);
      if (dur === 0) return;
      const isRest = step.type === "Warten" || step.type === "Kühl" || step.type === "Ruhen";
      const bake = !isRest && isBakingStepRhythm(step);
      segments.push({ start: t, dur, type: isRest ? "rest" : bake ? "bake" : "action", sectionIndex: si });
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
  const mainActive = lastRow.segments.filter((s) => s.type === "action" || s.type === "bake").reduce((sum, s) => sum + s.dur, 0);
  if (mainActive > 0) parts.push(`~${fmtRhythm(mainActive)} aktiv für Hauptteig`);
  const bakeMin = lastRow.segments.filter((s) => s.type === "bake").reduce((sum, s) => sum + s.dur, 0);
  if (bakeMin > 0) parts.push(`${fmtRhythm(bakeMin)} backen`);
  return parts.join("  ·  ");
}
const RHYTHM_ROW_COLORS = ["#f0a500","#60a5fa","#a78bfa","#34d399","#fb923c"];
const RHYTHM_BAKE_COLOR = "#c0392b";

function RecipeRhythmBar({ doughSections }: { doughSections: any[] }) {
  const { rows, totalMin } = React.useMemo(() => buildRows(doughSections), [doughSections]);
  const summaryText = React.useMemo(() => buildSummary(rows, totalMin), [rows, totalMin]);
  if (!rows.length || totalMin === 0) return null;
  return (
    <div className="mb-10 p-5 bg-[#FDFCFB] dark:bg-gray-800/50 rounded-2xl border border-[#8B4513]/5 dark:border-[#8B4513]/20">
      <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4 flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[#8B7355]">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M6 3v3l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        Tagesrhythmus
      </h3>
      <div className="flex flex-col gap-[5px]">
        {rows.map((row, ri) => {
          const color = RHYTHM_ROW_COLORS[ri % RHYTHM_ROW_COLORS.length];
          return (
            <div key={ri} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 truncate text-right" style={{ width: "6rem" }} title={row.name}>
                {row.name}
              </span>
              <div className="relative flex-1 h-[14px] rounded bg-gray-100 dark:bg-gray-700/50">
                {row.segments.map((seg, si) => {
                  const left = (seg.start / totalMin) * 100;
                  const width = (seg.dur / totalMin) * 100;
                  return (
                    <div
                      key={si}
                      className={seg.type === "rest" ? "absolute top-0 h-full rounded-sm bg-black/[0.08] dark:bg-white/[0.07]" : "absolute top-0 h-full rounded-sm"}
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 0.5)}%`,
                        backgroundColor: seg.type === "bake" ? RHYTHM_BAKE_COLOR : seg.type === "action" ? color : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5" style={{ paddingLeft: "calc(6rem + 0.5rem)" }}>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">Start</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">+{fmtRhythm(totalMin)}</span>
      </div>
      {summaryText && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50">
          {summaryText.split("  ·  ").map((part, i, arr) => (
            <React.Fragment key={i}>
              <span className="font-semibold text-gray-700 dark:text-gray-300">{part}</span>
              {i < arr.length - 1 && <span className="mx-1.5 text-gray-300 dark:text-gray-600">·</span>}
            </React.Fragment>
          ))}
        </p>
      )}
    </div>
  );
}

// ── SCALER BAR ───────────────────────────────────────────────
function ScalerBar({ multiplier, onChange }: { multiplier: number; onChange: (v: number) => void }) {
  const steps = [0.5, 1, 2, 3, 4];
  return (
    <div className="print-hide flex items-center gap-2 mb-10 flex-wrap">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mr-2">Menge</span>
      {steps.map(step => (
        <button
          key={step}
          onClick={() => onChange(step)}
          className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
            multiplier === step
              ? 'bg-[#8B4513] text-white shadow-sm'
              : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:border-[#8B4513]/40 dark:hover:border-[#C4A484]/40'
          }`}
        >
          {step === 1 ? '× 1' : `× ${step}`}
        </button>
      ))}
      {multiplier !== 1 && (
        <span className="ml-auto text-[10px] font-bold text-[#8B4513] dark:text-[#C4A484] bg-[#8B4513]/10 dark:bg-[#8B4513]/20 px-2 py-1 rounded-lg">
          {multiplier > 1 ? `${multiplier}× Menge` : `½ Menge`}
        </span>
      )}
    </div>
  );
}

// ── EINSTELLUNGEN (localStorage) ────────────────────────────
const SETTINGS_KEY = 'crumb_settings';
const loadSettings = () => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch { return {}; }
};
const saveSettings = (settings: Record<string, any>) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

// ── HAUPT-KOMPONENTE ─────────────────────────────────────────
export default function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;
  const router = useRouter();

  const [recipe, setRecipe] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [targetTime, setTargetTime] = useState("");
  const [showBakersPercent, setShowBakersPercent] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [multiplier, setMultiplier] = useState(1);
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([0]));

  const toggleSection = (idx: number) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  useEffect(() => {
    setShowBakersPercent(!!loadSettings().showBakersPercent);
    const onStorage = () => setShowBakersPercent(!!loadSettings().showBakersPercent);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleBakersPercent = () => {
    const next = !showBakersPercent;
    setShowBakersPercent(next);
    const settings = loadSettings();
    saveSettings({ ...settings, showBakersPercent: next });
  };

  useEffect(() => {
    if (!id) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
    })
      .then(res => res.json())
      .then(data => { setRecipe(data); setIsFavorite(!data.is_favorite); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, [id]);

  const stats = useMemo(() => {
    if (!recipe?.dough_sections) return { steps: 0, duration: 0, durationMin: 0, durationMax: 0, hydration: null };
    const steps = recipe.dough_sections.reduce(
      (s: number, sec: any) => s + (sec.steps?.length || 0), 0
    );
    const duration = calcTotalDuration(recipe.dough_sections);
    const { min: durationMin, max: durationMax } = calcTotalDurationRange(recipe.dough_sections);
    const hydration = calcHydration(recipe.dough_sections);
    return { steps, duration, durationMin, durationMax, hydration };
  }, [recipe]);

  const toggleFavorite = async () => {
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ is_favorite: next }),
      });
    } catch (err) { setIsFavorite(!next); console.error(err); }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
      });
      if (res.ok) { router.push('/'); router.refresh(); }
      else console.error("Fehler beim Löschen.");
    } catch (err) { console.error(err); }
  };

  const handlePrint = () => {
    setShowMenu(false);
    setTimeout(() => window.print(), 100);
  };

  const totalIngredients = useMemo(() => {
    if (!recipe?.dough_sections) return [];
    const totals: Record<string, { name: string; amount: number; unit: string }> = {};
    recipe.dough_sections.forEach((section: any) => {
      section.ingredients?.forEach((ing: any) => {
        const rawName = (ing.name || "").trim();
        if (!rawName) return;
        const nameLower = rawName.toLowerCase();
        const isIntermediate =
          /\b(?:reife[rs]?|gereifter?)\b/i.test(rawName) ||
          recipe.dough_sections.some((sec: any) =>
            sec.name.toLowerCase() !== section.name.toLowerCase() &&
            nameLower.includes(sec.name.toLowerCase())
          );
        if (isIntermediate) return;
        const key = nameLower;
        const parsed = parseFloat(String(ing.amount || '0').replace(',', '.'));
        const num = isNaN(parsed) ? 0 : parsed;
        if (!totals[key]) {
          totals[key] = { name: rawName, amount: num, unit: ing.unit || '' };
        } else {
          totals[key].amount = Math.round((totals[key].amount + num) * 1000) / 1000;
        }
      });
    });
    return Object.values(totals).map(ing => ({
      ...ing,
      amount: ing.amount === 0 ? '' : String(ing.amount).replace('.', ',')
    }));
  }, [recipe]);

  if (isLoading) return <RecipeDetailSkeleton />;
  if (!recipe) return <div className="p-20 text-center">Rezept nicht gefunden.</div>;

  return (
    <div className="print-card-wrapper min-h-screen bg-[#F8F9FA] dark:bg-gray-900 py-8 px-4 text-[#2D2D2D] dark:text-gray-100 transition-colors duration-200">
      <div className="print-card max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-[2rem] shadow-xl overflow-hidden border border-gray-100 dark:border-gray-700 transition-colors duration-200">

        {/* HERO IMAGE */}
        <div className="print-hero relative h-96 w-full rounded-[1.5rem] overflow-hidden">
          <img
            src={recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=2072&auto=format&fit=crop'}
            className="w-full h-full object-cover object-[center_65%]"
            alt={recipe.title}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 from-[0%] via-black/25 via-[45%] to-black/15 pointer-events-none" />

          <Link href="/" className="no-print absolute top-4 left-4 z-10 p-2.5 bg-white/90 dark:bg-gray-900/80 backdrop-blur-sm rounded-xl border border-white/50 dark:border-gray-700/50 shadow-sm hover:bg-white dark:hover:bg-gray-900 transition-colors">
            <Icons.ChevronLeft size={20} className="text-gray-700 dark:text-gray-200" />
          </Link>

          <div className="no-print absolute top-4 right-4 z-10 flex gap-2">
            <button
              onClick={toggleFavorite}
              className="p-2.5 bg-white/90 dark:bg-gray-900/80 backdrop-blur-sm rounded-xl border border-white/50 dark:border-gray-700/50 shadow-sm transition-all hover:scale-110"
            >
              <Icons.Heart size={18} className={isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-500 dark:text-gray-400'} />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowMenu(v => !v)}
                className="p-2.5 bg-white/90 dark:bg-gray-900/80 backdrop-blur-sm rounded-xl border border-white/50 dark:border-gray-700/50 shadow-sm hover:bg-white dark:hover:bg-gray-900 transition-colors"
              >
                <Icons.MoreVertical size={18} className="text-gray-700 dark:text-gray-200" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 z-20 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden min-w-[200px]">
                    <button
                      onClick={() => { router.push(`/recipes/${id}/edit`); setShowMenu(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b border-gray-100 dark:border-gray-700"
                    >
                      <Icons.Edit3 size={15} className="text-gray-400" />
                      <span className="text-sm font-medium">Bearbeiten</span>
                    </button>
                    <button
                      onClick={handlePrint}
                      className="w-full flex items-center gap-3 px-4 py-3 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b border-gray-100 dark:border-gray-700"
                    >
                      <Icons.Printer size={15} className="text-gray-400" />
                      <span className="text-sm font-medium">Drucken / PDF</span>
                    </button>
                    <button
                      onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Icons.Trash2 size={15} />
                      <span className="text-sm font-semibold">Rezept löschen</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 z-10 px-6 pb-6 pt-20">
            <div className="flex items-end justify-between">
              <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">{recipe.title}</h1>
              {(() => {
                const url = recipe.original_source_url || recipe.source_url;
                try {
                  return url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] font-medium text-white/50 hover:text-white/80 transition-colors whitespace-nowrap ml-4 mb-0.5 flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}>
                      {new URL(url).hostname.replace('www.', '')}
                      <Icons.ExternalLink size={9} />
                    </a>
                  ) : null;
                } catch { return null; }
              })()}
            </div>
          </div>
        </div>

        <div className="p-6 md:p-10">

          {recipe.description && <DescriptionBox description={recipe.description} />}

          {/* GESAMT-ZUTATENLISTE */}
          {totalIngredients.length > 0 && (
            <div className="mb-10 p-6 bg-gray-50 dark:bg-gray-700 rounded-[1.5rem] border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black uppercase text-gray-400 dark:text-gray-400 tracking-widest flex items-center gap-2">
                  <Icons.ShoppingCart size={14} /> Was du brauchst
                </h3>
                <div className="no-print flex items-center gap-1.5">
                  {[0.5, 1, 2, 3, 4].map(step => (
                    <button
                      key={step}
                      onClick={() => setMultiplier(step)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all ${
                        multiplier === step
                          ? 'bg-[#8B4513] text-white shadow-sm'
                          : 'bg-white dark:bg-gray-600 text-gray-500 dark:text-gray-300 border border-gray-200 dark:border-gray-500 hover:border-[#8B4513]/40'
                      }`}
                    >
                      {step === 1 ? '×1' : `×${step}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {totalIngredients.map((ing, i) => {
                  const scaledAmount = scaleAmount(ing.amount, multiplier);
                  return (
                    <div key={i} className="flex flex-col border-l-2 border-[#8B4513]/20 dark:border-[#8B4513]/20 pl-3">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{ing.name}</span>
                      <span className="font-bold text-sm text-gray-800 dark:text-gray-100">
                        {scaledAmount} {String(ing.amount || '').includes(ing.unit) ? '' : ing.unit || ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* INFO BAR */}
          <div className="bg-[#FDFCFB] dark:bg-gray-800/50 rounded-2xl p-6 border border-[#8B4513]/5 dark:border-[#8B4513]/20 flex justify-around items-center mb-10">
            <div className="flex flex-col items-center gap-2">
              <div className="text-[#8B4513] dark:text-[#C4A484]"><Icons.Clock size={22} /></div>
              <div className="text-center">
                <p className="text-[9px] text-gray-400 dark:text-gray-400 uppercase font-black tracking-widest">Dauer</p>
                <p className="font-black text-gray-800 dark:text-gray-100 text-sm">
                  {stats.durationMin !== stats.durationMax
                    ? `${Math.floor(stats.durationMin / 60)}–${Math.floor(stats.durationMax / 60)} h`
                    : stats.duration >= 60
                      ? `${Math.floor(stats.duration / 60)} h${stats.duration % 60 > 0 ? ` ${stats.duration % 60} min` : ''}`
                      : `${stats.duration} min`}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="text-[#8B4513] dark:text-[#C4A484]"><Icons.ListChecks size={22} /></div>
              <div className="text-center">
                <p className="text-[9px] text-gray-400 dark:text-gray-400 uppercase font-black tracking-widest">Schritte</p>
                <p className="font-black text-gray-800 dark:text-gray-100 text-sm">{stats.steps}</p>
              </div>
            </div>
            {stats.hydration !== null && (
              <div className="flex flex-col items-center gap-2">
                <div className="text-blue-500 dark:text-blue-400"><Icons.Droplets size={22} /></div>
                <div className="text-center">
                  <p className="text-[9px] text-gray-400 dark:text-gray-400 uppercase font-black tracking-widest">Hydration</p>
                  <p className="font-black text-blue-500 dark:text-blue-400 text-sm">{stats.hydration}%</p>
                </div>
              </div>
            )}
            <div className="no-print flex flex-col items-center gap-2 cursor-pointer" onClick={toggleBakersPercent}>
              <div className={showBakersPercent ? 'text-[#8B4513] dark:text-[#C4A484]' : 'text-gray-300 dark:text-gray-600'}>
                <Icons.Percent size={22} />
              </div>
              <div className="text-center">
                <p className="text-[9px] text-gray-400 dark:text-gray-400 uppercase font-black tracking-widest">Bäcker-%</p>
                <p className={`font-black text-sm ${showBakersPercent ? 'text-[#8B4513] dark:text-[#C4A484]' : 'text-gray-300 dark:text-gray-600'}`}>
                  {showBakersPercent ? 'An' : 'Aus'}
                </p>
              </div>
            </div>
          </div>

          {/* TAGESRHYTHMUS */}
          <RecipeRhythmBar doughSections={recipe.dough_sections ?? []} />

          {/* PHASEN LOOP – Akkordeon */}
          {(() => {
            const parallelCount = (recipe.dough_sections || []).filter((s: any) => s.is_parallel).length;
            return (
          <div className="space-y-3">
            {recipe.dough_sections?.map((section: any, sIdx: number) => {
              const isParallel = !!section.is_parallel && parallelCount > 1;
              const isOpen = openSections.has(sIdx);
              const flourBase = calcFlourBase(section.ingredients || []) * multiplier;
              const stepCount = section.steps?.length ?? 0;
              const ingCount = section.ingredients?.length ?? 0;
              const totalDur = (section.steps || []).reduce((s: number, st: any) => {
                const min = parseInt(st.duration_min), max = parseInt(st.duration_max);
                const dur = (!isNaN(min) && !isNaN(max)) ? Math.round((min + max) / 2) : (parseInt(st.duration) || 0);
                return s + dur;
              }, 0);
              const durLabel = totalDur >= 60
                ? `${Math.floor(totalDur / 60)} h${totalDur % 60 > 0 ? ` ${totalDur % 60} min` : ''}`
                : totalDur > 0 ? `${totalDur} min` : null;

              return (
                <section
                  key={sIdx}
                  className={`print-section rounded-2xl overflow-hidden transition-colors ${
                    isParallel
                      ? 'border-l-[3px] border-l-blue-400 dark:border-l-blue-500 border border-gray-100 dark:border-gray-700'
                      : 'border border-gray-100 dark:border-gray-700'
                  } bg-white dark:bg-gray-800`}
                >
                  {/* HEADER */}
                  <button
                    onClick={() => toggleSection(sIdx)}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0 ${
                      isParallel ? 'bg-blue-500 dark:bg-blue-600' : 'bg-[#8B4513]'
                    }`}>
                      {sIdx + 1}
                    </span>
                    <span className="flex-1 text-sm font-black uppercase tracking-wide text-gray-800 dark:text-gray-100">
                      {section.name}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                      {isParallel && (
                        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
                          parallel
                        </span>
                      )}
                      {durLabel && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                          {durLabel}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                        {ingCount} Zutaten · {stepCount} Schritte
                      </span>
                      <Icons.ChevronDown
                        size={16}
                        className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>

                  {/* BODY */}
                  {isOpen && (
                    <div className="print-phase-grid grid lg:grid-cols-2 gap-8 px-5 pb-6 border-t border-gray-100 dark:border-gray-700 pt-5">

                      {/* ZUTATEN */}
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold uppercase text-gray-300 dark:text-gray-500 tracking-widest block mb-2">Zutaten</span>

                        {showBakersPercent && flourBase > 0 && (
                          <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-gray-300 dark:text-gray-600 pb-1 border-b border-gray-100 dark:border-gray-700">
                            <span className="flex-1">Zutat</span>
                            <span className="w-16 text-right">Menge</span>
                            <span className="w-12 text-right">%</span>
                          </div>
                        )}

                        {section.ingredients?.map((ing: any, iIdx: number) => {
                          const amountNum = parseFloat(String(ing.amount || '0').replace(',', '.'));
                          const scaledNum = isNaN(amountNum) ? 0 : amountNum * multiplier;
                          const scaledDisplay = scaleAmount(ing.amount, multiplier);
                          const pct = showBakersPercent && flourBase > 0
                            ? toBakersPercent(scaledNum, flourBase)
                            : null;

                          return (
                            <div key={iIdx} className="flex justify-between border-b border-gray-50 dark:border-gray-700 py-1.5 text-sm items-baseline">
                              <span className="flex-1 text-gray-600 dark:text-gray-300">
                                {ing.name}
                                {ing.temperature && (
                                  <span className="ml-2 text-xs font-bold text-blue-500 dark:text-blue-400">
                                    {ing.temperature}°C
                                  </span>
                                )}
                              </span>
                              <span className={`font-black text-gray-900 dark:text-gray-100 ${pct ? 'w-16 text-right' : ''}`}>
                                {scaledDisplay} {String(ing.amount || '').includes(ing.unit) ? '' : ing.unit || ''}
                              </span>
                              {pct && (
                                <span className="w-12 text-right text-xs font-bold text-[#8B4513]/60 dark:text-[#C4A484]/60 tabular-nums">
                                  {pct}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* SCHRITTE */}
                      <div className="bg-gray-50/80 dark:bg-gray-700/50 rounded-2xl p-6 border border-gray-100/50 dark:border-gray-700">
                        <span className="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-400 tracking-widest block mb-4">Zubereitung</span>
                        <div className="space-y-5">
                          {section.steps?.map((step: any, stIdx: number) => (
                            <div key={stIdx} className="flex gap-4">
                              <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5 ${
                                step.type === 'Backen'
                                  ? 'bg-red-500 text-white border-red-500'
                                  : step.type === 'Aktion'
                                    ? 'bg-[#8B4513] text-white border-[#8B4513]'
                                    : 'bg-white dark:bg-gray-800 text-gray-400 border-gray-200 dark:border-gray-600'
                              }`}>
                                {stIdx + 1}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{step.instruction}</p>
                                {(step.duration_min !== undefined || step.duration > 0) && (
                                  <span className={`inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    step.type === 'Warten'
                                      ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                                      : step.type === 'Backen'
                                        ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                                        : 'text-gray-400 bg-gray-100 dark:bg-gray-700 dark:text-gray-500'
                                  }`}>
                                    {step.duration_min !== undefined && step.duration_max !== undefined && step.duration_min !== step.duration_max
                                      ? `${step.duration_min}–${step.duration_max} min`
                                      : `${step.duration} min`}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  )}
                </section>
              );
            })}
          </div>
            );
          })()}

        </div>
      </div>

      {/* STICKY BOTTOM BAR */}
      <div className="no-print fixed bottom-0 left-0 right-0 z-40 px-4 pb-20 md:pb-4 pt-3 bg-gradient-to-t from-white dark:from-gray-900 to-transparent pointer-events-none">
        <div className="max-w-4xl mx-auto pointer-events-auto">
          <button
            onClick={() => setShowPlanModal(true)}
            className="w-full flex items-center justify-center gap-3 bg-[#8B4513] text-white px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl hover:bg-[#6F360F] transition-all active:scale-[0.98]"
          >
            <Icons.Calendar size={18} /> In den Backplan aufnehmen
          </button>
        </div>
      </div>

      {/* PLAN MODAL */}
      <PlanModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        recipe={recipe}
        onConfirm={async (plannedAt, multiplierValue, timeline) => {
          try {
            let timelineToSave = timeline ?? null;
            if (!timelineToSave) {
              try {
                const nightRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}/plan-night`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
                  body: JSON.stringify({ nightWindow: { start: '22:00', end: '06:30' }, targetEndTime: plannedAt }),
                });
                if (nightRes.ok) {
                  const nightData = await nightRes.json();
                  if (nightData.viable && nightData.plan?.length > 0) timelineToSave = nightData.plan;
                }
              } catch {}
            }
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('crumb_token')}`
              },
              body: JSON.stringify({
                planned_at: plannedAt,
                planned_timeline: timelineToSave,
                multiplier: multiplierValue ?? multiplier,
              }),
            });
            if (res.ok) {
              setTargetTime(plannedAt);
              setShowPlanModal(false);
              fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
              }).then(r => r.json()).then(data => { setRecipe(data); });
              router.refresh();
            }
          } catch (err) { console.error(err); }
        }}
      />

      {/* DELETE CONFIRMATION */}
      {showDeleteConfirm && (
        <DeleteConfirmModal
          recipeName={recipe.title}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}