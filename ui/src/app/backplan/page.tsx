"use client";

import React, { useEffect, useState, useRef } from 'react';
import { Clock, ChevronLeft, Check, Sun, AlignLeft, BarChart2 } from 'lucide-react';
import Link from 'next/link';
import { BackplanSkeleton } from "@/components/LoadingSkeletons";
import { calcTotalDuration } from '@/lib/backplan-utils';

export default function BackplanPage() {
  const [plannedRecipes, setPlannedRecipes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'schritte' | 'zeitplan'>('schritte');
  const activeCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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

  useEffect(() => {
    if (activeCardRef.current) {
      activeCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [plannedRecipes, activeTab]);

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

  const formatCountdown = (seconds: number): string => {
    if (seconds <= 0) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const calculateStepTimeline = (targetDateTime: string, sections: any[]) => {
    if (!sections || sections.length === 0) return [];
    const target = parseLocalDate(targetDateTime);
    const timeline: any[] = [];
    const phaseNames = sections.map((s: any) => s.name as string);

    const deps: Record<string, string[]> = {};
    sections.forEach((section: any) => {
      deps[section.name] = [];
      (section.ingredients || []).forEach((ing: any) => {
        const ingName = (ing.name || '').toLowerCase();
        phaseNames.forEach(otherName => {
          if (otherName !== section.name && ingName.includes(otherName.toLowerCase())) {
            if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
          }
        });
      });
    });

    const sectionMap: Record<string, any> = Object.fromEntries(sections.map((s: any) => [s.name, s]));
    const endOffsets: Record<string, number> = {};
    const startOffsets: Record<string, number> = {};

    function calcEndOffset(name: string, visited = new Set<string>()): number {
      if (name in endOffsets) return endOffsets[name];
      if (visited.has(name)) return 0;
      visited.add(name);
      const dependents = phaseNames.filter(n => deps[n]?.includes(name));
      endOffsets[name] = dependents.length === 0 ? 0
        : Math.min(...dependents.map(d => calcStartOffset(d, new Set(visited))));
      return endOffsets[name];
    }

    function calcStartOffset(name: string, visited = new Set<string>()): number {
      if (name in startOffsets) return startOffsets[name];
      const end = calcEndOffset(name, visited);
      const dur = (sectionMap[name]?.steps || []).reduce(
        (sum: number, s: any) => sum + (parseInt(s.duration) || 0), 0
      );
      startOffsets[name] = end + dur;
      return startOffsets[name];
    }

    phaseNames.forEach(name => calcStartOffset(name));

    sections.forEach((section: any) => {
      const offset = startOffsets[section.name] || 0;
      const sectionStart = new Date(target.getTime() - offset * 60000);
      let stepMoment = new Date(sectionStart.getTime());
      (section.steps || []).forEach((step: any) => {
        const duration = parseInt(step.duration) || 0;
        const stepStart = new Date(stepMoment.getTime());
        const stepEnd = new Date(stepMoment.getTime() + duration * 60000);
        timeline.push({
          phase: section.name,
          ingredients: section.ingredients || [],
          instruction: step.instruction,
          type: step.type || 'Aktion',
          duration,
          start: stepStart,
          end: stepEnd,
          isParallel: (endOffsets[section.name] || 0) > 0,
        });
        stepMoment = stepEnd;
      });
    });

    timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
    return timeline;
  };

  const toggleStep = (recipeId: number, stepIdx: number) => {
    const key = `${recipeId}-${stepIdx}`;
    setCompletedSteps(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const finishBaking = async (recipeId: number) => {
    if (!confirm("Brot fertig?")) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${recipeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ planned_at: null }),
      });
      if (res.ok) {
        setPlannedRecipes(prev => prev.filter(r => r.id !== recipeId));
        if (plannedRecipes.length <= 1) window.location.href = "/";
      }
    } catch { alert("Fehler"); }
  };

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

  return (
    <div className="min-h-screen bg-[#FDFCFB] dark:bg-gray-900 pb-32 transition-colors duration-200">

      {plannedRecipes.map((recipe) => {
        const timeline = calculateStepTimeline(recipe.planned_at, recipe.dough_sections);
        const sections = recipe.dough_sections || [];
        const totalDuration = timeline.reduce((s, t) => s + t.duration, 0);

        const activeIndex = timeline.findIndex((s, i) =>
          !completedSteps.has(`${recipe.id}-${i}`) && currentTime >= s.start && currentTime < s.end
        );
        const nextIndex = timeline.findIndex((s, i) =>
          i > activeIndex && !completedSteps.has(`${recipe.id}-${i}`) && currentTime < s.start
        );
        const activeStep = activeIndex >= 0 ? timeline[activeIndex] : null;
        const remainingSeconds = activeStep
          ? Math.max(0, Math.floor((activeStep.end.getTime() - currentTime.getTime()) / 1000))
          : 0;
        const stepProgress = activeStep
          ? Math.min(1, (currentTime.getTime() - activeStep.start.getTime()) / (activeStep.duration * 60000))
          : 0;

        return (
          <div key={recipe.id}>

            {/* STICKY HEADER */}
            <div className="sticky top-0 z-30 bg-[#FDFCFB]/95 dark:bg-gray-900/95 backdrop-blur-xl border-b border-[#F0EBE3] dark:border-gray-700">
              <div className="max-w-3xl mx-auto px-4 pt-4 pb-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Link href="/" className="p-2 rounded-xl hover:bg-[#F5F0E8] dark:hover:bg-gray-700 transition-colors">
                      <ChevronLeft size={18} className="text-gray-400 dark:text-gray-500" />
                    </Link>
                    <img
                      src={recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=200'}
                      className="w-10 h-10 rounded-xl object-cover"
                      alt=""
                    />
                    <div>
                      <h1 className="text-[16px] font-extrabold tracking-tight leading-tight dark:text-gray-100">{recipe.title}</h1>
                      <p className="text-[12px] text-[#8B7355] font-bold flex items-center gap-1">
                        <Clock size={11} /> Fertig um {extractTimeFromString(recipe.planned_at)} Uhr
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => finishBaking(recipe.id)}
                    className="px-3 py-2 rounded-xl bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300 text-[11px] font-bold border border-green-100 dark:border-green-800 hover:bg-green-100 transition-colors"
                  >
                    Fertig
                  </button>
                </div>

                {/* Fortschrittsbalken */}
                <div className="flex gap-[2px] mb-3">
                  {timeline.map((step, i) => {
                    const isDone = completedSteps.has(`${recipe.id}-${i}`) || currentTime > step.end;
                    const isActive = i === activeIndex;
                    const widthPercent = totalDuration > 0 ? (step.duration / totalDuration) * 100 : 0;
                    const prog = isActive ? stepProgress : 0;
                    return (
                      <div key={i} className="h-1 rounded-full transition-all duration-500"
                        style={{
                          flex: `${widthPercent} 0 0%`,
                          background: isDone
                            ? '#8B7355'
                            : isActive
                              ? `linear-gradient(90deg, #8B7355 ${prog * 100}%, #E8E2D8 ${prog * 100}%)`
                              : '#E8E2D8',
                        }}
                      />
                    );
                  })}
                </div>

                {/* TABS */}
                <div className="flex">
                  {(['schritte', 'zeitplan'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-bold border-b-2 transition-colors ${
                        activeTab === tab
                          ? 'border-[#8B7355] text-[#8B7355]'
                          : 'border-transparent text-gray-300 dark:text-gray-600 hover:text-gray-500'
                      }`}
                    >
                      {tab === 'schritte' ? <><AlignLeft size={13} /> Schritte</> : <><BarChart2 size={13} /> Zeitplan</>}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── TAB: SCHRITTE ── */}
            {activeTab === 'schritte' && (
              <div className="max-w-3xl mx-auto px-4 pt-5">
                {sections.map((section: any, sIdx: number) => {
                  const sectionSteps = timeline
                    .map((t, i) => ({ ...t, globalIdx: i }))
                    .filter(t => t.phase === section.name);
                  if (sectionSteps.length === 0) return null;

                  const sectionStart = sectionSteps[0].start;
                  const sectionEnd = sectionSteps[sectionSteps.length - 1].end;
                  const hasActive = sectionSteps.some(s => s.globalIdx === activeIndex);

                  return (
                    <div key={sIdx} className="mb-7">
                      {/* Phasen-Header */}
                      <div className="flex items-center gap-3 mb-3 px-1">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold flex-shrink-0 transition-colors ${
                          hasActive ? 'bg-[#8B7355] text-white' : 'bg-[#F5F0E8] dark:bg-gray-700 text-[#8B7355]'
                        }`}>
                          {sIdx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-extrabold text-gray-800 dark:text-gray-100 uppercase tracking-wider">
                            {section.name}
                          </span>
                          <span className="ml-2 text-[11px] text-gray-400 dark:text-gray-500">
                            {formatTime(sectionStart)} – {formatTime(sectionEnd)}
                          </span>
                        </div>
                      </div>

                      {/* Steps dieser Phase */}
                      <div className="flex flex-col gap-2 pl-10">
                        {sectionSteps.map(({ globalIdx, ...step }) => {
                          const key = `${recipe.id}-${globalIdx}`;
                          const isDone = completedSteps.has(key) || currentTime > step.end;
                          const isActiveStep = globalIdx === activeIndex;
                          const isNextStep = globalIdx === nextIndex;

                          return (
                            <div
                              key={globalIdx}
                              ref={isActiveStep ? activeCardRef : null}
                              onClick={() => (isDone || isActiveStep) ? toggleStep(recipe.id, globalIdx) : undefined}
                              style={{ cursor: isDone || isActiveStep ? 'pointer' : 'default' }}
                              className={`transition-all duration-300 rounded-2xl ${
                                isActiveStep
                                  ? 'border-2 border-[#8B7355] bg-gradient-to-br from-[#FFFDF9] to-[#FAF7F2] dark:from-gray-800 dark:to-gray-700 p-5'
                                  : isNextStep
                                    ? 'border-2 border-dashed border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-gray-800 p-4'
                                    : isDone
                                      ? 'border border-[#F0EBE3] dark:border-gray-700 bg-[#FAFAFA] dark:bg-gray-800/50 p-4 opacity-40'
                                      : 'border border-[#F0EBE3] dark:border-gray-700 bg-white dark:bg-gray-800 p-4'
                              }`}
                            >
                              <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide ${
                                    step.type === 'Aktion' ? 'bg-[#8B7355] text-white' : 'bg-[#F5F0E8] dark:bg-gray-700 text-[#8B7355]'
                                  }`}>
                                    {step.type === 'Aktion' ? '👐' : '⏳'} {step.type}
                                  </span>
                                  <span className="text-[11px] text-gray-300 dark:text-gray-600 font-bold">
                                    {formatDuration(step.duration)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-gray-300 dark:text-gray-600 font-bold">{formatTime(step.start)}</span>
                                  {isDone && <Check size={14} className="text-[#8B7355]" />}
                                </div>
                              </div>

                              <p className={`text-[14px] leading-relaxed m-0 ${
                                isActiveStep
                                  ? 'text-[15px] font-semibold text-[#2D2D2D] dark:text-gray-100'
                                  : isDone
                                    ? 'text-gray-400 dark:text-gray-600 line-through'
                                    : 'text-gray-600 dark:text-gray-300 font-medium'
                              }`}>
                                {step.instruction}
                              </p>

                              {isActiveStep && (
                                <>
                                  <div className={`mt-4 rounded-2xl p-4 flex items-center justify-between ${
                                    step.type === 'Warten' ? 'bg-[#F5F0E8] dark:bg-gray-700' : 'bg-gradient-to-br from-[#8B7355] to-[#6B5740]'
                                  }`}>
                                    <div>
                                      <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${step.type === 'Warten' ? 'text-[#8B7355]' : 'text-white/70'}`}>
                                        {step.type === 'Warten' ? 'Restzeit' : 'Timer'}
                                      </div>
                                      <div className={`text-[28px] font-extrabold tabular-nums tracking-tight ${step.type === 'Warten' ? 'text-[#2D2D2D] dark:text-gray-100' : 'text-white'}`}>
                                        {formatCountdown(remainingSeconds)}
                                      </div>
                                    </div>
                                    <div className="relative w-12 h-12">
                                      <svg width="48" height="48" className="absolute -rotate-90">
                                        <circle cx="24" cy="24" r="20" fill="none" stroke={step.type === 'Warten' ? '#E8E2D8' : 'rgba(255,255,255,0.2)'} strokeWidth="3" />
                                        <circle cx="24" cy="24" r="20" fill="none" stroke={step.type === 'Warten' ? '#8B7355' : 'white'} strokeWidth="3"
                                          strokeDasharray={`${2 * Math.PI * 20}`}
                                          strokeDashoffset={`${2 * Math.PI * 20 * (1 - stepProgress)}`}
                                          strokeLinecap="round" className="transition-all duration-1000 ease-linear" />
                                      </svg>
                                    </div>
                                  </div>
                                  <div className="mt-3 h-1 rounded-full bg-[#E8E2D8]">
                                    <div className="h-full rounded-full bg-gradient-to-r from-[#8B7355] to-[#A0845C] transition-all duration-1000 ease-linear"
                                      style={{ width: `${stepProgress * 100}%` }} />
                                  </div>
                                  {step.type === 'Aktion' && step.ingredients.length > 0 && (
                                    <div className="mt-4 bg-white dark:bg-gray-800 rounded-2xl p-4 border border-[#F0EBE3] dark:border-gray-700">
                                      <div className="text-[10px] font-extrabold text-gray-300 dark:text-gray-500 uppercase tracking-widest mb-3">Zutaten – {step.phase}</div>
                                      {step.ingredients.map((ing: any, ii: number) => (
                                        <div key={ii} className={`flex justify-between py-2 text-[13px] ${ii < step.ingredients.length - 1 ? 'border-b border-[#F8F6F2] dark:border-gray-700' : ''}`}>
                                          <span className="text-gray-600 dark:text-gray-300">{ing.name}</span>
                                          <span className="font-extrabold text-[#2D2D2D] dark:text-gray-100 bg-[#F8F6F2] dark:bg-gray-700 px-2 py-0.5 rounded-lg">{ing.amount} {ing.unit}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Endzeitpunkt + Link */}
                <div className="pl-10 mb-6">
                  <div className="rounded-2xl border-2 border-green-100 dark:border-green-800 bg-green-50 dark:bg-green-900/30 p-4 flex items-center justify-between mb-4">
                    <span className="text-green-700 dark:text-green-300 font-bold text-[14px]">{recipe.title} fertig!</span>
                    <span className="text-green-600 dark:text-green-400 font-extrabold text-[14px]">{extractTimeFromString(recipe.planned_at)} Uhr</span>
                  </div>
                  <Link href={`/recipes/${recipe.id}`}
                    className="block w-full text-center py-4 rounded-2xl bg-[#8B7355] text-white font-extrabold text-[13px] uppercase tracking-widest shadow-lg shadow-[#8B7355]/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
                    Ganzes Rezept zeigen
                  </Link>
                </div>
              </div>
            )}

            {/* ── TAB: ZEITPLAN (Gantt) ── */}
            {activeTab === 'zeitplan' && (
              <GanttChart
                sections={sections}
                timeline={timeline}
                currentTime={currentTime}
                formatTime={formatTime}
                formatDuration={formatDuration}
              />
            )}
          </div>
        );
      })}

      {/* NÄCHSTER SCHRITT (fixed bottom, nur im Schritte-Tab) */}
      {activeTab === 'schritte' && plannedRecipes.map((recipe) => {
        const timeline = calculateStepTimeline(recipe.planned_at, recipe.dough_sections);
        const activeIndex = timeline.findIndex((s, i) =>
          !completedSteps.has(`${recipe.id}-${i}`) && currentTime >= s.start && currentTime < s.end
        );
        const nextIndex = timeline.findIndex((s, i) =>
          i > activeIndex && !completedSteps.has(`${recipe.id}-${i}`) && currentTime < s.start
        );
        if (nextIndex < 0) return null;
        const nextStep = timeline[nextIndex];
        return (
          <div key={`next-${recipe.id}`} className="fixed bottom-0 left-0 right-0 z-40 bg-[#FDFCFB]/95 dark:bg-gray-900/95 backdrop-blur-xl border-t border-[#F0EBE3] dark:border-gray-700">
            <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F5F0E8] dark:bg-gray-700 flex items-center justify-center flex-shrink-0 text-[15px]">
                {nextStep.type === 'Aktion' ? '👐' : '⏳'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-[#8B7355] uppercase tracking-widest">Nächster Schritt um {formatTime(nextStep.start)}</div>
                <div className="text-[13px] font-semibold text-[#2D2D2D] dark:text-gray-100 truncate">{nextStep.instruction}</div>
              </div>
              <span className="text-[11px] font-bold text-gray-300 dark:text-gray-500 flex-shrink-0">{formatDuration(nextStep.duration)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── GANTT CHART ──────────────────────────────────────────────

const PHASE_COLORS = [
  { bg: 'bg-amber-50 dark:bg-amber-900/20', bar: '#F59E0B', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-100 dark:border-amber-800' },
  { bg: 'bg-blue-50 dark:bg-blue-900/20', bar: '#3B82F6', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-100 dark:border-blue-800' },
  { bg: 'bg-emerald-50 dark:bg-emerald-900/20', bar: '#10B981', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-800' },
  { bg: 'bg-rose-50 dark:bg-rose-900/20', bar: '#F43F5E', text: 'text-rose-700 dark:text-rose-400', border: 'border-rose-100 dark:border-rose-800' },
  { bg: 'bg-violet-50 dark:bg-violet-900/20', bar: '#8B5CF6', text: 'text-violet-700 dark:text-violet-400', border: 'border-violet-100 dark:border-violet-800' },
];

function GanttChart({ sections, timeline, currentTime, formatTime, formatDuration }: any) {
  if (timeline.length === 0) return <div className="p-8 text-center text-gray-400">Keine Schritte</div>;

  const totalStart = timeline[0].start;
  const totalEnd = timeline[timeline.length - 1].end;
  const totalMs = totalEnd.getTime() - totalStart.getTime();

  const pct = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - totalStart.getTime()) / totalMs) * 100));

  // Stunden-Ticks
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

      {/* Legende */}
      <div className="flex flex-wrap gap-2 mb-5">
        {sections.map((section: any, i: number) => {
          const c = PHASE_COLORS[i % PHASE_COLORS.length];
          return (
            <div key={i} className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-bold ${c.bg} ${c.text} ${c.border}`}>
              <div className="w-2 h-2 rounded-full" style={{ background: c.bar }} />
              {section.name}
            </div>
          );
        })}
      </div>

      {/* Balken pro Phase */}
      <div className="space-y-3 mb-2">
        {sections.map((section: any, sIdx: number) => {
          const c = PHASE_COLORS[sIdx % PHASE_COLORS.length];
          const steps = timeline.filter((t: any) => t.phase === section.name);
          if (!steps.length) return null;
          const phaseStart = steps[0].start;
          const phaseEnd = steps[steps.length - 1].end;

          return (
            <div key={sIdx}>
              <div className={`text-[11px] font-extrabold uppercase tracking-widest mb-1 ${c.text}`}>
                {section.name}
                <span className="ml-2 font-normal normal-case tracking-normal text-gray-400 dark:text-gray-500 text-[10px]">
                  {formatTime(phaseStart)} – {formatTime(phaseEnd)}
                </span>
              </div>
              <div className="relative h-8 bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700">
                {/* Ticks */}
                {ticks.map((tk, ti) => (
                  <div key={ti} className="absolute top-0 bottom-0 w-px bg-gray-200/60 dark:bg-gray-700"
                    style={{ left: `${pct(tk)}%` }} />
                ))}
                {/* Gesamtbalken (transparent) */}
                <div className="absolute top-1 bottom-1 rounded-lg opacity-20"
                  style={{ left: `${pct(phaseStart)}%`, width: `${pct(phaseEnd) - pct(phaseStart)}%`, background: c.bar }} />
                {/* Einzelne Schritte */}
                {steps.map((step: any, si: number) => {
                  const l = pct(step.start);
                  const w = Math.max(0.5, pct(step.end) - l);
                  return (
                    <div key={si} className="absolute top-1.5 bottom-1.5 rounded-md"
                      style={{ left: `${l}%`, width: `${w}%`, background: c.bar, opacity: step.type === 'Warten' ? 0.35 : 0.85 }}
                      title={`${step.instruction} (${formatDuration(step.duration)})`}
                    />
                  );
                })}
                {/* Jetzt-Linie */}
                {isNowVisible && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10" style={{ left: `${nowPct}%` }}>
                    <div className="w-2 h-2 rounded-full bg-red-400 absolute -top-0.5 -left-[3px]" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Zeitachse */}
      <div className="relative h-5">
        <span className="absolute text-[10px] text-gray-400 dark:text-gray-500 font-bold left-0">{formatTime(totalStart)}</span>
        {ticks.map((tk, ti) => (
          <span key={ti} className="absolute text-[10px] text-gray-300 dark:text-gray-600 font-bold -translate-x-1/2"
            style={{ left: `${pct(tk)}%` }}>{formatTime(tk)}</span>
        ))}
        <span className="absolute text-[10px] text-green-500 font-bold right-0">{formatTime(totalEnd)}</span>
      </div>

      {/* Schritte-Details pro Phase */}
      <div className="mt-8 space-y-4">
        {sections.map((section: any, sIdx: number) => {
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
                    <span className={`flex-1 text-gray-700 dark:text-gray-300 leading-relaxed ${step.type === 'Warten' ? 'opacity-60 italic' : ''}`}>
                      {step.instruction.length > 90 ? step.instruction.slice(0, 90) + '…' : step.instruction}
                    </span>
                    <span className="text-gray-300 dark:text-gray-600 text-[11px] flex-shrink-0 pt-px">{formatDuration(step.duration)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}