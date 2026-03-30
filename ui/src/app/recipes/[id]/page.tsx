"use client";

import React, { useEffect, useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as Icons from 'lucide-react';
import { calculateBackplan, calcTotalDuration, calcTotalDurationRange, parseLocalDate } from '@/lib/backplan-utils';
import { calcHydration, FLOUR_KEYWORDS } from '@/lib/hydration';
import PlanModal from "@/components/PlanModal";
import BakeHistory from '@/components/BakeHistory';
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
          {isExpanded ? <><Icons.ChevronUp size={14} />Weniger anzeigen</> : <><Icons.ChevronDown size={14} />Mehr lesen</>}
        </button>
      )}
    </div>
  );
}

function formatDuration(minutes: number): string {
  if (!minutes || minutes === 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function formatStepDuration(step: any): string {
  const min = parseInt(step.duration_min);
  const max = parseInt(step.duration_max);
  if (!isNaN(min) && !isNaN(max)) {
    return `${formatDuration(min)} – ${formatDuration(max)}`;
  }
  return formatDuration(step.duration);
}

function formatTimeManual(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function scaleAmount(rawAmount: string | number, multiplier: number): string {
  if (multiplier === 1) return String(rawAmount);
  const parsed = parseFloat(String(rawAmount || '0').replace(',', '.'));
  if (isNaN(parsed) || parsed === 0) return String(rawAmount);
  const scaled = parsed * multiplier;
  const result = Math.round(scaled * 10) / 10;
  return result % 1 === 0 ? String(result) : String(result).replace('.', ',');
}

// ── DELETE CONFIRMATION MODAL ────────────────────────────────
function DeleteConfirmModal({ recipeName, onConfirm, onCancel }: {
  recipeName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 p-6 max-w-sm w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
            <Icons.Trash2 size={18} className="text-red-500" />
          </div>
          <div>
            <h3 className="font-black text-gray-900 dark:text-gray-100 text-sm">Rezept löschen?</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Diese Aktion kann nicht rückgängig gemacht werden.</p>
          </div>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-6 bg-gray-50 dark:bg-gray-700/50 rounded-xl px-4 py-3 font-medium">
          „{recipeName}"
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            Abbrechen
          </button>
          <button onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-black transition-colors">
            Löschen
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SKALIERUNGS-STEPPER ──────────────────────────────────────
const MULTIPLIER_STEPS = [0.5, 1, 1.5, 2, 3];

function ScalerBar({ multiplier, onChange }: { multiplier: number; onChange: (v: number) => void }) {
  return (
    <div className="mb-10 flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-2xl border border-gray-100 dark:border-gray-700">
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">
        <Icons.Scale size={13} />
        Menge
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {MULTIPLIER_STEPS.map(step => (
          <button key={step} onClick={() => onChange(step)}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
              multiplier === step
                ? 'bg-[#8B4513] text-white shadow-sm'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:border-[#8B4513]/40 dark:hover:border-[#C4A484]/40'
            }`}>
            {step === 1 ? '× 1' : `× ${step}`}
          </button>
        ))}
      </div>
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
  const [showBakersPercent, setShowBakersPercent] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [multiplier, setMultiplier] = useState(1);

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
      .then(data => { setRecipe(data); setIsFavorite(!!data.is_favorite); setIsLoading(false); })
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

  const calculatedTimeline = useMemo(() => {
    if (!recipe?.planned_at || !recipe?.dough_sections) return [];
    return calculateBackplan(parseLocalDate(recipe.planned_at), recipe.dough_sections);
  }, [recipe?.planned_at, recipe?.dough_sections]);

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
            <button onClick={toggleFavorite}
              className="p-2.5 bg-white/90 dark:bg-gray-900/80 backdrop-blur-sm rounded-xl border border-white/50 dark:border-gray-700/50 shadow-sm transition-all hover:scale-110">
              <Icons.Heart size={18} className={isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-500 dark:text-gray-400'} />
            </button>
            <div className="relative">
              <button onClick={() => setShowMenu(v => !v)}
                className="p-2.5 bg-white/90 dark:bg-gray-900/80 backdrop-blur-sm rounded-xl border border-white/50 dark:border-gray-700/50 shadow-sm hover:bg-white dark:hover:bg-gray-900 transition-colors">
                <Icons.MoreVertical size={18} className="text-gray-700 dark:text-gray-200" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 z-20 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden min-w-[200px]">
                    <button onClick={() => { router.push(`/recipes/${id}/edit`); setShowMenu(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b border-gray-100 dark:border-gray-700">
                      <Icons.Edit3 size={15} className="text-gray-400" />
                      <span className="text-sm font-medium">Bearbeiten</span>
                    </button>
                    <button onClick={handlePrint}
                      className="w-full flex items-center gap-3 px-4 py-3 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b border-gray-100 dark:border-gray-700">
                      <Icons.Printer size={15} className="text-gray-400" />
                      <span className="text-sm font-medium">Drucken / PDF</span>
                    </button>
                    <button onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
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
              <h3 className="text-[10px] font-black uppercase text-gray-400 dark:text-gray-400 tracking-widest mb-4 flex items-center gap-2">
                <Icons.ShoppingCart size={14} /> Was du brauchst
              </h3>
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
                    ? `${formatDuration(stats.durationMin)} – ${formatDuration(stats.durationMax)}`
                    : formatDuration(stats.duration)}
                </p>
              </div>
            </div>
            <div className="h-8 w-px bg-gray-100 dark:bg-gray-700" />
            <div className="flex flex-col items-center gap-2">
              <div className="text-[#8B4513] dark:text-[#C4A484]"><Icons.Layers size={22} /></div>
              <div className="text-center">
                <p className="text-[9px] text-gray-400 dark:text-gray-400 uppercase font-black tracking-widest">Schritte</p>
                <p className="font-black text-gray-800 dark:text-gray-100 text-sm">{stats.steps}</p>
              </div>
            </div>
            {stats.hydration !== null && (
              <>
                <div className="h-8 w-px bg-gray-100 dark:bg-gray-700" />
                <div className="flex flex-col items-center gap-2">
                  <div className="text-blue-400 dark:text-blue-400"><Icons.Droplets size={22} /></div>
                  <div className="text-center">
                    <p className="text-[9px] text-gray-400 dark:text-gray-400 uppercase font-black tracking-widest">Hydration</p>
                    <p className="font-black text-gray-800 dark:text-gray-100 text-sm">{stats.hydration}%</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* BACKPLAN ANZEIGE */}
          {calculatedTimeline.length > 0 && (
            <div className="print-hide mb-10 bg-orange-50/50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800 rounded-2xl p-6">
              <h3 className="font-black text-orange-800 dark:text-orange-200 mb-4 flex items-center gap-2 text-xs uppercase tracking-widest">
                <Icons.Calendar size={16} /> Dein Zeitplan
              </h3>
              <div className="space-y-3">
                {calculatedTimeline.map((item, i) => (
                  <div key={i} className="flex justify-between items-center text-xs border-b border-orange-100/50 dark:border-orange-800/50 pb-2">
                    <span className="font-black text-orange-900 dark:text-orange-100 w-16">{formatTimeManual(item.start)}</span>
                    <span className="flex-1 px-4 text-orange-800 dark:text-orange-200 font-medium">{item.instruction}</span>
                    <span className="text-orange-400 dark:text-orange-400 text-[9px] uppercase font-bold bg-white dark:bg-gray-800 px-2 py-0.5 rounded shadow-sm">{item.phase}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SKALIERUNGS-STEPPER */}
          <div className="print-hide"><ScalerBar multiplier={multiplier} onChange={setMultiplier} /></div>

          {/* PHASEN LOOP */}
          <div className="space-y-12">
            {recipe.dough_sections?.map((section: any, sIdx: number) => {
              const flourBase = calcFlourBase(section.ingredients || []) * multiplier;

              return (
                <section key={sIdx} className="print-section">
                  <div className="flex items-center gap-4 mb-6">
                    <span className="bg-[#8B4513] text-white w-8 h-8 rounded-full flex items-center justify-center font-black text-sm shadow-sm">{sIdx + 1}</span>
                    <h2 className="text-lg font-black uppercase text-gray-800 dark:text-gray-100 tracking-wide">{section.name}</h2>
                    {showBakersPercent && flourBase > 0 && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-bold">
                        Mehl {flourBase}g = 100%
                      </span>
                    )}
                    <div className="grow h-px bg-gray-100 dark:bg-gray-700" />
                  </div>

                  <div className="print-phase-grid grid lg:grid-cols-2 gap-8">
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
                            <div className={`w-5 h-5 rounded-full border dark:border-gray-600 flex items-center justify-center text-[10px] font-black shrink-0 ${step.type === 'Backen' ? 'bg-red-500 text-white' : step.type === 'Aktion' ? 'bg-[#8B4513] text-white' : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-400'}`}>
                              {stIdx + 1}
                            </div>
                            <div>
                              <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed">{step.instruction}</p>
                              <span className="text-xs font-black uppercase text-[#8B4513]/50 dark:text-[#C4A484]/60 mt-1 block">
                                {step.type} • {formatStepDuration(step)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}

            {/* BAKE HISTORY */}
            <div className="max-w-2xl mx-auto px-5">
              <BakeHistory recipeId={parseInt(id)} />
            </div>
          </div>
        </div>

        {/* STICKY BOTTOM BAR */}
        <div className="no-print fixed bottom-0 left-0 right-0 z-40 px-4 pb-20 md:pb-4 pt-3 bg-gradient-to-t from-white dark:from-gray-900 to-transparent pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <button
              onClick={() => setShowPlanModal(true)}
              className="w-full flex items-center justify-center gap-3 bg-[#8B4513] text-white px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl hover:bg-[#6F360F] transition-all active:scale-[0.98]"
            >
              <Icons.Calendar size={18} /> In den Backplan aufnehmen
            </button>
          </div>
        </div>
      </div>

      <PlanModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        recipe={recipe}
      />

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