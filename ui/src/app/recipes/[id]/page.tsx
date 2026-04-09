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

// ÄNDERUNG 4: Beschreibungsbox — neutralisiert auf dunkle Oberfläche
function DescriptionBox({ description }: { description: string }) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const preview = description.substring(0, 150);
  const needsExpansion = description.length > 150;
  return (
    <div className="mb-10 p-6 bg-white/[0.04] rounded-2xl border border-white/[0.07]">
      <p className="print-description-full hidden text-sm text-white/70 leading-relaxed whitespace-pre-line">
        {description}
      </p>
      <p className="print-description-preview text-sm text-white/70 leading-relaxed whitespace-pre-line">
        {isExpanded ? description : preview + (needsExpansion ? '...' : '')}
      </p>
      {needsExpansion && (
        <button onClick={() => setIsExpanded(!isExpanded)}
          className="print-description-toggle mt-3 text-xs font-bold text-[#C4A484]/70 hover:text-[#C4A484] flex items-center gap-1 transition-colors">
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-gray-900 rounded-2xl shadow-2xl border border-white/10 p-6 max-w-sm w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
            <Icons.Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <h3 className="font-black text-white/90 text-sm">Rezept löschen?</h3>
            <p className="text-xs text-white/40 mt-0.5">Diese Aktion kann nicht rückgängig gemacht werden.</p>
          </div>
        </div>
        <p className="text-sm text-white/70 mb-6 bg-white/[0.04] rounded-xl px-4 py-3 font-medium border border-white/[0.07]">
          „{recipeName}"
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-bold text-white/60 hover:bg-white/[0.05] transition-colors">
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

// ÄNDERUNG 2: #8B4513 → #8B7355
function ScalerBar({ multiplier, onChange }: { multiplier: number; onChange: (v: number) => void }) {
  return (
    <div className="mb-10 flex items-center gap-4 p-4 bg-white/[0.04] rounded-2xl border border-white/[0.07]">
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/30">
        <Icons.Scale size={13} />
        Menge
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {MULTIPLIER_STEPS.map(step => (
          <button key={step} onClick={() => onChange(step)}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
              multiplier === step
                ? 'bg-[#8B7355] text-white shadow-sm'
                : 'bg-white/[0.05] text-white/50 border border-white/[0.08] hover:border-[#8B7355]/40'
            }`}>
            {step === 1 ? '× 1' : `× ${step}`}
          </button>
        ))}
      </div>
      {multiplier !== 1 && (
        <span className="ml-auto text-[10px] font-bold text-[#C4A484] bg-[#C4A484]/10 px-2 py-1 rounded-lg">
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
  if (!recipe) return <div className="p-20 text-center text-white/40">Rezept nicht gefunden.</div>;

  return (
    // ÄNDERUNG 1: Card-Wrapper entfernt — direkt auf #0F172A, kein weißes rounded-card
    <div className="print-card-wrapper min-h-screen bg-[#0F172A] py-8 px-4 text-white transition-colors duration-200">
      <div className="print-card max-w-4xl mx-auto">

        {/* HERO IMAGE */}
        <div className="print-hero relative h-96 w-full rounded-[2rem] overflow-hidden mb-8">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=2072&auto=format&fit=crop'})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center 65%',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 from-[0%] via-black/25 via-[45%] to-black/15 pointer-events-none" />

          <Link href="/" className="no-print absolute top-4 left-4 z-10 p-2.5 bg-black/40 backdrop-blur-sm rounded-xl border border-white/20 shadow-sm hover:bg-black/60 transition-colors">
            <Icons.ChevronLeft size={20} className="text-white/80" />
          </Link>

          <div className="no-print absolute top-4 right-4 z-10 flex gap-2">
            <button onClick={toggleFavorite}
              className="p-2.5 bg-black/40 backdrop-blur-sm rounded-xl border border-white/20 shadow-sm transition-all hover:scale-110">
              <Icons.Heart size={18} className={isFavorite ? 'fill-red-500 text-red-500' : 'text-white/70'} />
            </button>
            <div className="relative">
              <button onClick={() => setShowMenu(v => !v)}
                className="p-2.5 bg-black/40 backdrop-blur-sm rounded-xl border border-white/20 shadow-sm hover:bg-black/60 transition-colors">
                <Icons.MoreVertical size={18} className="text-white/80" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 z-20 bg-gray-900 rounded-2xl shadow-xl border border-white/10 overflow-hidden min-w-[200px]">
                    <button onClick={() => { router.push(`/recipes/${id}/edit`); setShowMenu(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-white/70 hover:bg-white/[0.06] transition-colors border-b border-white/[0.07]">
                      <Icons.Edit3 size={15} className="text-white/30" />
                      <span className="text-sm font-medium">Bearbeiten</span>
                    </button>
                    <button onClick={handlePrint}
                      className="w-full flex items-center gap-3 px-4 py-3 text-white/70 hover:bg-white/[0.06] transition-colors border-b border-white/[0.07]">
                      <Icons.Printer size={15} className="text-white/30" />
                      <span className="text-sm font-medium">Drucken / PDF</span>
                    </button>
                    <button onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 transition-colors">
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
              {/* ÄNDERUNG 5: DM Serif Display für Hero-Titel */}
              <h1
                className="text-3xl md:text-4xl text-white tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]"
                style={{ fontFamily: 'var(--font-dm-serif), serif' }}
              >{recipe.title}</h1>
              {(() => {
                const url = recipe.original_source_url || recipe.source_url;
                try {
                  return url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] font-medium text-white/40 hover:text-white/70 transition-colors whitespace-nowrap ml-4 mb-0.5 flex-shrink-0"
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

        <div className="p-0 md:px-2">

          {recipe.description && <DescriptionBox description={recipe.description} />}

          {/* GESAMT-ZUTATENLISTE */}
          {totalIngredients.length > 0 && (
            <div className="mb-10 p-6 bg-white/[0.04] rounded-[1.5rem] border border-white/[0.07]">
              <h3 className="text-[10px] font-black uppercase text-white/30 tracking-widest mb-4 flex items-center gap-2">
                <Icons.ShoppingCart size={14} /> Was du brauchst
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {totalIngredients.map((ing, i) => {
                  const scaledAmount = scaleAmount(ing.amount, multiplier);
                  return (
                    <div key={i} className="flex flex-col border-l-2 border-[#8B7355]/30 pl-3">
                      <span className="text-xs text-white/40">{ing.name}</span>
                      <span className="font-bold text-sm text-white/90">
                        {scaledAmount} {String(ing.amount || '').includes(ing.unit) ? '' : ing.unit || ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* INFO BAR */}
          <div className="bg-white/[0.04] rounded-2xl p-6 border border-white/[0.07] flex justify-around items-center mb-10">
            <div className="flex flex-col items-center gap-2">
              <div className="text-[#C4A484]"><Icons.Clock size={22} /></div>
              <div className="text-center">
                <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Dauer</p>
                <p className="font-black text-white/90 text-sm">
                  {stats.durationMin !== stats.durationMax
                    ? `${formatDuration(stats.durationMin)} – ${formatDuration(stats.durationMax)}`
                    : formatDuration(stats.duration)}
                </p>
              </div>
            </div>
            <div className="h-8 w-px bg-white/[0.07]" />
            <div className="flex flex-col items-center gap-2">
              <div className="text-[#C4A484]"><Icons.Layers size={22} /></div>
              <div className="text-center">
                <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Schritte</p>
                <p className="font-black text-white/90 text-sm">{stats.steps}</p>
              </div>
            </div>
            {stats.hydration !== null && (
              <>
                <div className="h-8 w-px bg-white/[0.07]" />
                <div className="flex flex-col items-center gap-2">
                  <div className="text-blue-400"><Icons.Droplets size={22} /></div>
                  <div className="text-center">
                    <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Hydration</p>
                    <p className="font-black text-white/90 text-sm">{stats.hydration}%</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ÄNDERUNG 4: BACKPLAN ANZEIGE — neutralisiert auf dunkle Oberfläche */}
          {calculatedTimeline.length > 0 && (
            <div className="print-hide mb-10 bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6">
              <h3 className="font-black text-[#C4A484]/70 mb-4 flex items-center gap-2 text-xs uppercase tracking-widest">
                <Icons.Calendar size={16} /> Dein Zeitplan
              </h3>
              <div className="space-y-3">
                {calculatedTimeline.map((item, i) => (
                  <div key={i} className="flex justify-between items-center text-xs border-b border-white/[0.05] pb-2">
                    <span className="font-black text-[#C4A484] w-16">{formatTimeManual(item.start)}</span>
                    <span className="flex-1 px-4 text-white/60 font-medium">{item.instruction}</span>
                    <span className="text-[#C4A484]/50 text-[9px] uppercase font-bold bg-white/[0.04] px-2 py-0.5 rounded">{item.phase}</span>
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
                    {/* ÄNDERUNG 2: #8B4513 → #8B7355 */}
                    <span className="bg-[#8B7355] text-white w-8 h-8 rounded-full flex items-center justify-center font-black text-sm shadow-sm flex-shrink-0">{sIdx + 1}</span>
                    <h2 className="text-lg font-black uppercase text-white/90 tracking-wide">{section.name}</h2>
                    {showBakersPercent && flourBase > 0 && (
                      <span className="text-[10px] text-white/30 font-bold">
                        Mehl {flourBase}g = 100%
                      </span>
                    )}
                    <div className="grow h-px bg-white/[0.07]" />
                  </div>

                  <div className="print-phase-grid grid lg:grid-cols-2 gap-8">
                    {/* ZUTATEN */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold uppercase text-white/25 tracking-widest block mb-2">Zutaten</span>

                      {showBakersPercent && flourBase > 0 && (
                        <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-white/20 pb-1 border-b border-white/[0.07]">
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
                          <div key={iIdx} className="flex justify-between border-b border-white/[0.05] py-1.5 text-sm items-baseline">
                            <span className="flex-1 text-white/55">
                              {ing.name}
                              {ing.temperature && (
                                <span className="ml-2 text-xs font-bold text-blue-400">
                                  {ing.temperature}°C
                                </span>
                              )}
                            </span>
                            <span className={`font-black text-white/90 ${pct ? 'w-16 text-right' : ''}`}>
                              {scaledDisplay} {String(ing.amount || '').includes(ing.unit) ? '' : ing.unit || ''}
                            </span>
                            {pct && (
                              <span className="w-12 text-right text-xs font-bold text-[#C4A484]/50 tabular-nums">
                                {pct}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* SCHRITTE */}
                    <div className="bg-white/[0.03] rounded-2xl p-6 border border-white/[0.07]">
                      <span className="text-[10px] font-bold uppercase text-white/25 tracking-widest block mb-4">Zubereitung</span>
                      <div className="space-y-5">
                        {section.steps?.map((step: any, stIdx: number) => (
                          <div key={stIdx} className="flex gap-4">
                            {/* ÄNDERUNG 2: #8B4513 → #8B7355 */}
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                              step.type === 'Backen'
                                ? 'bg-red-500 text-white'
                                : step.type === 'Aktion'
                                  ? 'bg-[#8B7355] text-white'
                                  : 'bg-white/[0.08] text-white/40 border border-white/[0.1]'
                            }`}>
                              {stIdx + 1}
                            </div>
                            <div>
                              <p className="text-xs text-white/70 leading-relaxed">{step.instruction}</p>
                              <span className="text-xs font-black uppercase text-[#C4A484]/50 mt-1 block">
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

        {/* ÄNDERUNG 3: Sticky Bottom Bar — Gradient von #0F172A */}
        <div className="no-print sticky bottom-0 z-40 px-6 pb-6 pt-3 bg-gradient-to-t from-[#0F172A] via-[#0F172A]/95 to-transparent rounded-b-[2rem]">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={() => setShowPlanModal(true)}
              className="w-full flex items-center justify-center gap-3 bg-[#8B7355] text-white px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl hover:bg-[#7A6347] transition-all active:scale-[0.98]"
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
        onConfirm={async (plannedAt, multiplier, timeline) => {
          try {
            let timelineToSave = timeline?.length > 0 ? timeline : null;

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
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
              body: JSON.stringify({
                planned_at: plannedAt,
                planned_timeline: timelineToSave,
                multiplier,
              }),
            });

            if (res.ok) {
              setShowPlanModal(false);
              fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
              }).then(r => r.json()).then(data => setRecipe(data));
              router.refresh();
            }
          } catch (err) { console.error(err); }
        }}
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