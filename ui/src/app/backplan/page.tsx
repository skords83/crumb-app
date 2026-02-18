"use client";

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { getApiUrl } from "@/lib/api-config";
import { Clock, ChevronLeft, Check, List, Play, Timer, Sun, BookOpen, X } from 'lucide-react';
import Link from 'next/link';

export default function BackplanPage() {
  const [plannedRecipes, setPlannedRecipes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [showOverview, setShowOverview] = useState<number | null>(null); // recipeId or null
  const activeCardRef = useRef<HTMLDivElement>(null);

  // Timer jede Sekunde für Countdown
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Rezepte laden
  useEffect(() => {
    fetch(`${getApiUrl()}/recipes`)
      .then(res => res.json())
      .then(data => {
        const planned = data
          .filter((r: any) => r.planned_at)
          .sort((a: any, b: any) => parseLocalDate(a.planned_at).getTime() - parseLocalDate(b.planned_at).getTime());
        setPlannedRecipes(planned);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Fehler:", err);
        setIsLoading(false);
      });
  }, []);

  // Scroll zu aktivem Schritt
  useEffect(() => {
    if (activeCardRef.current) {
      activeCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [plannedRecipes]);

  // ============================================================
  // HILFSFUNKTIONEN
  // ============================================================

  const parseLocalDate = (dateStr: string): Date => {
    if (!dateStr) return new Date();
    if (dateStr.includes('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
      return new Date(dateStr);
    }
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

  const formatTime = (date: Date): string => {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

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

  // ============================================================
  // STEP-LEVEL TIMELINE (statt Phase-Level)
  // ============================================================

  const calculateStepTimeline = (targetDateTime: string, sections: any[]) => {
    if (!sections || sections.length === 0) return [];

    let currentMoment = parseLocalDate(targetDateTime);
    const timeline: any[] = [];
    const reversedSections = [...sections].reverse();
    let mergePoint = new Date(currentMoment.getTime());

    reversedSections.forEach((section) => {
      const totalDuration = (section.steps || []).reduce(
        (sum: number, step: any) => sum + (parseInt(step.duration) || 0), 0
      );
      const isParallel = (section.name || '').toLowerCase().includes('vorteig') || section.is_parallel;

      const sectionEnd = isParallel
        ? new Date(mergePoint.getTime())
        : new Date(currentMoment.getTime());
      const sectionStart = new Date(sectionEnd.getTime() - totalDuration * 60000);

      // Einzelne Steps mit konkreten Zeiten
      let stepMoment = new Date(sectionStart.getTime());
      const steps = section.steps || [];
      steps.forEach((step: any) => {
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
          isParallel,
        });

        stepMoment = stepEnd;
      });

      if (!isParallel) {
        currentMoment = sectionStart;
        mergePoint = sectionStart;
      }
    });

    // Chronologisch sortieren
    timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
    return timeline;
  };

  // ============================================================
  // STEP TOGGLE
  // ============================================================

  const toggleStep = (recipeId: number, stepIdx: number) => {
    const key = `${recipeId}-${stepIdx}`;
    setCompletedSteps(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ============================================================
  // FERTIG
  // ============================================================

  const finishBaking = async (recipeId: number) => {
    if (!confirm("Brot fertig?")) return;
    try {
      const res = await fetch(`${getApiUrl()}/recipes/${recipeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planned_at: null }),
      });
      if (res.ok) {
        setPlannedRecipes(prev => prev.filter(r => r.id !== recipeId));
        if (plannedRecipes.length <= 1) window.location.href = "/";
      }
    } catch (err) { alert("Fehler"); }
  };

  // ============================================================
  // RENDER
  // ============================================================

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFCFB]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#8B7355] mx-auto mb-4" />
        <p className="text-gray-400 font-bold text-sm uppercase tracking-widest animate-pulse">Backplan wird geladen...</p>
      </div>
    </div>
  );

  if (plannedRecipes.length === 0) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFCFB] px-6">
      <div className="text-center">
        <div className="w-20 h-20 rounded-full bg-[#F5F0E8] flex items-center justify-center mx-auto mb-6">
          <Sun size={32} className="text-[#8B7355]" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Keine Backpläne aktiv</h2>
        <p className="text-gray-400 mb-8">Plane ein Rezept um hier loszulegen.</p>
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
        const totalDuration = timeline.reduce((s, t) => s + t.duration, 0);

        // Aktiven und nächsten Schritt finden
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

        // Gesamtfortschritt
        const totalProgress = timeline.length > 0
          ? timeline.filter((s, i) => completedSteps.has(`${recipe.id}-${i}`) || currentTime > s.end).length / timeline.length
          : 0;

        return (
          <div key={recipe.id}>
            {/* STICKY HEADER */}
            <div className="sticky top-0 z-50 bg-[#FDFCFB]/92 backdrop-blur-xl border-b border-[#F0EBE3]">
              <div className="max-w-3xl mx-auto px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Link href="/" className="p-2 rounded-xl hover:bg-[#F5F0E8] transition-colors">
                      <ChevronLeft size={18} className="text-gray-400" />
                    </Link>
                    <img src={recipe.image_url || 'https://via.placeholder.com/48'} className="w-11 h-11 rounded-xl object-cover" alt="" />
                  <div>
                    <h1 className="text-[17px] font-extrabold tracking-tight leading-tight">{recipe.title}</h1>
                    <p className="text-[13px] text-[#8B7355] font-bold flex items-center gap-1">
                      <Clock size={13} /> Fertig um {extractTimeFromString(recipe.planned_at)} Uhr
                    </p>
                  </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowOverview(recipe.id)}
                      className="p-2.5 rounded-xl border-2 border-[#F0EBE3] bg-white text-[#8B7355] hover:border-[#8B7355] transition-colors"
                      title="Alle Schritte"
                    >
                      <List size={16} />
                    </button>
                    <button
                      onClick={() => finishBaking(recipe.id)}
                      className="px-3 py-2 rounded-xl bg-green-50 text-green-600 text-[11px] font-bold border border-green-100 hover:bg-green-100 transition-colors"
                    >
                      Fertig
                    </button>
                  </div>
                </div>

                {/* Fortschrittsbalken */}
                <div className="mt-3 flex gap-[3px]">
                  {timeline.map((step, i) => {
                    const isDone = completedSteps.has(`${recipe.id}-${i}`) || currentTime > step.end;
                    const isActive = i === activeIndex;
                    const widthPercent = totalDuration > 0 ? (step.duration / totalDuration) * 100 : 0;
                    const prog = isActive ? stepProgress : 0;

                    return (
                      <div
                        key={i}
                        className="h-1 rounded-full transition-all duration-500"
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
              </div>
            </div>

            {/* TIMELINE */}
            <div className="max-w-3xl mx-auto px-6 pt-6">
              <div className="flex flex-col gap-3">
                {timeline.map((step, i) => {
                  const key = `${recipe.id}-${i}`;
                  const isDone = completedSteps.has(key) || currentTime > step.end;
                  const isActive = i === activeIndex;
                  const isNext = i === nextIndex;

                  // Phase-Wechsel?
                  const showPhaseHeader = i === 0 || timeline[i - 1].phase !== step.phase;

                  return (
                    <div key={i}>
                      {/* Phase Header */}
                      {showPhaseHeader && (
                        <div className={`flex items-center gap-3 ${i === 0 ? 'mb-3' : 'mt-5 mb-3'}`}>
                          <span className="w-7 h-7 rounded-full bg-[#8B7355] text-white flex items-center justify-center text-[11px] font-extrabold flex-shrink-0">
                            {(recipe.dough_sections || []).findIndex((s: any) => s.name === step.phase) + 1}
                          </span>
                          <span className="text-[12px] font-extrabold text-[#8B7355] uppercase tracking-widest">
                            {step.phase}
                          </span>
                          <div className="flex-1 h-px bg-[#F0EBE3]" />
                        </div>
                      )}

                      {/* Step Card */}
                      <div
                        ref={isActive ? activeCardRef : null}
                        onClick={() => (isDone || isActive) ? toggleStep(recipe.id, i) : undefined}
                        className="flex gap-4"
                        style={{ cursor: isDone || isActive ? 'pointer' : 'default' }}
                      >
                        {/* Zeitspalte */}
                        <div className="w-[60px] text-right flex-shrink-0" style={{ paddingTop: isActive ? 20 : 14 }}>
                          <span className={`text-[13px] font-extrabold ${isActive ? 'text-[#8B7355]' : isDone ? 'text-gray-200' : 'text-gray-300'}`}>
                            {formatTime(step.start)}
                          </span>
                        </div>

                        {/* Karte */}
                        <div
                          className={`flex-1 transition-all duration-300 ${
                            isActive
                              ? 'rounded-3xl border-2 border-[#8B7355] bg-gradient-to-br from-[#FFFDF9] to-[#FAF7F2] p-5'
                              : isNext
                                ? 'rounded-2xl border-2 border-dashed border-[#D4C9B8] bg-white p-4'
                                : isDone
                                  ? 'rounded-2xl border border-[#F0EBE3] bg-[#FAFAFA] p-4 opacity-50'
                                  : 'rounded-2xl border border-[#F0EBE3] bg-white p-4 hover:border-[#E0D8CC]'
                          }`}
                        >
                          {/* Badge + Dauer */}
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wide ${
                                step.type === 'Aktion'
                                  ? 'bg-[#8B7355] text-white'
                                  : 'bg-[#F5F0E8] text-[#8B7355]'
                              }`}>
                                {step.type === 'Aktion' ? '👐' : '⏳'} {step.type}
                              </span>
                              <span className="text-[11px] text-gray-300 font-bold">
                                {formatDuration(step.duration)}
                              </span>
                            </div>
                            {isDone && <Check size={16} className="text-[#8B7355]" />}
                          </div>

                          {/* Anleitung */}
                          <p className={`text-[15px] leading-relaxed m-0 ${
                            isActive ? 'text-[17px] font-semibold text-[#2D2D2D]' : isDone ? 'text-gray-400 line-through' : 'text-gray-600 font-medium'
                          }`}>
                            {step.instruction}
                          </p>

                          {/* === AKTIVER SCHRITT: Erweiterte Infos === */}
                          {isActive && (
                            <>
                              {/* Timer */}
                              <div className={`mt-4 rounded-2xl p-4 flex items-center justify-between ${
                                step.type === 'Wartezeit'
                                  ? 'bg-[#F5F0E8]'
                                  : 'bg-gradient-to-br from-[#8B7355] to-[#6B5740]'
                              }`}>
                                <div>
                                  <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${
                                    step.type === 'Wartezeit' ? 'text-[#8B7355]' : 'text-white/70'
                                  }`}>
                                    {step.type === 'Wartezeit' ? 'Restzeit' : 'Timer'}
                                  </div>
                                  <div className={`text-[28px] font-extrabold tabular-nums tracking-tight ${
                                    step.type === 'Wartezeit' ? 'text-[#2D2D2D]' : 'text-white'
                                  }`}>
                                    {formatCountdown(remainingSeconds)}
                                  </div>
                                </div>
                                {/* Kreisförmiger Fortschritt */}
                                <div className="relative w-12 h-12">
                                  <svg width="48" height="48" className="absolute -rotate-90">
                                    <circle cx="24" cy="24" r="20" fill="none"
                                      stroke={step.type === 'Wartezeit' ? '#E8E2D8' : 'rgba(255,255,255,0.2)'}
                                      strokeWidth="3"
                                    />
                                    <circle cx="24" cy="24" r="20" fill="none"
                                      stroke={step.type === 'Wartezeit' ? '#8B7355' : 'white'}
                                      strokeWidth="3"
                                      strokeDasharray={`${2 * Math.PI * 20}`}
                                      strokeDashoffset={`${2 * Math.PI * 20 * (1 - stepProgress)}`}
                                      strokeLinecap="round"
                                      className="transition-all duration-1000 ease-linear"
                                    />
                                  </svg>
                                </div>
                              </div>

                              {/* Fortschrittsbalken */}
                              <div className="mt-3 h-1 rounded-full bg-[#E8E2D8]">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-[#8B7355] to-[#A0845C] transition-all duration-1000 ease-linear"
                                  style={{ width: `${stepProgress * 100}%` }}
                                />
                              </div>

                              {/* Zutaten (nur bei Aktion) */}
                              {step.type === 'Aktion' && step.ingredients.length > 0 && (
                                <div className="mt-4 bg-white rounded-2xl p-4 border border-[#F0EBE3]">
                                  <div className="text-[10px] font-extrabold text-gray-300 uppercase tracking-widest mb-3">
                                    Zutaten – {step.phase}
                                  </div>
                                  {step.ingredients.map((ing: any, ii: number) => (
                                    <div key={ii} className={`flex justify-between py-2 text-[14px] ${ // py-2 für mehr Klickfläche
                                      ii < step.ingredients.length - 1 ? 'border-b border-[#F8F6F2]' : ''
                                    }`}>
                                      <span className="text-gray-600 font-medium">{ing.name}</span>
                                      <span className="font-extrabold text-[#2D2D2D] bg-[#F8F6F2] px-2.5 py-0.5 rounded-lg">
                                        {ing.amount} {ing.unit}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Zeitspanne */}
                              <div className="mt-3 flex justify-between text-[11px] text-gray-300 font-semibold">
                                <span>{formatTime(step.start)} Uhr</span>
                                <span>→</span>
                                <span>{formatTime(step.end)} Uhr</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* ENDZEITPUNKT */}
                <div className="flex gap-4 mt-2">
                  <div className="w-[50px] text-right flex-shrink-0 pt-3">
                    <span className="text-[11px] font-extrabold text-green-500">
                      {extractTimeFromString(recipe.planned_at)}
                    </span>
                  </div>
                  <div className="flex-1 rounded-2xl border-2 border-green-100 bg-green-50 p-4">
                    <span className="text-green-700 font-bold text-[14px]">Brot fertig!</span>
                  </div>
                </div>

                {/* GANZES REZEPT BUTTON */}
                <div className="mt-6">
                  <Link
                    href={`/recipes/${recipe.id}`}
                    className="block w-full text-center py-4 rounded-2xl bg-[#8B7355] text-white font-extrabold text-[13px] uppercase tracking-widest shadow-lg shadow-[#8B7355]/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Ganzes Rezept zeigen
                  </Link>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* NÄCHSTER SCHRITT PREVIEW (fixed bottom) */}
      {plannedRecipes.map((recipe) => {
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
          <div key={`next-${recipe.id}`} className="fixed bottom-0 left-0 right-0 z-40 bg-[#FDFCFB]/95 backdrop-blur-xl border-t border-[#F0EBE3]">
            <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F5F0E8] flex items-center justify-center flex-shrink-0 text-[15px]">
                {nextStep.type === 'Aktion' ? '👐' : '⏳'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-[#8B7355] uppercase tracking-widest">
                  Nächster Schritt um {formatTime(nextStep.start)}
                </div>
                <div className="text-[13px] font-semibold text-[#2D2D2D] truncate">
                  {nextStep.instruction}
                </div>
              </div>
              <span className="text-[11px] font-bold text-gray-300 flex-shrink-0">
                {formatDuration(nextStep.duration)}
              </span>
            </div>
          </div>
        );
      })}

      {/* ALLE SCHRITTE OVERLAY */}
      {showOverview !== null && (() => {
        const recipe = plannedRecipes.find(r => r.id === showOverview);
        if (!recipe) return null;
        const timeline = calculateStepTimeline(recipe.planned_at, recipe.dough_sections);
        const activeIndex = timeline.findIndex((s, i) =>
          !completedSteps.has(`${recipe.id}-${i}`) && currentTime >= s.start && currentTime < s.end
        );

        return (
          <div
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex justify-end"
            onClick={() => setShowOverview(null)}
          >
            <div
              className="w-full max-w-[420px] bg-[#FFFDF9] h-full overflow-y-auto p-7"
              style={{ boxShadow: '-8px 0 40px rgba(0,0,0,0.1)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-extrabold">Alle Schritte</h2>
                <button
                  onClick={() => setShowOverview(null)}
                  className="w-9 h-9 rounded-xl bg-[#F5F0E8] flex items-center justify-center text-[#8B7355] hover:bg-[#E8E2D8] transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Phasen */}
              {(recipe.dough_sections || []).map((section: any, si: number) => (
                <div key={si} className="mb-7">
                  <div className="text-[13px] font-extrabold text-[#8B7355] uppercase tracking-widest mb-3 pb-2 border-b-2 border-[#F0EBE3]">
                    {section.name}
                  </div>

                  {/* Zutaten */}
                  <div className="bg-[#FAF7F2] rounded-2xl p-4 mb-3 border border-[#F0EBE3]">
                    <div className="text-[10px] font-extrabold text-gray-300 uppercase tracking-widest mb-2">Zutaten</div>
                    {(section.ingredients || []).map((ing: any, ii: number) => (
                      <div key={ii} className={`flex justify-between py-1.5 text-[13px] ${
                        ii < section.ingredients.length - 1 ? 'border-b border-[#EDE8DF]' : ''
                      }`}>
                        <span className="text-gray-500">{ing.name}</span>
                        <span className="font-bold text-[#2D2D2D]">{ing.amount} {ing.unit}</span>
                      </div>
                    ))}
                  </div>

                  {/* Steps */}
                  <div className="flex flex-col gap-1.5">
                    {(section.steps || []).map((step: any, sti: number) => {
                      const globalIdx = timeline.findIndex(
                        t => t.phase === section.name && t.instruction === step.instruction
                      );
                      const isDone = completedSteps.has(`${recipe.id}-${globalIdx}`) || (globalIdx >= 0 && currentTime > timeline[globalIdx]?.end);
                      const isActive = globalIdx === activeIndex;

                      return (
                        <div key={sti} className={`flex gap-2.5 p-3 rounded-xl ${
                          isActive
                            ? 'bg-[#8B7355] text-white'
                            : 'bg-white border border-[#F0EBE3]'
                        } ${isDone ? 'opacity-40' : ''}`}>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[9px] font-extrabold flex-shrink-0 mt-0.5 ${
                            isActive
                              ? 'border-white/40 text-white'
                              : step.type === 'Aktion'
                                ? 'bg-[#8B7355] border-[#8B7355] text-white'
                                : 'border-[#D4C9B8] text-gray-400'
                          }`}>
                            {sti + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-[12px] font-medium leading-relaxed m-0 ${
                              isDone ? 'line-through' : ''
                            } ${isActive ? 'text-white' : 'text-gray-600'}`}>
                              {step.instruction}
                            </p>
                            <span className={`text-[10px] font-bold mt-1 inline-block ${
                              isActive ? 'text-white/60' : 'text-gray-300'
                            }`}>
                              {step.type} · {formatDuration(parseInt(step.duration) || 0)}
                              {globalIdx >= 0 && timeline[globalIdx] && ` · ${formatTime(timeline[globalIdx].start)}`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}