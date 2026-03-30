// ui/src/app/backplan/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, Clock, Check, AlignLeft, BarChart2,
  Sun, Timer, ThermometerSun, Flame, Play, Plus, Minus, X,
} from 'lucide-react';
import {
  type BakeSession, type TimelineStep, type PhaseGate,
  formatSmartTime, formatCountdown, formatDuration, formatStepDuration,
  formatTime, getActiveStep, getSoftDoneStep, getProgress, getPhases,
  getPhaseProgress, parseLocalDate,
} from '@/lib/backplan-utils';

const API = process.env.NEXT_PUBLIC_API_URL;
const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('crumb_token')}`,
});

// ── Loading Skeleton ────────────────────────────────────────
function BackplanSkeleton() {
  return (
    <div className="min-h-screen bg-[#FDFCFB] dark:bg-gray-900 flex items-center justify-center">
      <div className="animate-pulse flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-[#F5F0E8] dark:bg-gray-700" />
        <div className="h-4 w-40 bg-[#F5F0E8] dark:bg-gray-700 rounded-full" />
      </div>
    </div>
  );
}

// ── Haupt-Komponente ────────────────────────────────────────
export default function BackplanPage() {
  const [sessions, setSessions] = useState<BakeSession[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'focus' | 'schritte' | 'zeitplan'>('focus');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [finishModalId, setFinishModalId] = useState<number | null>(null);
  const [finishNotes, setFinishNotes] = useState('');
  const [tempInput, setTempInput] = useState('');
  const [showTempInput, setShowTempInput] = useState(false);

  // ── Daten laden ───────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/bake-sessions/active`, { headers: authHeaders() });
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    setIsLoading(false);
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Ticking Clock (1s) ────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Reload alle 30s (für soft_done etc.) ──────────────────
  useEffect(() => {
    const t = setInterval(loadSessions, 30000);
    return () => clearInterval(t);
  }, [loadSessions]);

  // ── Transition ausführen ──────────────────────────────────
  const transition = async (sessionId: number, stepIndex: number, action: string, extra: Record<string, any> = {}) => {
    try {
      const res = await fetch(`${API}/bake-sessions/${sessionId}/transition`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ stepIndex, action, ...extra }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error('Transition error:', err);
        return;
      }
      const data = await res.json();
      // Optimistic Update
      setSessions(prev => prev.map(s => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          step_states: data.step_states,
          step_timestamps: data.step_timestamps,
          projected_end: data.projected_end,
          timeline: data.timeline,
          gates: data.gates,
        };
      }));
    } catch (err) {
      console.error('Transition fetch error:', err);
      loadSessions(); // Fallback: reload
    }
  };

  // ── Backen abschließen ────────────────────────────────────
  const finishBaking = async (sessionId: number) => {
    try {
      const res = await fetch(`${API}/bake-sessions/${sessionId}/finish`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ notes: finishNotes || null }),
      });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        setActiveIdx(0);
        setFinishModalId(null);
        setFinishNotes('');
        if (sessions.length <= 1) window.location.href = '/';
      }
    } catch { alert('Fehler beim Abschließen'); }
  };

  // ── Aktive Session ────────────────────────────────────────
  const session = sessions[activeIdx];
  const timeline = session?.timeline || [];
  const gates = session?.gates || [];
  const progress = getProgress(timeline);

  const activeStep = useMemo(() => timeline.find(s => s.state === 'active') || null, [timeline]);
  const softDoneStep = useMemo(() => timeline.find(s => s.state === 'soft_done') || null, [timeline]);
  const focusStep = softDoneStep || activeStep;
  const nextSteps = useMemo(() => {
    if (!focusStep) return timeline.filter(s => s.state === 'ready' || s.state === 'locked').slice(0, 3);
    return timeline.filter(s => s.globalIdx > focusStep.globalIdx && s.state !== 'done').slice(0, 3);
  }, [timeline, focusStep]);

  // ── Timer-Berechnung ──────────────────────────────────────
  const remaining = useMemo(() => {
    if (!focusStep || !focusStep.end) return null;
    const endMs = new Date(focusStep.end).getTime();
    const diff = Math.max(0, Math.round((endMs - currentTime.getTime()) / 1000));
    return diff;
  }, [focusStep, currentTime]);

  const timerProgress = useMemo(() => {
    if (!focusStep || !focusStep.start || !focusStep.end) return 0;
    const startMs = new Date(focusStep.start).getTime();
    const endMs = new Date(focusStep.end).getTime();
    const total = endMs - startMs;
    if (total <= 0) return 1;
    return Math.min(1, (currentTime.getTime() - startMs) / total);
  }, [focusStep, currentTime]);

  // ── Sorted Phases ─────────────────────────────────────────
  const sortedPhases = useMemo(() => {
    const phases = getPhases(timeline);
    return phases.map(name => {
      const steps = timeline.filter(s => s.phase === name);
      const { done, total } = getPhaseProgress(timeline, name);
      const hasActive = steps.some(s => s.state === 'active' || s.state === 'soft_done');
      const allDone = done === total;
      const allLocked = steps.every(s => s.state === 'locked');
      return { name, steps, done, total, hasActive, allDone, allLocked };
    });
  }, [timeline]);

  // ── Loading / Empty ───────────────────────────────────────
  if (isLoading) return <BackplanSkeleton />;

  if (sessions.length === 0) return (
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

  if (!session) return null;

  const projectedEnd = session.projected_end ? new Date(session.projected_end) : null;
  const totalDuration = timeline.reduce((s, t) => s + t.duration, 0);

  // ── RENDER ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#FDFCFB] dark:bg-gray-900 pb-32 transition-colors duration-200">

      {/* ── FERTIG-MODAL ── */}
      {finishModalId !== null && (() => {
        const modalSession = sessions.find(s => s.id === finishModalId);
        if (!modalSession) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setFinishModalId(null)} />
            <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700">
              <div className="relative h-36 overflow-hidden rounded-t-3xl">
                <img src={modalSession.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=400'}
                  className="w-full h-full object-cover" alt="" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-3 left-4 right-4">
                  <p className="text-white font-extrabold text-[15px] truncate">{modalSession.title}</p>
                </div>
              </div>
              <div className="p-5">
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-3">Notizen zum Backergebnis (optional):</p>
                <textarea
                  value={finishNotes}
                  onChange={e => setFinishNotes(e.target.value)}
                  placeholder="z.B. Krume perfekt, nächstes Mal 5 Min länger Stockgare..."
                  className="w-full h-20 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-700 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-[#8B7355]/30 mb-4"
                />
                <button onClick={() => finishBaking(finishModalId)}
                  className="w-full py-3.5 rounded-2xl bg-[#8B7355] hover:bg-[#7A6347] active:scale-[0.98] text-white font-extrabold text-[14px] tracking-wide transition-all shadow-lg shadow-[#8B7355]/20 mb-3">
                  Fertig gebacken
                </button>
                <button onClick={() => setFinishModalId(null)}
                  className="w-full py-2 text-gray-400 dark:text-gray-500 font-bold text-[13px]">
                  Weiterbacken
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── REZEPT-SWITCHER ── */}
      {sessions.length > 1 && (
        <div className="bg-white dark:bg-gray-800 border-b border-[#F0EBE3] dark:border-gray-700">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-300 dark:text-gray-600 mb-2">
              {sessions.length} aktive Backpläne
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sessions.map((s, idx) => {
                const p = getProgress(s.timeline || []);
                const isActive = idx === activeIdx;
                return (
                  <button key={s.id} onClick={() => { setActiveIdx(idx); setActiveTab('focus'); }}
                    className={`flex-shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${
                      isActive ? 'bg-[#8B7355] border-[#8B7355] text-white' : 'bg-white dark:bg-gray-700 border-[#F0EBE3] dark:border-gray-600'
                    }`}>
                    <img src={s.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=100'}
                      className="w-8 h-8 rounded-lg object-cover" alt="" />
                    <div className="text-left min-w-0">
                      <div className={`text-[12px] font-extrabold truncate max-w-[130px] ${isActive ? 'text-white' : 'text-gray-800 dark:text-gray-100'}`}>
                        {s.title}
                      </div>
                      <div className={`text-[10px] font-bold ${isActive ? 'text-white/70' : 'text-[#8B7355]'}`}>
                        {Math.round(p * 100)}%
                      </div>
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
                <ChevronLeft size={18} className="text-gray-400" />
              </Link>
              <img src={session.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=200'}
                className="w-10 h-10 rounded-xl object-cover" alt="" />
              <div>
                <h1 className="text-[16px] font-extrabold tracking-tight leading-tight dark:text-gray-100">{session.title}</h1>
                <p className="text-[12px] text-[#8B7355] font-bold flex items-center gap-1">
                  <Clock size={11} />
                  {projectedEnd ? `Fertig um ~${formatSmartTime(projectedEnd)} Uhr` : 'Berechne...'}
                </p>
              </div>
            </div>
            <button onClick={() => setFinishModalId(session.id)}
              className="px-3 py-2 rounded-xl bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300 text-[11px] font-bold border border-green-100 dark:border-green-800">
              Fertig
            </button>
          </div>

          {/* Fortschrittsbalken */}
          <div className="flex gap-[2px] mb-3">
            {timeline.map((step, i) => {
              const widthPct = totalDuration > 0 ? (step.duration / totalDuration) * 100 : 0;
              const isDone = step.state === 'done';
              const isActiveStep = step.state === 'active' || step.state === 'soft_done';
              const prog = isActiveStep ? timerProgress : 0;
              return (
                <div key={i} className="h-1 rounded-full transition-all duration-500" style={{
                  flex: `${widthPct} 0 0%`,
                  background: isDone ? '#8B7355' : isActiveStep
                    ? `linear-gradient(90deg, #8B7355 ${prog * 100}%, #E8E2D8 ${prog * 100}%)`
                    : step.state === 'ready' ? '#D4C9B8' : '#E8E2D8',
                }} />
              );
            })}
          </div>

          {/* Tabs */}
          <div className="flex">
            {(['focus', 'schritte', 'zeitplan'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-bold border-b-2 transition-colors ${
                  activeTab === tab ? 'border-[#8B7355] text-[#8B7355]' : 'border-transparent text-gray-300 dark:text-gray-600'
                }`}>
                {tab === 'focus' ? <><Timer size={13} /> Fokus</> :
                 tab === 'schritte' ? <><AlignLeft size={13} /> Schritte</> :
                 <><BarChart2 size={13} /> Zeitplan</>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── TAB: FOKUS ── */}
      {activeTab === 'focus' && (
        <div className="max-w-3xl mx-auto px-4 pt-5">

          {/* Phase-Gate */}
          {gates.length > 0 && gates.map(gate => (
            <div key={gate.phase} className="mb-5 rounded-2xl border-2 border-dashed border-emerald-400/50 dark:border-emerald-600/50 bg-emerald-50/50 dark:bg-emerald-900/10 p-5">
              <div className="text-[13px] font-extrabold text-emerald-700 dark:text-emerald-400 mb-1">
                {gate.phase} kann starten
              </div>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-3">
                Alle Vorstufen sind fertig. Bereit für den nächsten Schritt?
              </p>
              <div className="flex gap-2 mb-3">
                {gate.dependencies.map(dep => (
                  <span key={dep} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-800/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">
                    <Check size={10} /> {dep}
                  </span>
                ))}
              </div>
              <button
                onClick={() => transition(session.id, gate.firstStepIdx, 'confirm_gate', { phase: gate.phase })}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[13px] transition-colors active:scale-[0.98]">
                {gate.phase} jetzt ansetzen
              </button>
            </div>
          ))}

          {/* Soft-Done Card */}
          {softDoneStep && (
            <div className="mb-5 rounded-2xl border-2 border-amber-400/60 dark:border-amber-600/40 bg-amber-50/50 dark:bg-amber-900/10 p-5">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-600 dark:text-amber-400">
                  {softDoneStep.phase}
                </span>
                <span className="text-[11px] font-bold text-amber-500">Zeit abgelaufen</span>
              </div>
              <p className="text-[14px] font-semibold text-gray-800 dark:text-gray-100 mb-4 leading-relaxed">
                {softDoneStep.instruction}
              </p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-4">
                Geplante Zeit ist abgelaufen. Ist der Teig fertig?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => transition(session.id, softDoneStep.globalIdx, 'complete')}
                  className="flex-1 py-3 rounded-xl bg-[#8B7355] text-white font-bold text-[13px] active:scale-[0.98]">
                  Ja, fertig
                </button>
                <button
                  onClick={() => transition(session.id, softDoneStep.globalIdx, 'extend_timer', { minutes: 15 })}
                  className="px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold text-[13px]">
                  +15 Min
                </button>
                <button
                  onClick={() => transition(session.id, softDoneStep.globalIdx, 'extend_timer', { minutes: 30 })}
                  className="px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold text-[13px]">
                  +30 Min
                </button>
              </div>
            </div>
          )}

          {/* Active Step Card */}
          {activeStep && !softDoneStep && (
            <div className="mb-5 rounded-2xl border-2 border-[#8B7355] bg-gradient-to-br from-[#FFFDF9] to-[#FAF7F2] dark:from-gray-800 dark:to-gray-750 p-5">
              <div className="flex justify-between items-center mb-2">
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide ${
                  activeStep.type === 'Backen' ? 'bg-red-500 text-white' :
                  activeStep.type === 'Aktion' ? 'bg-[#8B7355] text-white' :
                  'bg-[#F5F0E8] dark:bg-gray-700 text-[#8B7355]'
                }`}>
                  {activeStep.type === 'Backen' ? '🔥' : activeStep.type === 'Aktion' ? '👐' : '⏳'}
                  {' '}{activeStep.phase}
                </span>
                <span className="text-[11px] text-gray-400 font-bold">
                  {activeStep.start ? `seit ${formatTime(activeStep.start)}` : ''}
                </span>
              </div>

              <p className="text-[14px] font-semibold text-gray-800 dark:text-gray-100 mb-4 leading-relaxed">
                {activeStep.instruction}
              </p>

              {/* Timer (für Warten/Backen) */}
              {remaining !== null && remaining > 0 && (activeStep.type !== 'Aktion') && (
                <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white/60 dark:bg-gray-700/50 border border-[#F0EBE3] dark:border-gray-600">
                  <div className="w-11 h-11 rounded-full border-[3px] border-gray-200 dark:border-gray-600 flex items-center justify-center relative">
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 44 44">
                      <circle cx="22" cy="22" r="19" fill="none" stroke="#8B7355" strokeWidth="3"
                        strokeDasharray={`${timerProgress * 119.4} 119.4`} strokeLinecap="round" />
                    </svg>
                    <span className="text-[9px] font-bold text-[#8B7355]">{Math.round(timerProgress * 100)}%</span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Verbleibend</div>
                    <div className="text-[20px] font-extrabold text-gray-800 dark:text-gray-100 tabular-nums">
                      {formatCountdown(remaining)}
                    </div>
                  </div>
                  {activeStep.extended_by > 0 && (
                    <span className="ml-auto text-[10px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-lg">
                      +{activeStep.extended_by} Min
                    </span>
                  )}
                </div>
              )}

              {/* Temperatur-Input */}
              {showTempInput && (
                <div className="flex items-center gap-2 mb-4 p-3 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200/50 dark:border-blue-800/30">
                  <ThermometerSun size={16} className="text-blue-500 flex-shrink-0" />
                  <input
                    type="number" step="0.5" min="15" max="40" placeholder="z.B. 26"
                    value={tempInput} onChange={e => setTempInput(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <span className="text-[12px] text-gray-500">°C</span>
                  <button onClick={() => {
                    if (tempInput) {
                      transition(session.id, activeStep.globalIdx, 'log_temperature', { temperature: tempInput });
                      setTempInput('');
                      setShowTempInput(false);
                    }
                  }} className="px-3 py-2 rounded-lg bg-blue-500 text-white text-[12px] font-bold">
                    OK
                  </button>
                  <button onClick={() => setShowTempInput(false)} className="p-1 text-gray-400">
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2">
                {activeStep.type === 'Aktion' || activeStep.type === 'Kneten' ? (
                  <>
                    <button onClick={() => transition(session.id, activeStep.globalIdx, 'complete')}
                      className="flex-1 py-3 rounded-xl bg-[#8B7355] hover:bg-[#7A6347] text-white font-bold text-[13px] active:scale-[0.98] transition-all">
                      Erledigt
                    </button>
                    {!showTempInput && (
                      <button onClick={() => setShowTempInput(true)}
                        className="px-3 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-blue-500 transition-colors">
                        <ThermometerSun size={16} />
                      </button>
                    )}
                  </>
                ) : activeStep.type === 'Backen' ? (
                  <button onClick={() => transition(session.id, activeStep.globalIdx, 'complete')}
                    className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-[13px] active:scale-[0.98]">
                    🔥 Raus aus dem Ofen
                  </button>
                ) : (
                  <>
                    <button onClick={() => transition(session.id, activeStep.globalIdx, 'complete')}
                      className="flex-1 py-3 rounded-xl bg-[#8B7355] hover:bg-[#7A6347] text-white font-bold text-[13px] active:scale-[0.98]">
                      Fertig (Teig reif)
                    </button>
                    <button onClick={() => transition(session.id, activeStep.globalIdx, 'extend_timer', { minutes: 15 })}
                      className="px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold text-[12px]">
                      +15 Min
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Ready Backen-Step (wartet auf "Ofen bereit") */}
          {timeline.filter(s => s.state === 'ready' && s.type === 'Backen').map(step => (
            <div key={step.globalIdx} className="mb-5 rounded-2xl border-2 border-dashed border-red-300/60 dark:border-red-700/40 bg-red-50/30 dark:bg-red-900/10 p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-extrabold uppercase text-red-500">🔥 Bereit zum Backen</span>
              </div>
              <p className="text-[13px] text-gray-700 dark:text-gray-200 mb-3">{step.instruction}</p>
              <button
                onClick={() => transition(session.id, step.globalIdx, 'start_baking')}
                className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-[13px] active:scale-[0.98]">
                Ofen ist bereit — Backen starten
              </button>
            </div>
          ))}

          {/* Kein aktiver Step & keine Gates → alles erledigt? */}
          {!focusStep && gates.length === 0 && timeline.every(s => s.state === 'done') && (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">🎉</div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">Alle Schritte erledigt!</h3>
              <p className="text-gray-400 mb-6">Du kannst den Backplan jetzt abschließen.</p>
              <button onClick={() => setFinishModalId(session.id)}
                className="px-6 py-3 rounded-2xl bg-[#8B7355] text-white font-bold text-sm">
                Backen abschließen
              </button>
            </div>
          )}

          {/* Nächste Schritte */}
          {nextSteps.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-300 dark:text-gray-600 mb-2 px-1">
                Als Nächstes
              </p>
              <div className="flex flex-col gap-2">
                {nextSteps.map(step => (
                  <div key={step.globalIdx} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-[#F0EBE3] dark:border-gray-700">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      step.state === 'ready' ? 'bg-[#8B7355]' : 'bg-gray-200 dark:bg-gray-600'
                    }`} />
                    <span className="text-[12px] text-gray-600 dark:text-gray-300 flex-1 truncate">
                      {step.instruction}
                    </span>
                    <span className="text-[11px] text-gray-300 dark:text-gray-600 font-bold flex-shrink-0">
                      {step.state === 'locked' ? 'wartet' : formatStepDuration(step)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Multiplier Badge */}
          {session.multiplier && session.multiplier !== 1 && (
            <div className="mt-4 text-center">
              <span className="text-[10px] font-bold text-[#8B7355] bg-[#8B7355]/10 px-3 py-1 rounded-lg">
                {session.multiplier}× Menge
              </span>
            </div>
          )}

          {/* Link zum Rezept */}
          <div className="mt-6">
            <Link href={`/recipes/${session.recipe_id}`}
              className="block w-full text-center py-3 rounded-2xl bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-bold text-[12px] border border-[#F0EBE3] dark:border-gray-700 hover:bg-gray-100 transition-colors">
              Ganzes Rezept zeigen
            </Link>
          </div>
        </div>
      )}

      {/* ── TAB: SCHRITTE ── */}
      {activeTab === 'schritte' && (
        <div className="max-w-3xl mx-auto px-4 pt-5">
          {sortedPhases.map((phase, pIdx) => (
            <div key={pIdx} className="mb-6">
              {/* Phase Header */}
              <div className="flex items-center gap-3 mb-3 px-1">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold flex-shrink-0 ${
                  phase.hasActive ? 'bg-[#8B7355] text-white' :
                  phase.allDone ? 'bg-green-100 dark:bg-green-900/30 text-green-600' :
                  phase.allLocked ? 'bg-gray-100 dark:bg-gray-700 text-gray-400' :
                  'bg-[#F5F0E8] dark:bg-gray-700 text-[#8B7355]'
                }`}>
                  {phase.allDone ? <Check size={13} /> : pIdx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-extrabold text-gray-800 dark:text-gray-100">{phase.name}</span>
                  <span className="text-[11px] text-gray-400 ml-2">{phase.done}/{phase.total}</span>
                </div>
              </div>

              {/* Steps */}
              <div className="flex flex-col gap-2 pl-10">
                {phase.steps.map(step => {
                  const isDone = step.state === 'done';
                  const isActive = step.state === 'active' || step.state === 'soft_done';
                  const isLocked = step.state === 'locked';

                  return (
                    <div key={step.globalIdx}
                      className={`rounded-2xl p-4 transition-all ${
                        isActive ? 'border-2 border-[#8B7355] bg-gradient-to-br from-[#FFFDF9] to-[#FAF7F2] dark:from-gray-800 dark:to-gray-750' :
                        isDone ? 'border border-[#F0EBE3] dark:border-gray-700 bg-[#FAFAFA] dark:bg-gray-800/50 opacity-50' :
                        isLocked ? 'border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 opacity-40' :
                        'border border-[#F0EBE3] dark:border-gray-700 bg-white dark:bg-gray-800'
                      }`}>
                      <div className="flex justify-between items-center mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase ${
                            step.type === 'Backen' ? 'bg-red-500 text-white' :
                            step.type === 'Aktion' || step.type === 'Kneten' ? 'bg-[#8B7355] text-white' :
                            'bg-[#F5F0E8] dark:bg-gray-700 text-[#8B7355]'
                          }`}>
                            {step.type}
                          </span>
                          <span className="text-[11px] text-gray-300 dark:text-gray-600 font-bold">{formatStepDuration(step)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isDone && <Check size={13} className="text-green-500" />}
                          {isActive && <div className="w-2 h-2 rounded-full bg-[#8B7355] animate-pulse" />}
                          {isLocked && <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />}
                          {step.state === 'ready' && <div className="w-2 h-2 rounded-full bg-amber-400" />}
                        </div>
                      </div>
                      <p className={`text-[13px] leading-snug ${isDone ? 'text-gray-400 line-through' : isLocked ? 'text-gray-400' : 'text-gray-700 dark:text-gray-200'}`}>
                        {step.instruction}
                      </p>
                      {step.temperature && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-blue-500 font-bold">
                          <ThermometerSun size={10} /> {step.temperature}°C
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TAB: ZEITPLAN (simplified) ── */}
      {activeTab === 'zeitplan' && (
        <div className="max-w-3xl mx-auto px-4 pt-5">
          <div className="space-y-4">
            {sortedPhases.map((phase, pIdx) => {
              const COLORS = [
                { bg: 'bg-amber-50 dark:bg-amber-900/20', bar: '#F59E0B', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-100 dark:border-amber-800' },
                { bg: 'bg-blue-50 dark:bg-blue-900/20', bar: '#3B82F6', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-100 dark:border-blue-800' },
                { bg: 'bg-emerald-50 dark:bg-emerald-900/20', bar: '#10B981', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-800' },
                { bg: 'bg-rose-50 dark:bg-rose-900/20', bar: '#F43F5E', text: 'text-rose-700 dark:text-rose-400', border: 'border-rose-100 dark:border-rose-800' },
                { bg: 'bg-violet-50 dark:bg-violet-900/20', bar: '#8B5CF6', text: 'text-violet-700 dark:text-violet-400', border: 'border-violet-100 dark:border-violet-800' },
              ];
              const c = COLORS[pIdx % COLORS.length];

              return (
                <div key={pIdx} className={`rounded-2xl border p-4 ${c.bg} ${c.border}`}>
                  <div className={`text-[11px] font-extrabold uppercase tracking-widest mb-3 ${c.text}`}>
                    {phase.name}
                    <span className="opacity-60 ml-2 normal-case">{phase.done}/{phase.total} erledigt</span>
                  </div>
                  <div className="space-y-2">
                    {phase.steps.map(step => (
                      <div key={step.globalIdx} className="flex items-start gap-2 text-[12px]">
                        <span className="w-3 flex-shrink-0 pt-1">
                          {step.state === 'done' ? <Check size={10} className="text-green-500" /> :
                           step.state === 'active' || step.state === 'soft_done' ? <div className="w-2 h-2 rounded-full bg-[#8B7355] animate-pulse mt-0.5" /> :
                           <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 mt-0.5" />}
                        </span>
                        <span className={`flex-1 ${
                          step.state === 'done' ? 'text-gray-400 line-through' :
                          step.state === 'locked' ? 'text-gray-400 opacity-60' :
                          'text-gray-700 dark:text-gray-300'
                        } ${step.type === 'Warten' || step.type === 'Ruhen' || step.type === 'Kühl' ? 'italic opacity-60' : ''}`}>
                          {step.instruction.length > 80 ? step.instruction.slice(0, 80) + '…' : step.instruction}
                        </span>
                        <span className="text-gray-300 dark:text-gray-600 text-[11px] flex-shrink-0 pt-px">{formatStepDuration(step)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {projectedEnd && (
            <div className="text-center mt-6 text-[12px] text-gray-400">
              Voraussichtlich fertig um {formatSmartTime(projectedEnd)} Uhr
            </div>
          )}
        </div>
      )}
    </div>
  );
}
