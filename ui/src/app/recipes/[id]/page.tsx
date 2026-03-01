"use client";

import React, { useEffect, useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as Icons from 'lucide-react';
import { calculateBackplan, formatTimeManual, calcTotalDuration } from '@/lib/backplan-utils';
import PlanModal from "@/components/PlanModal";
import { RecipeDetailSkeleton } from "@/components/LoadingSkeletons";

// ── BÄCKERPROZENTE ──────────────────────────────────────────
const FLOUR_KEYWORDS = [
  'mehl', 'schrot', 'flocken', 'kleie', 'grieß', 'stärke',
  'dinkel', 'roggen', 'weizen', 'emmer', 'einkorn', 'kamut',
  'hirse', 'buchweizen', 'hafer', 'biga', 'poolish',
];
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
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
        {isExpanded ? description : preview + (needsExpansion ? '...' : '')}
      </p>
      {needsExpansion && (
        <button onClick={() => setIsExpanded(!isExpanded)}
          className="mt-3 text-xs font-bold text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 flex items-center gap-1 transition-colors">
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
  const [calculatedTimeline, setCalculatedTimeline] = useState<any[]>([]);
  const [showBakersPercent, setShowBakersPercent] = useState(false);

  // Einstellung laden
  useEffect(() => {
    const settings = loadSettings();
    setShowBakersPercent(!!settings.showBakersPercent);
  }, []);

  const toggleBakersPercent = () => {
    const next = !showBakersPercent;
    setShowBakersPercent(next);
    const settings = loadSettings();
    saveSettings({ ...settings, showBakersPercent: next });
  };

  // Rezept laden
  useEffect(() => {
    if (!id) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
    })
      .then(res => res.json())
      .then(data => { setRecipe(data); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, [id]);

  // Statistiken
  const stats = useMemo(() => {
    if (!recipe?.dough_sections) return { steps: 0, duration: 0 };
    const steps = recipe.dough_sections.reduce(
      (s: number, sec: any) => s + (sec.steps?.length || 0), 0
    );
    const duration = calcTotalDuration(recipe.dough_sections);
    return { steps, duration };
  }, [recipe]);

  // Löschen
  const handleDelete = async () => {
    if (!window.confirm("Möchtest du dieses Rezept wirklich unwiderruflich löschen?")) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
      });
      if (res.ok) { router.push('/'); router.refresh(); }
      else alert("Fehler beim Löschen.");
    } catch (err) { console.error(err); alert("Server nicht erreichbar."); }
  };

  // Gesamt-Zutaten aggregieren
  const totalIngredients = useMemo(() => {
    if (!recipe?.dough_sections) return [];
    const totals: Record<string, { name: string; amount: number; unit: string }> = {};
    recipe.dough_sections.forEach((section: any) => {
      section.ingredients?.forEach((ing: any) => {
        const rawName = (ing.name || "").trim();
        if (!rawName ||
            rawName.toLowerCase().includes("sauerteigstufe") ||
            rawName.toLowerCase() === "vorteig" ||
            rawName.toLowerCase() === "quellstück") return;
        const key = rawName.toLowerCase();
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
    <div className="min-h-screen bg-[#F8F9FA] dark:bg-gray-900 py-8 px-4 text-[#2D2D2D] dark:text-gray-100 transition-colors duration-200">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-[2rem] shadow-xl overflow-hidden border border-gray-100 dark:border-gray-700 transition-colors duration-200">

        {/* HEADER ACTIONS */}
        <div className="flex justify-between items-center p-6 pb-2">
          <Link href="/" className="bg-gray-50 dark:bg-gray-700/50 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 transition-colors">
            <Icons.ChevronLeft size={20} className="text-gray-600 dark:text-gray-300" />
          </Link>
          <div className="flex gap-2 items-center">
            {/* Bäckerprozente Toggle */}
            <button
              onClick={toggleBakersPercent}
              title="Bäckerprozente ein/ausblenden"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                showBakersPercent
                  ? 'bg-[#8B4513] text-white border-[#8B4513]'
                  : 'bg-gray-50 dark:bg-gray-700/50 text-gray-400 dark:text-gray-400 border-gray-100 dark:border-gray-700 hover:text-[#8B4513]'
              }`}
            >
              <Icons.Percent size={14} />
              <span className="hidden sm:inline">Bäcker%</span>
            </button>
            <button onClick={() => router.push(`/recipes/${id}/edit`)}
              className="p-2.5 text-gray-400 dark:text-gray-400 hover:text-[#8B4513] border border-gray-100 dark:border-gray-700 rounded-xl transition-all">
              <Icons.Edit3 size={18} />
            </button>
            <button onClick={handleDelete}
              className="p-2.5 text-red-300 dark:text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 border border-gray-100 dark:border-gray-700 rounded-xl transition-all">
              <Icons.Trash2 size={18} />
            </button>
          </div>
        </div>

        {/* HERO IMAGE */}
        <div className="px-6">
          <img
            src={recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=2072&auto=format&fit=crop'}
            className="w-full h-[350px] object-cover rounded-[1.5rem] shadow-md border border-gray-100 dark:border-gray-700"
            alt={recipe.title}
          />
        </div>

        <div className="p-6 md:p-10">
          <h1 className="text-3xl md:text-4xl font-black text-[#2D2D2D] dark:text-gray-100 tracking-tight mb-8">{recipe.title}</h1>

          {recipe.description && <DescriptionBox description={recipe.description} />}

          {/* GESAMT-ZUTATENLISTE */}
          {totalIngredients.length > 0 && (
            <div className="mb-10 p-6 bg-gray-50 dark:bg-gray-700 rounded-[1.5rem] border border-gray-100 dark:border-gray-700">
              <h3 className="text-[10px] font-black uppercase text-gray-400 dark:text-gray-400 tracking-widest mb-4 flex items-center gap-2">
                <Icons.ShoppingCart size={14} /> Was du brauchst
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {totalIngredients.map((ing, i) => (
                  <div key={i} className="flex flex-col border-l-2 border-[#8B4513]/20 dark:border-[#8B4513]/20 pl-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400">{ing.name}</span>
                    <span className="font-bold text-sm text-gray-800 dark:text-gray-100">
                      {ing.amount} {String(ing.amount || '').includes(ing.unit) ? '' : ing.unit || ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* INFO BAR */}
          <div className="bg-[#FDFCFB] dark:bg-gray-800/50 rounded-2xl p-6 border border-[#8B4513]/5 dark:border-[#8B4513]/20 flex justify-around items-center mb-10">
            <div className="flex flex-col items-center gap-2">
              <div className="text-[#8B4513] dark:text-[#C4A484]"><Icons.Clock size={22} /></div>
              <div className="text-center">
                <p className="text-[9px] text-gray-400 dark:text-gray-400 uppercase font-black tracking-widest">Dauer</p>
                <p className="font-black text-gray-800 dark:text-gray-100 text-sm">{formatDuration(stats.duration)}</p>
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
          </div>

          {/* BACKPLAN ANZEIGE */}
          {calculatedTimeline.length > 0 && (
            <div className="mb-10 bg-orange-50/50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800 rounded-2xl p-6">
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

          {/* PHASEN LOOP */}
          <div className="space-y-12">
            {recipe.dough_sections?.map((section: any, sIdx: number) => {
              // Mehlbasis pro Phase berechnen
              const flourBase = calcFlourBase(section.ingredients || []);

              return (
                <section key={sIdx}>
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

                  <div className="grid lg:grid-cols-2 gap-8">
                    {/* ZUTATEN */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold uppercase text-gray-300 dark:text-gray-500 tracking-widest block mb-2">Zutaten</span>

                      {/* Tabellen-Header wenn Bäckerprozente aktiv */}
                      {showBakersPercent && flourBase > 0 && (
                        <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-gray-300 dark:text-gray-600 pb-1 border-b border-gray-100 dark:border-gray-700">
                          <span className="flex-1">Zutat</span>
                          <span className="w-16 text-right">Menge</span>
                          <span className="w-12 text-right">%</span>
                        </div>
                      )}

                      {section.ingredients?.map((ing: any, iIdx: number) => {
                        const amountNum = parseFloat(String(ing.amount || '0').replace(',', '.'));
                        const pct = showBakersPercent && flourBase > 0
                          ? toBakersPercent(isNaN(amountNum) ? 0 : amountNum, flourBase)
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
                              {ing.amount} {String(ing.amount || '').includes(ing.unit) ? '' : ing.unit || ''}
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
                            <div className={`w-5 h-5 rounded-full border dark:border-gray-600 flex items-center justify-center text-[10px] font-black shrink-0 ${step.type === 'Aktion' ? 'bg-[#8B4513] text-white' : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-400'}`}>
                              {stIdx + 1}
                            </div>
                            <div>
                              <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed">{step.instruction}</p>
                              <span className="text-xs font-black uppercase text-[#8B4513]/50 dark:text-[#C4A484]/60 mt-1 block">
                                {step.type} • {formatDuration(step.duration)}
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
          </div>
        </div>

        {/* FOOTER ACTION */}
        <div className="p-8 bg-gray-50/50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700 flex justify-center">
          <button
            onClick={() => setShowPlanModal(true)}
            className="flex items-center gap-3 bg-[#8B4513] text-white px-10 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg hover:bg-[#6F360F] transition-all transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <Icons.Calendar size={18} /> In den Backplan aufnehmen
          </button>
        </div>
      </div>

      <PlanModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        recipe={recipe}
        onConfirm={async (plannedAt, multiplier, timeline) => {
          try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('crumb_token')}`
              },
              body: JSON.stringify({ planned_at: plannedAt }),
            });
            if (res.ok) {
              setCalculatedTimeline(timeline);
              setTargetTime(plannedAt);
              setShowPlanModal(false);
              router.refresh();
            }
          } catch (err) { console.error(err); }
        }}
      />
    </div>
  );
}