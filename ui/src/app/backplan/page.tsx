"use client";

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Clock, ChevronLeft, ChevronRight, Check, Sun, AlignLeft, BarChart2 } from 'lucide-react';
import Link from 'next/link';
import { BackplanSkeleton } from "@/components/LoadingSkeletons";
import { calculateBackplan, calculateDynamicTimeline, type BackplanStep } from '@/lib/backplan-utils';

export default function BackplanPage() {
  const [plannedRecipes, setPlannedRecipes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('crumb_completed_steps');
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [stepCompletedAt, setStepCompletedAt] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('crumb_step_completed_at');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [activeTab, setActiveTab] = useState<'schritte' | 'zeitplan'>('schritte');
  const [activeRecipeIdx, setActiveRecipeIdx] = useState(0);
  const [finishModalRecipeId, setFinishModalRecipeId] = useState<number | null>(null);
  const [openDrawers, setOpenDrawers] = useState<Set<string>>(new Set());
  const activeCardRef = useRef<HTMLDivElement>(null);
  // Sections whose done-steps are expanded (default: collapsed)
  const [expandedDoneSections, setExpandedDoneSections] = useState<Set<string>>(new Set());
  const toggleDoneSection = (key: string) => {
    setExpandedDoneSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleDrawer = (key: string) => {
    setOpenDrawers(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('crumb_completed_steps', JSON.stringify([...completedSteps]));
    } catch { /* ignore */ }
  }, [completedSteps]);

  useEffect(() => {
    try {
      localStorage.setItem('crumb_step_completed_at', JSON.stringify(stepCompletedAt));
    } catch { /* ignore */ }
  }, [stepCompletedAt]);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
    })
      .then(res => res.json())
      .then(data => {
        const planned = data
          .filter((r: any) => r.planned_at)
          .sort((a: any, b: any) => parseLocalDate(a.planned_at).getTime() - parseLocalDate(b.planned_at).getTime());
        setPlannedRecipes(planned);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  // activeCardRef scroll removed — active step stays in position (Variante B)

  const parseLocalDate = (dateStr: string): Date => {
    if (!dateStr) return new Date();
    if (dateStr.includes('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) return new Date(dateStr);
    const [datePart, timePart] = dateStr.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = (timePart || "00:00").split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes);
  };

  const extractTimeFromString = (dateStr: string): string => {
    if (!dateStr) return "--:--";
    if (dateStr.includes('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
      return new Date(dateStr).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    const timePart = dateStr.split('T')[1];
    return timePart ? timePart.substring(0, 5) : "--:--";
  };

  const formatTime = (date: Date): string =>
    `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

  const formatDuration = (mins: number): string => {
    if (mins < 60) return `${mins} Min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const formatStepDuration = (step: any): string => {
    const min = parseInt(step.duration_min);
    const max = parseInt(step.duration_max);
    if (!isNaN(min) && !isNaN(max)) {
      return `${formatDuration(min)} – ${formatDuration(max)}`;
    }
    return formatDuration(step.duration);
  };

  const formatCountdown = (seconds: number): string => {
    if (seconds <= 0) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };



  const toggleStep = (recipeId: number, stepIdx: number) => {
    const key = `${recipeId}-${stepIdx}`;
    setCompletedSteps(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
    // Wenn manuell rückgängig gemacht: completedAt entfernen
    setStepCompletedAt(prev => { const next = { ...prev }; delete next[key]; return next; });
  };

  // Schritt früher als geplant abschließen → Timeline neu berechnen + API updaten
  const completeStepEarly = async (recipeId: number, stepIdx: number, currentTimeline: any[]) => {
    const key = `${recipeId}-${stepIdx}`;
    const now = Date.now();

    // State sofort aktualisieren (optimistic)
    const newCompletedSteps = new Set(completedSteps);
    newCompletedSteps.add(key);
    const newStepCompletedAt = { ...stepCompletedAt, [key]: now };
    setCompletedSteps(newCompletedSteps);
    setStepCompletedAt(newStepCompletedAt);

    // Dynamische Timeline berechnen
    const recipe = plannedRecipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const { newPlannedAt } = calculateDynamicTimeline(
      recipe.planned_at,
      recipe.dough_sections,
      newStepCompletedAt,
      recipeId
    );

    // API: planned_at + complete-step notification
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${recipeId}/complete-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ stepIndex: stepIdx, completedAt: now, newPlannedAt: newPlannedAt.toISOString() }),
      });
      // planned_at lokal aktualisieren damit useMemo neu triggert
      setPlannedRecipes(prev => prev.map(r =>
        r.id === recipeId ? { ...r, planned_at: newPlannedAt.toISOString() } : r
      ));
    } catch { /* optimistic update bleibt, API-Fehler ignorieren */ }
  };

  const finishBaking = async (recipeId: number) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${recipeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ planned_at: null }),
      });
      if (res.ok) {
        setCompletedSteps(prev => { const next = new Set(prev); [...next].filter(k => k.startsWith(`${recipeId}-`)).forEach(k => next.delete(k)); return next; });
        setStepCompletedAt(prev => { const next = { ...prev }; Object.keys(next).filter(k => k.startsWith(`${recipeId}-`)).forEach(k => delete next[k]); return next; });
        const remaining = plannedRecipes.filter(r => r.id !== recipeId);
        setPlannedRecipes(remaining);
        setActiveRecipeIdx(0);
        setFinishModalRecipeId(null);
        if (remaining.length === 0) window.location.href = "/";
      }
    } catch { alert("Fehler"); }
  };

  // Memoized timeline for the active recipe
  const recipe = plannedRecipes[activeRecipeIdx];
  const sections = recipe?.dough_sections || [];

  const hasEarlyCompleted = recipe
    ? Object.keys(stepCompletedAt).some(k => k.startsWith(`${recipe.id}-`))
    : false;

  const { timeline, newPlannedAt, shifted } = useMemo(() => {
    if (!recipe) return { timeline: [], newPlannedAt: new Date(), shifted: false };
    if (hasEarlyCompleted) {
      return calculateDynamicTimeline(
        recipe.planned_at,
        recipe.dough_sections,
        stepCompletedAt,
        recipe.id
      );
    }
    return {
      timeline: recipe.planned_timeline
        ? (() => {
            // Alle Steps aus dough_sections flach als Lookup aufbauen
            const stepLookup: Record<string, { duration_min?: number; duration_max?: number }> = {};
            (recipe.dough_sections || []).forEach((sec: any) => {
              (sec.steps || []).forEach((st: any) => {
                const key = `${sec.name}||${st.instruction}`;
                stepLookup[key] = {
                  duration_min: st.duration_min != null ? parseInt(st.duration_min) : undefined,
                  duration_max: st.duration_max != null ? parseInt(st.duration_max) : undefined,
                };
              });
            });
            return recipe.planned_timeline.map((s: any) => {
              const extra = stepLookup[`${s.phase}||${s.instruction}`] ?? {};
              return { ...s, ...extra, start: new Date(s.start), end: new Date(s.end) };
            });
          })()
        : calculateBackplan(parseLocalDate(recipe.planned_at), recipe.dough_sections),
      newPlannedAt: parseLocalDate(recipe.planned_at),
      shifted: false,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id, recipe?.planned_at, stepCompletedAt]);

  // Original-Timeline (unveränderlich) — für zeitbasierte isDone-Erkennung
  const originalTimeline = useMemo(() => {
    if (!recipe) return [];
    return recipe.planned_timeline
      ? recipe.planned_timeline.map((s: any) => ({ ...s, end: new Date(s.end) }))
      : calculateBackplan(parseLocalDate(recipe.planned_at), recipe.dough_sections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id, recipe?.planned_at]);

  // Progress map recalculates only once per minute (not every second)
  const currentMinute = Math.floor(currentTime.getTime() / 60000);
  const progressMap = useMemo(() => {
    const map: Record<number, number> = {};
    const now = new Date();
    plannedRecipes.forEach(r => {
      const tl = calculateBackplan(parseLocalDate(r.planned_at), r.dough_sections);
      const done = tl.filter((s, i) => completedSteps.has(`${r.id}-${i}`) || now > s.end).length;
      map[r.id] = tl.length > 0 ? done / tl.length : 0;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedRecipes, completedSteps, currentMinute]);

  const getRecipeProgress = (r: any) => progressMap[r.id] ?? 0;

  if (isLoading) return <BackplanSkeleton />;

  if (plannedRecipes.length === 0) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFCFB] dark:bg-gray-900 px-6">
      <div className="text-center">
        <div className="w-20 h-20 rounded-full bg-[#F5F0E8] dark:bg-gray-700 flex items-center justify-center mx-auto mb-6">
          <Sun size={32} className="text-[#8B7355]" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Keine Backpläne aktiv</h2>
        <p className="text-gray-400 dark:text-gray-500 mb-8">Plane ein Rezept um hier loszulegen.</p>
        <Link href="/" className="inline-flex items-center gap-2 bg-[#8B7355] text-white px-6 py-3 rounded-2xl font-bold text-sm">
          <ChevronLeft size={16} /> Zur Übersicht
        </Link>
      </div>
    </div>
  );

  // Phasen nach Startzeit sortieren — was zuerst beginnt steht oben
  const sortedSections = [...sections].sort((a, b) => {
    const aStart = timeline.find((t: any) => t.phase === a.name)?.start.getTime() ?? Infinity;
    const bStart = timeline.find((t: any) => t.phase === b.name)?.start.getTime() ?? Infinity;
    return aStart - bStart;
  });

  const totalDuration = timeline.reduce((s: number, t: any) => s + t.duration, 0);

  // isDone helper — consistent met de rendering logik
  const isStepDone = (globalIdx: number) => {
    const originalEnd = originalTimeline[globalIdx]?.end;
    return completedSteps.has(`${recipe.id}-${globalIdx}`)
      || (!!originalEnd && currentTime > originalEnd);
  };

  // activeIndex: schritt der gerade läuft (start <= now < end in dynamischer timeline)
  // Falls kein schritt exakt aktiv ist maar er wel een pending step is waarvan start in verleden ligt
  // (door early completion verschoven), dan is die ook actief.
  const activeIndex = (() => {
    // Eerst: exact actieve stap
    const exact = timeline.findIndex((s: any, i: number) =>
      !isStepDone(i) && currentTime >= s.start && currentTime < s.end
    );
    if (exact >= 0) return exact;
    // Fallback: eerste niet-gedane stap waarvan start al verstreken is maar end ook
    // (gap na early completion — schritt hätte schon angefangen)
    return timeline.findIndex((s: any, i: number) =>
      !isStepDone(i) && currentTime >= s.start
    );
  })();

  // nextIndex: erster nicht-erledigter Schritt in der Zukunft
  const nextIndex = timeline.findIndex((s: any, i: number) =>
    !isStepDone(i) && currentTime < s.start
  );
  const activeStep = activeIndex >= 0 ? timeline[activeIndex] : null;
  const remainingSeconds = activeStep ? Math.max(0, Math.floor((activeStep.end.getTime() - currentTime.getTime()) / 1000)) : 0;
  const stepProgress = activeStep ? Math.min(1, (currentTime.getTime() - activeStep.start.getTime()) / (activeStep.duration * 60000)) : 0;

  return (
    <div className="min-h-screen bg-[#FDFCFB] dark:bg-gray-900 pb-32 transition-colors duration-200">

      {/* ── FERTIG-MODAL ── */}
      {finishModalRecipeId !== null && (() => {
        const modalRecipe = plannedRecipes.find(r => r.id === finishModalRecipeId);
        if (!modalRecipe) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setFinishModalRecipeId(null)} />
            <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700">
              {/* Bild-Header – oben per rounded-t-3xl, unten abgerundet wie RecipeCard */}
              <div className="relative h-48 overflow-hidden rounded-t-3xl rounded-b-2xl">
                <img
                  src={modalRecipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=400'}
                  className="w-full h-full object-cover"
                  alt=""
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-3 left-4 right-4">
                  <p className="text-white font-extrabold text-[15px] leading-tight truncate">{modalRecipe.title}</p>
                  <p className="text-white/70 text-[11px] font-bold mt-0.5">Fertig um {extractTimeFromString(modalRecipe.planned_at)} Uhr</p>
                </div>
              </div>
              {/* Content */}
              <div className="p-5">
                <p className="text-center text-[13px] text-gray-400 dark:text-gray-500 mb-5 mt-1">Backplan abschließen und entfernen?</p>
                <button
                  onClick={() => finishBaking(finishModalRecipeId)}
                  className="w-full py-3.5 rounded-2xl bg-[#8B7355] hover:bg-[#7A6347] active:scale-[0.98] text-white font-extrabold text-[14px] tracking-wide transition-all shadow-lg shadow-[#8B7355]/20 mb-4"
                >
                  Ja, fertig gebacken
                </button>
                <button
                  onClick={() => setFinishModalRecipeId(null)}
                  className="w-full py-2 text-gray-400 dark:text-gray-500 font-bold text-[13px] transition-colors hover:text-gray-600 dark:hover:text-gray-300"
                >
                  Weiterbacken
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── REZEPT-SWITCHER ── */}
      {plannedRecipes.length > 1 && (
        <div className="bg-white dark:bg-gray-800 border-b border-[#F0EBE3] dark:border-gray-700">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-300 dark:text-gray-600 mb-2">
              {plannedRecipes.length} aktive Backpläne
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {plannedRecipes.map((r, idx) => {
                const progress = getRecipeProgress(r);
                const isActive = idx === activeRecipeIdx;
                return (
                  <button key={r.id} onClick={() => { setActiveRecipeIdx(idx); setActiveTab('schritte'); }}
                    className={`flex-shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${
                      isActive
                        ? 'bg-[#8B7355] border-[#8B7355] text-white shadow-md'
                        : 'bg-[#FAFAF9] dark:bg-gray-700 border-[#F0EBE3] dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[#8B7355]/40'
                    }`}>
                    <img src={r.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=100'}
                      className="w-8 h-8 rounded-lg object-cover flex-shrink-0" alt="" />
                    <div className="text-left min-w-0">
                      <div className={`text-[12px] font-extrabold truncate max-w-[130px] ${isActive ? 'text-white' : 'text-gray-800 dark:text-gray-100'}`}>
                        {r.title}
                      </div>
                      <div className={`text-[10px] font-bold flex items-center gap-1 ${isActive ? 'text-white/70' : 'text-[#8B7355]'}`}>
                        <Clock size={9} /> {extractTimeFromString(r.planned_at)} Uhr
                      </div>
                    </div>
                    {/* Mini-Fortschrittsbalken */}
                    <div className={`w-1 h-8 rounded-full overflow-hidden flex-shrink-0 ${isActive ? 'bg-white/30' : 'bg-gray-200 dark:bg-gray-600'}`}>
                      <div className={`w-full rounded-full transition-all duration-500 ${isActive ? 'bg-white' : 'bg-[#8B7355]'}`}
                        style={{ height: `${progress * 100}%`, marginTop: `${(1 - progress) * 100}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── STICKY HEADER ── */}
      <div className="sticky top-0 z-30 bg-[#FDFCFB]/95 dark:bg-gray-900/95 backdrop-blur-xl border-b border-[#F0EBE3] dark:border-gray-700">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link href="/" className="p-2 rounded-xl hover:bg-[#F5F0E8] dark:hover:bg-gray-700 transition-colors">
                <ChevronLeft size={18} className="text-gray-400 dark:text-gray-500" />
              </Link>
              <img src={recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=200'}
                className="w-10 h-10 rounded-xl object-cover" alt="" />
              <div>
                <h1 className="text-[16px] font-extrabold tracking-tight leading-tight dark:text-gray-100">{recipe.title}</h1>
                <p className="text-[12px] text-[#8B7355] font-bold flex items-center gap-1">
                  <Clock size={11} />
                  {shifted ? (
                    <>
                      <span className="line-through text-gray-300 dark:text-gray-600">{extractTimeFromString(recipe.planned_at)}</span>
                      <span className="text-green-500 ml-1">→ {formatTime(newPlannedAt)} Uhr</span>
                    </>
                  ) : (
                    <>Fertig um {extractTimeFromString(recipe.planned_at)} Uhr</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {plannedRecipes.length > 1 && (
                <div className="flex items-center gap-0.5">
                  <button onClick={() => setActiveRecipeIdx(i => (i - 1 + plannedRecipes.length) % plannedRecipes.length)}
                    className="p-1.5 rounded-lg hover:bg-[#F5F0E8] dark:hover:bg-gray-700 transition-colors">
                    <ChevronLeft size={16} className="text-gray-400" />
                  </button>
                  <span className="text-[11px] font-bold text-gray-400 tabular-nums px-1">{activeRecipeIdx + 1}/{plannedRecipes.length}</span>
                  <button onClick={() => setActiveRecipeIdx(i => (i + 1) % plannedRecipes.length)}
                    className="p-1.5 rounded-lg hover:bg-[#F5F0E8] dark:hover:bg-gray-700 transition-colors">
                    <ChevronRight size={16} className="text-gray-400" />
                  </button>
                </div>
              )}
              <button onClick={() => setFinishModalRecipeId(recipe.id)}
                className="px-3 py-2 rounded-xl bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300 text-[11px] font-bold border border-green-100 dark:border-green-800 hover:bg-green-100 transition-colors">
                Fertig
              </button>
            </div>
          </div>

          {/* Fortschrittsbalken */}
          <div className="flex gap-[2px] mb-3">
            {timeline.map((step: any, i: number) => {
              const isDone = completedSteps.has(`${recipe.id}-${i}`) || currentTime > step.end;
              const isActiveStep = i === activeIndex;
              const widthPercent = totalDuration > 0 ? (step.duration / totalDuration) * 100 : 0;
              const prog = isActiveStep ? stepProgress : 0;
              return (
                <div key={i} className="h-1 rounded-full transition-all duration-500"
                  style={{ flex: `${widthPercent} 0 0%`, background: isDone ? '#8B7355' : isActiveStep ? `linear-gradient(90deg, #8B7355 ${prog * 100}%, #E8E2D8 ${prog * 100}%)` : '#E8E2D8' }} />
              );
            })}
          </div>

          {/* TABS */}
          <div className="flex">
            {(['schritte', 'zeitplan'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-bold border-b-2 transition-colors ${
                  activeTab === tab ? 'border-[#8B7355] text-[#8B7355]' : 'border-transparent text-gray-300 dark:text-gray-600 hover:text-gray-500'
                }`}>
                {tab === 'schritte' ? <><AlignLeft size={13} /> Schritte</> : <><BarChart2 size={13} /> Zeitplan</>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── TAB: SCHRITTE ── */}
      {activeTab === 'schritte' && (
        <div className="max-w-3xl mx-auto px-4 pt-5">
          {sortedSections.map((section: any, sIdx: number) => {
            const sectionSteps = timeline.map((t: any, i: number) => ({ ...t, globalIdx: i })).filter((t: any) => t.phase === section.name);
            if (sectionSteps.length === 0) return null;
            const sectionStart = sectionSteps[0].start;
            const sectionEnd = sectionSteps[sectionSteps.length - 1].end;
            const hasActive = sectionSteps.some((s: any) => s.globalIdx === activeIndex);

            const drawerKey = `${recipe.id}-${sIdx}`;
            const isDrawerOpen = openDrawers.has(drawerKey);
            const sectionIngredients = section.ingredients || [];

            return (
              <div key={sIdx} className="mb-7">
                <div className="flex items-center gap-3 mb-3 px-1">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold flex-shrink-0 transition-colors ${hasActive ? 'bg-[#8B7355] text-white' : 'bg-[#F5F0E8] dark:bg-gray-700 text-[#8B7355]'}`}>{sIdx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-extrabold text-gray-800 dark:text-gray-100 uppercase tracking-wider">{section.name}</span>
                    <span className="ml-2 text-[11px] text-gray-400 dark:text-gray-500">{formatTime(sectionStart)} – {formatTime(sectionEnd)}</span>
                  </div>
                  {sectionIngredients.length > 0 && (
                    <button
                      onClick={() => toggleDrawer(drawerKey)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all flex-shrink-0 ${
                        isDrawerOpen
                          ? 'bg-[#8B7355] text-white border-[#8B7355]'
                          : 'bg-[#F5F0E8] dark:bg-gray-700 text-[#8B7355] border-[#E8E0D5] dark:border-gray-600 hover:bg-[#EDE5D8] dark:hover:bg-gray-600'
                      }`}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 3h10M3 6h6M5 9h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                      {sectionIngredients.length}
                    </button>
                  )}
                </div>

                {/* Zutaten-Drawer */}
                {isDrawerOpen && sectionIngredients.length > 0 && (
                  <div className="ml-10 mb-3 rounded-xl border border-[#EDE5D8] dark:border-gray-700 bg-[#FAF7F3] dark:bg-gray-800/60 overflow-hidden">
                    <div className="px-4 py-2 border-b border-[#EDE5D8] dark:border-gray-700">
                      <span className="text-[10px] font-extrabold text-[#8B7355] uppercase tracking-widest">Zutaten – {section.name}</span>
                    </div>
                    <div className="px-4 py-1">
                      {sectionIngredients.map((ing: any, ii: number) => (
                        <div key={ii} className={`flex justify-between items-baseline py-2 text-[13px] ${ii < sectionIngredients.length - 1 ? 'border-b border-[#EDE5D8] dark:border-gray-700' : ''}`}>
                          <span className="text-gray-600 dark:text-gray-300">{ing.name}</span>
                          <span className="font-bold text-[#2D2D2D] dark:text-gray-100 tabular-nums ml-4 flex-shrink-0">
                            {ing.amount}{ing.unit ? ` ${ing.unit}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(() => {
                  const doneSteps = sectionSteps.filter(({ globalIdx }: any) => isStepDone(globalIdx));
                  const pendingSteps = sectionSteps.filter(({ globalIdx }: any) => !isStepDone(globalIdx));
                  const sectionDoneKey = `done-${recipe.id}-${sIdx}`;
                  const isDoneExpanded = expandedDoneSections.has(sectionDoneKey);
                  return (
                    <div className="flex flex-col gap-2 pl-10">
                      {doneSteps.length > 0 && (
                        <>
                          <button
                            onClick={() => toggleDoneSection(sectionDoneKey)}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F9F6F2] dark:bg-gray-800/50 border border-[#EDE5D8] dark:border-gray-700 text-left transition-colors hover:bg-[#F5F0E8] dark:hover:bg-gray-700/50"
                          >
                            <Check size={13} className="text-[#8B7355] flex-shrink-0" />
                            <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 flex-1">
                              {doneSteps.length} Schritt{doneSteps.length !== 1 ? 'e' : ''} erledigt
                            </span>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`text-gray-300 dark:text-gray-600 transition-transform ${isDoneExpanded ? 'rotate-180' : ''}`}>
                              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          {isDoneExpanded && doneSteps.map(({ globalIdx, ...step }: BackplanStep & { globalIdx: number }) => (
                            <div key={globalIdx}
                              onClick={() => toggleStep(recipe.id, globalIdx)}
                              className="border border-[#F0EBE3] dark:border-gray-700 bg-[#FAFAFA] dark:bg-gray-800/50 p-4 opacity-40 rounded-2xl cursor-pointer"
                            >
                              <div className="flex justify-between items-center mb-1">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase ${step.type === 'Backen' ? 'bg-red-500 text-white' : step.type === 'Aktion' ? 'bg-[#8B7355] text-white' : 'bg-[#F5F0E8] dark:bg-gray-700 text-[#8B7355]'}`}>
                                    {step.type}
                                  </span>
                                  <span className="text-[11px] text-gray-300 dark:text-gray-600 font-bold">{formatStepDuration(step)}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-gray-300 dark:text-gray-600 font-bold">{formatTime(step.start)}</span>
                                  <Check size={13} className="text-[#8B7355]" />
                                </div>
                              </div>
                              <p className="text-[13px] text-gray-400 dark:text-gray-600 line-through leading-snug">{step.instruction}</p>
                            </div>
                          ))}
                        </>
                      )}
                      {pendingSteps.map(({ globalIdx, ...step }: BackplanStep & { globalIdx: number }) => {
                        const isActiveStep = globalIdx === activeIndex;
                        const isNextStep = globalIdx === nextIndex;
                        return (
                          <div key={globalIdx} ref={isActiveStep ? activeCardRef : null}
                            className={`transition-all duration-300 rounded-2xl ${
                              isActiveStep ? 'border-2 border-[#8B7355] bg-gradient-to-br from-[#FFFDF9] to-[#FAF7F2] dark:from-gray-800 dark:to-gray-700 p-5'
                              : isNextStep ? 'border-2 border-dashed border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-gray-800 p-4'
                              : 'border border-[#F0EBE3] dark:border-gray-700 bg-white dark:bg-gray-800 p-4'
                            }`}>
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide ${step.type === 'Backen' ? 'bg-red-500 text-white' : step.type === 'Aktion' ? 'bg-[#8B7355] text-white' : 'bg-[#F5F0E8] dark:bg-gray-700 text-[#8B7355]'}`}>
                                  {step.type === 'Backen' ? '🔥' : step.type === 'Aktion' ? '👐' : '⏳'} {step.type}
                                </span>
                                <span className="text-[11px] text-gray-300 dark:text-gray-600 font-bold">{formatStepDuration(step)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-300 dark:text-gray-600 font-bold">{formatTime(step.start)}</span>
                                {isActiveStep && (
                                  <button
                                    onClick={e => { e.stopPropagation(); completeStepEarly(recipe.id, globalIdx, timeline); }}
                                    className="ml-1 px-2 py-1 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold border border-green-100 dark:border-green-800 hover:bg-green-100 transition-colors"
                                  >
                                    ✓ Fertig
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className={`text-[14px] leading-relaxed m-0 ${isActiveStep ? 'text-[15px] font-semibold text-[#2D2D2D] dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 font-medium'}`}>
                              {step.instruction}
                            </p>
                            {isActiveStep && (
                              <>
                                <div className={`mt-4 rounded-2xl p-4 flex items-center justify-between ${step.type === 'Warten' ? 'bg-[#F5F0E8] dark:bg-gray-700' : step.type === 'Backen' ? 'bg-gradient-to-br from-red-500 to-red-700' : 'bg-gradient-to-br from-[#8B7355] to-[#6B5740]'}`}>
                                  <div>
                                    <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${step.type === 'Warten' ? 'text-[#8B7355]' : 'text-white/70'}`}>{step.type === 'Warten' ? 'Restzeit' : 'Timer'}</div>
                                    <div className={`text-[28px] font-extrabold tabular-nums tracking-tight ${step.type === 'Warten' ? 'text-[#2D2D2D] dark:text-gray-100' : 'text-white'}`}>{formatCountdown(remainingSeconds)}</div>
                                  </div>
                                  <div className="relative w-12 h-12">
                                    <svg width="48" height="48" className="absolute -rotate-90">
                                      <circle cx="24" cy="24" r="20" fill="none" stroke={step.type === 'Warten' ? '#E8E2D8' : 'rgba(255,255,255,0.2)'} strokeWidth="3" />
                                      <circle cx="24" cy="24" r="20" fill="none" stroke={step.type === 'Warten' ? '#8B7355' : 'white'} strokeWidth="3"
                                        strokeDasharray={`${2 * Math.PI * 20}`} strokeDashoffset={`${2 * Math.PI * 20 * (1 - stepProgress)}`}
                                        strokeLinecap="round" className="transition-all duration-1000 ease-linear" />
                                    </svg>
                                  </div>
                                </div>
                                {step.type === 'Warten' && step.duration_min != null && step.duration_max != null && (() => {
                                  const earliestEnd = new Date(step.start.getTime() + step.duration_min * 60000);
                                  const latestEnd = new Date(step.start.getTime() + step.duration_max * 60000);
                                  return (
                                    <div className="mt-2 px-4 py-2.5 rounded-xl bg-[#F5F0E8]/60 dark:bg-gray-700/60 border border-[#E8E0D5] dark:border-gray-600 flex items-center justify-between">
                                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#8B7355]">Bereit zwischen</span>
                                      <span className="text-[13px] font-extrabold text-[#2D2D2D] dark:text-gray-100 tabular-nums">
                                        {formatTime(earliestEnd)} – {formatTime(latestEnd)} Uhr
                                      </span>
                                    </div>
                                  );
                                })()}
                                <div className="mt-3 h-1 rounded-full bg-[#E8E2D8]">
                                  <div className="h-full rounded-full bg-gradient-to-r from-[#8B7355] to-[#A0845C] transition-all duration-1000 ease-linear" style={{ width: `${stepProgress * 100}%` }} />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            );
          })}

          <div className="pl-10 mb-6">
            <div className="rounded-2xl border border-[#E8E0D5] dark:border-gray-700 bg-[#F9F6F2] dark:bg-gray-900/40 p-4 flex items-center justify-between mb-4">
              <span className="text-[#8B7355] dark:text-[#C4A484] font-bold text-[14px]">{recipe.title} – fertig</span>
              <span className="text-[#8B7355] dark:text-[#C4A484] font-extrabold text-[14px]">{timeline.length > 0 ? formatTime(timeline[timeline.length - 1].end) : extractTimeFromString(recipe.planned_at)} Uhr</span>
            </div>
            <Link href={`/recipes/${recipe.id}`}
              className="block w-full text-center py-4 rounded-2xl bg-[#8B7355] text-white font-extrabold text-[13px] uppercase tracking-widest shadow-lg shadow-[#8B7355]/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
              Ganzes Rezept zeigen
            </Link>
          </div>
        </div>
      )}

      {/* ── TAB: ZEITPLAN ── */}
      {activeTab === 'zeitplan' && (
        <GanttChart sections={sortedSections} timeline={timeline} currentTime={currentTime} formatTime={formatTime} formatDuration={formatDuration} formatStepDuration={formatStepDuration} />
      )}

      {/* ── NÄCHSTER SCHRITT (fixed bottom) ── */}
      {activeTab === 'schritte' && nextIndex >= 0 && (() => {
        const nextStep = timeline[nextIndex];
        return (
          <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#FDFCFB]/95 dark:bg-gray-900/95 backdrop-blur-xl border-t border-[#F0EBE3] dark:border-gray-700">
            <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F5F0E8] dark:bg-gray-700 flex items-center justify-center flex-shrink-0 text-[15px]">
                {nextStep.type === 'Aktion' ? '👐' : '⏳'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-[#8B7355] uppercase tracking-widest">Nächster Schritt um {formatTime(nextStep.start)}</div>
                <div className="text-[13px] font-semibold text-[#2D2D2D] dark:text-gray-100 truncate">{nextStep.instruction}</div>
              </div>
              <span className="text-[11px] font-bold text-gray-300 dark:text-gray-500 flex-shrink-0">{formatStepDuration(nextStep)}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const PHASE_COLORS = [
  { bg: 'bg-amber-50 dark:bg-amber-900/20', bar: '#F59E0B', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-100 dark:border-amber-800' },
  { bg: 'bg-blue-50 dark:bg-blue-900/20', bar: '#3B82F6', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-100 dark:border-blue-800' },
  { bg: 'bg-emerald-50 dark:bg-emerald-900/20', bar: '#10B981', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-800' },
  { bg: 'bg-rose-50 dark:bg-rose-900/20', bar: '#F43F5E', text: 'text-rose-700 dark:text-rose-400', border: 'border-rose-100 dark:border-rose-800' },
  { bg: 'bg-violet-50 dark:bg-violet-900/20', bar: '#8B5CF6', text: 'text-violet-700 dark:text-violet-400', border: 'border-violet-100 dark:border-violet-800' },
];

function GanttChart({ sections, timeline, currentTime, formatTime, formatDuration, formatStepDuration }: any) {
  if (timeline.length === 0) return <div className="p-8 text-center text-gray-400">Keine Schritte</div>;
  const sortedSections = [...sections].sort((a: any, b: any) => {
    const aStart = timeline.find((t: any) => t.phase === a.name)?.start.getTime() ?? Infinity;
    const bStart = timeline.find((t: any) => t.phase === b.name)?.start.getTime() ?? Infinity;
    return aStart - bStart;
  });
  const totalStart = timeline[0].start;
  const totalEnd = timeline[timeline.length - 1].end;
  const totalMs = totalEnd.getTime() - totalStart.getTime();
  const pct = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - totalStart.getTime()) / totalMs) * 100));
  const ticks: Date[] = [];
  const tickStart = new Date(totalStart);
  tickStart.setMinutes(0, 0, 0);
  tickStart.setHours(tickStart.getHours() + 1);
  const t = new Date(tickStart);
  while (t <= totalEnd) { ticks.push(new Date(t)); t.setHours(t.getHours() + 1); }
  const nowPct = pct(currentTime);
  const isNowVisible = currentTime >= totalStart && currentTime <= totalEnd;

  return (
    <div className="max-w-3xl mx-auto px-4 pt-5 pb-10">
      <div className="flex flex-wrap gap-2 mb-5">
        {sortedSections.map((section: any, i: number) => {
          const c = PHASE_COLORS[i % PHASE_COLORS.length];
          return (
            <div key={i} className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-bold ${c.bg} ${c.text} ${c.border}`}>
              <div className="w-2 h-2 rounded-full" style={{ background: c.bar }} />{section.name}
            </div>
          );
        })}
      </div>
      <div className="space-y-3 mb-2">
        {sortedSections.map((section: any, sIdx: number) => {
          const c = PHASE_COLORS[sIdx % PHASE_COLORS.length];
          const steps = timeline.filter((t: any) => t.phase === section.name);
          if (!steps.length) return null;
          const phaseStart = steps[0].start;
          const phaseEnd = steps[steps.length - 1].end;
          return (
            <div key={sIdx}>
              <div className={`text-[11px] font-extrabold uppercase tracking-widest mb-1 ${c.text}`}>
                {section.name}
                <span className="ml-2 font-normal normal-case tracking-normal text-gray-400 dark:text-gray-500 text-[10px]">{formatTime(phaseStart)} – {formatTime(phaseEnd)}</span>
              </div>
              <div className="relative h-8 bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700">
                {ticks.map((tk, ti) => <div key={ti} className="absolute top-0 bottom-0 w-px bg-gray-200/60 dark:bg-gray-700" style={{ left: `${pct(tk)}%` }} />)}
                <div className="absolute top-1 bottom-1 rounded-lg opacity-20" style={{ left: `${pct(phaseStart)}%`, width: `${pct(phaseEnd) - pct(phaseStart)}%`, background: c.bar }} />
                {steps.map((step: any, si: number) => {
                  const l = pct(step.start);
                  const w = Math.max(0.5, pct(step.end) - l);
                  return <div key={si} className="absolute top-1.5 bottom-1.5 rounded-md" style={{ left: `${l}%`, width: `${w}%`, background: c.bar, opacity: step.type === 'Warten' ? 0.35 : 0.85 }} title={`${step.instruction} (${formatDuration(step.duration)})`} />;
                })}
                {isNowVisible && <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10" style={{ left: `${nowPct}%` }}><div className="w-2 h-2 rounded-full bg-red-400 absolute -top-0.5 -left-[3px]" /></div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="relative h-5">
        <span className="absolute text-[10px] text-gray-400 dark:text-gray-500 font-bold left-0">{formatTime(totalStart)}</span>
        {ticks.map((tk, ti) => { const p = pct(tk); if (p < 4 || p > 94) return null; return <span key={ti} className="absolute text-[10px] text-gray-300 dark:text-gray-600 font-bold -translate-x-1/2" style={{ left: `${p}%` }}>{formatTime(tk)}</span>; })}
        <span className="absolute text-[10px] text-green-500 font-bold right-0">{formatTime(totalEnd)}</span>
      </div>
      <div className="mt-8 space-y-4">
        {sortedSections.map((section: any, sIdx: number) => {
          const c = PHASE_COLORS[sIdx % PHASE_COLORS.length];
          const steps = timeline.filter((t: any) => t.phase === section.name);
          if (!steps.length) return null;
          return (
            <div key={sIdx} className={`rounded-2xl border p-4 ${c.bg} ${c.border}`}>
              <div className={`text-[11px] font-extrabold uppercase tracking-widest mb-3 ${c.text}`}>{section.name}</div>
              <div className="space-y-2">
                {steps.map((step: any, si: number) => (
                  <div key={si} className="flex items-start gap-2 text-[12px]">
                    <span className="text-gray-400 dark:text-gray-500 font-bold tabular-nums w-10 flex-shrink-0 pt-px">{formatTime(step.start)}</span>
                    <span className={`flex-1 text-gray-700 dark:text-gray-300 leading-relaxed ${step.type === 'Warten' ? 'opacity-60 italic' : ''}`}>{step.instruction.length > 90 ? step.instruction.slice(0, 90) + '…' : step.instruction}</span>
                    <span className="text-gray-300 dark:text-gray-600 text-[11px] flex-shrink-0 pt-px">{formatStepDuration(step)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}// Do 12. Mär 19:42:46 CET 2026