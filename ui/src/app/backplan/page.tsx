// DATEI: ui/src/app/backplan/page.tsx
// Einzelner scrollbarer Flow. Fokus-Card + Phasen mit Steps + aufklappbare Zutaten.

'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronDown, ChevronUp, Clock, Check, Sun, Filter } from 'lucide-react';
import { type BakeSession, type TimelineStep, type PhaseGate, formatSmartTime, formatCountdown, formatDuration, formatStepDuration, getProgress, getPhases, getPhaseProgress } from '@/lib/backplan-utils';

const API = process.env.NEXT_PUBLIC_API_URL;
const authHeaders = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` });

function scaleAmount(rawAmount: string | number, multiplier: number): string {
  if (multiplier === 1) return String(rawAmount);
  const parsed = parseFloat(String(rawAmount || '0').replace(',', '.'));
  if (isNaN(parsed) || parsed === 0) return String(rawAmount);
  const result = Math.round(parsed * multiplier * 10) / 10;
  return result % 1 === 0 ? String(result) : String(result).replace('.', ',');
}

function BackplanSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] flex items-center justify-center">
      <div className="animate-pulse flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-[#D6C9B4] dark:bg-white/10" />
        <div className="h-4 w-40 bg-[#D6C9B4] dark:bg-white/10 rounded-full" />
      </div>
    </div>
  );
}

export default function BackplanPage() {
  const [sessions, setSessions] = useState<BakeSession[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [finishModalId, setFinishModalId] = useState<number | null>(null);
  const [finishNotes, setFinishNotes] = useState('');
  const [openIngredients, setOpenIngredients] = useState<Set<string>>(new Set());
  const activeCardRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => { try { const res = await fetch(`${API}/bake-sessions/active`, { headers: authHeaders() }); const data = await res.json(); setSessions(Array.isArray(data) ? data : []); } catch {} setIsLoading(false); }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { const t = setInterval(() => setCurrentTime(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(loadSessions, 30000); return () => clearInterval(t); }, [loadSessions]);

  const transition = async (sid: number, stepIdx: number, action: string, extra: Record<string, any> = {}) => {
    try { const res = await fetch(`${API}/bake-sessions/${sid}/transition`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ stepIndex: stepIdx, action, ...extra }) }); if (!res.ok) return; const data = await res.json(); setSessions(prev => prev.map(s => s.id !== sid ? s : { ...s, step_states: data.step_states, step_timestamps: data.step_timestamps, projected_end: data.projected_end, timeline: data.timeline, gates: data.gates })); } catch { loadSessions(); }
  };

  const finishBaking = async (sid: number) => {
    try { const res = await fetch(`${API}/bake-sessions/${sid}/finish`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ notes: finishNotes || null }) }); if (res.ok) { setSessions(prev => prev.filter(s => s.id !== sid)); setActiveIdx(0); setFinishModalId(null); setFinishNotes(''); if (sessions.length <= 1) window.location.href = '/'; } } catch { alert('Fehler'); }
  };

  const toggleIng = (key: string) => setOpenIngredients(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const session = sessions[activeIdx];
  const timeline = session?.timeline || [];
  const gates = session?.gates || [];
  const multiplier = session?.multiplier || 1;

  const allActiveSteps = useMemo(() => timeline.filter(s => s.state === 'active'), [timeline]);
  const allSoftDoneSteps = useMemo(() => timeline.filter(s => s.state === 'soft_done'), [timeline]);

  const activeStep = allActiveSteps[0] || null;
  const softDoneStep = allSoftDoneSteps[0] || null;
  const focusStep = softDoneStep || activeStep;

  const parallelActiveSteps = useMemo(() => {
    if (!activeStep) return [];
    return allActiveSteps.filter(s => s.globalIdx !== activeStep.globalIdx);
  }, [allActiveSteps, activeStep]);

  const parallelSoftDoneSteps = useMemo(() => {
    if (!softDoneStep) return [];
    return allSoftDoneSteps.filter(s => s.globalIdx !== softDoneStep.globalIdx);
  }, [allSoftDoneSteps, softDoneStep]);

  const totalDuration = timeline.reduce((s, t) => s + t.duration, 0);

  const remaining = useMemo(() => { if (!focusStep?.end) return null; return Math.max(0, Math.round((new Date(focusStep.end).getTime() - currentTime.getTime()) / 1000)); }, [focusStep, currentTime]);
  const timerProgress = useMemo(() => { if (!focusStep?.start || !focusStep?.end) return 0; const s = new Date(focusStep.start).getTime(), e = new Date(focusStep.end).getTime(); return e <= s ? 1 : Math.min(1, (currentTime.getTime() - s) / (e - s)); }, [focusStep, currentTime]);

  const stepRemaining = useCallback((step: TimelineStep) => {
    if (!step.end) return null;
    return Math.max(0, Math.round((new Date(step.end).getTime() - currentTime.getTime()) / 1000));
  }, [currentTime]);

  const sortedPhases = useMemo(() => getPhases(timeline).map(name => { const steps = timeline.filter(s => s.phase === name); const { done, total } = getPhaseProgress(timeline, name); return { name, steps, done, total, hasActive: steps.some(s => s.state === 'active' || s.state === 'soft_done'), allDone: done === total, allLocked: steps.every(s => s.state === 'locked') }; }), [timeline]);

  useEffect(() => { if (!session) return; const ap = sortedPhases.find(p => p.hasActive); if (ap) { const k = `${session.id}-${ap.name}`; setOpenIngredients(prev => { if (prev.has(k)) return prev; const n = new Set(prev); n.add(k); return n; }); } }, [session?.id, sortedPhases]);
  useEffect(() => { if (activeCardRef.current) setTimeout(() => activeCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); }, [session?.id]);

  const getSec = (name: string) => session?.dough_sections?.find((s: any) => s.name === name);

  if (isLoading) return <BackplanSkeleton />;
  if (sessions.length === 0) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F0E8] dark:bg-[#0F172A] px-6">
      <div className="text-center">
        <div className="w-20 h-20 rounded-full bg-[#EDE5D6] dark:bg-white/10 flex items-center justify-center mx-auto mb-6">
          <Sun size={32} className="text-[#8B7355] dark:text-[#C4A484]" />
        </div>
        <h2 className="text-2xl font-bold text-[#2C1A0E] dark:text-white/90 mb-2">Keine Backpläne aktiv</h2>
        <p className="text-[#A68B6A] dark:text-white/40 mb-8">Plane ein Rezept um hier loszulegen.</p>
        <Link href="/" className="inline-flex items-center gap-2 bg-[#8B7355] text-white px-6 py-3 rounded-2xl font-bold text-sm">
          <ChevronLeft size={16} /> Zur Übersicht
        </Link>
      </div>
    </div>
  );
  if (!session) return null;
  const projectedEnd = session.projected_end ? new Date(session.projected_end) : null;

  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] pb-32 transition-colors duration-200">

      {/* ── Finish Modal ── */}
      {finishModalId !== null && (() => { const ms = sessions.find(s => s.id === finishModalId); if (!ms) return null; return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0">
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={() => setFinishModalId(null)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-[#D6C9B4] dark:border-white/10">
            <div className="relative h-36 overflow-hidden rounded-t-3xl">
              <img src={ms.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=400'} className="w-full h-full object-cover" alt="" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-3 left-4"><p className="text-white font-extrabold text-[15px] truncate">{ms.title}</p></div>
            </div>
            <div className="p-5">
              <p className="text-[13px] text-[#A68B6A] dark:text-white/50 mb-3">Notizen zum Backergebnis (optional):</p>
              <textarea
                value={finishNotes}
                onChange={e => setFinishNotes(e.target.value)}
                placeholder="z.B. Krume perfekt, nächstes Mal länger Stockgare..."
                className="w-full h-20 px-3 py-2 rounded-xl border border-[#D6C9B4] dark:border-white/10 bg-[#F5F0E8] dark:bg-white/5 text-sm text-[#2C1A0E] dark:text-white/80 resize-none focus:outline-none focus:ring-2 focus:ring-[#8B7355]/30 mb-4 placeholder:text-[#C4A484] dark:placeholder:text-white/20"
              />
              <button onClick={() => finishBaking(finishModalId)} className="w-full py-3.5 rounded-2xl bg-[#8B7355] hover:bg-[#7A6347] active:scale-[0.98] text-white font-extrabold text-[14px] transition-all shadow-lg shadow-[#8B7355]/20 mb-3">Fertig gebacken</button>
              <button onClick={() => setFinishModalId(null)} className="w-full py-2 text-[#A68B6A] dark:text-white/30 font-bold text-[13px]">Weiterbacken</button>
            </div>
          </div>
        </div>); })()}

      {/* ── Mehrsessions-Switcher ── */}
      {sessions.length > 1 && (
        <div className="bg-[#EDE5D6] dark:bg-[#0F172A] border-b border-[#D6C9B4] dark:border-white/[0.07]">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#A68B6A] dark:text-white/20 mb-2">{sessions.length} aktive Backpläne</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sessions.map((s, idx) => { const p = getProgress(s.timeline || []); const isAct = idx === activeIdx; return (
                <button key={s.id} onClick={() => setActiveIdx(idx)}
                  className={`flex-shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${
                    isAct
                      ? 'bg-[#8B7355]/15 border-[#8B7355]/40 dark:bg-[#C4A484]/20 dark:border-[#C4A484]/40'
                      : 'bg-white dark:bg-white/5 border-[#D6C9B4] dark:border-white/10'
                  }`}>
                  <img src={s.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=100'} className="w-8 h-8 rounded-lg object-cover" alt="" />
                  <div className="text-left min-w-0">
                    <div className={`text-[12px] font-extrabold truncate max-w-[130px] ${isAct ? 'text-[#5C3D1E] dark:text-white' : 'text-[#2C1A0E] dark:text-white/70'}`}>{s.title}</div>
                    <div className={`text-[10px] font-bold ${isAct ? 'text-[#8B7355] dark:text-[#C4A484]' : 'text-[#A68B6A] dark:text-white/30'}`}>{Math.round(p * 100)}%</div>
                  </div>
                </button>); })}
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky Header ── */}
      <div className="sticky top-0 z-30 bg-[#F5F0E8] dark:bg-[#0F172A] border-b border-[#D6C9B4] dark:border-white/[0.07]">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link href="/" className="p-2 rounded-xl hover:bg-[#EDE5D6] dark:hover:bg-white/10 transition-colors">
                <ChevronLeft size={18} className="text-[#A68B6A] dark:text-white/40" />
              </Link>
              <img src={session.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=200'} className="w-10 h-10 rounded-xl object-cover" alt="" />
              <div>
                <h1
                  className="text-[17px] leading-tight text-[#2C1A0E] dark:text-[#F5EDD8]"
                  style={{ fontFamily: 'var(--font-dm-serif), serif' }}
                >{session.title}</h1>
                <p className="text-[12px] text-[#8B7355] dark:text-[#C4A484]/70 font-medium flex items-center gap-1">
                  <Clock size={11} />
                  {projectedEnd ? `Fertig um ~${formatSmartTime(projectedEnd)} Uhr` : 'Berechne...'}
                </p>
              </div>
            </div>
            <button onClick={() => setFinishModalId(session.id)}
              className="px-3 py-2 rounded-xl bg-green-600/10 dark:bg-green-500/15 text-green-700 dark:text-green-400 text-[11px] font-bold border border-green-600/20 dark:border-green-500/20 hover:bg-green-600/15 dark:hover:bg-green-500/25 transition-colors">
              Fertig
            </button>
          </div>

          {/* Pro-Teig-Fortschrittsbalken */}
          <div className="flex flex-col gap-[5px]">
            {sortedPhases.map((phase) => {
              const { done, total } = getPhaseProgress(timeline, phase.name);
              const pct = total > 0 ? done / total : 0;
              const isDone = pct === 1;
              const isActive = phase.hasActive;
              const isLocked = phase.allLocked;
              return (
                <div key={phase.name} className="flex items-center gap-2">
                  <span className={`text-[10px] w-[72px] flex-shrink-0 truncate font-bold ${
                    isDone ? 'text-[#8B7355]/50 dark:text-[#C4A484]/50'
                    : isActive ? 'text-[#8B7355] dark:text-[#C4A484]'
                    : 'text-[#C4A484] dark:text-white/20'
                  }`}>
                    {phase.name}
                  </span>
                  <div className="flex-1 h-[3px] rounded-full bg-[#D6C9B4] dark:bg-white/[0.07] overflow-hidden">
                    {isDone && <div className="h-full w-full rounded-full bg-[#8B7355]/40 dark:bg-[#C4A484]/40" />}
                    {isActive && <div className="h-full rounded-full bg-[#8B7355] dark:bg-[#C4A484] animate-pulse" style={{ width: `${pct * 100}%` }} />}
                    {!isDone && !isActive && !isLocked && <div className="h-full rounded-full bg-[#8B7355]/25 dark:bg-[#C4A484]/25" style={{ width: `${pct * 100}%` }} />}
                  </div>
                  <span className={`text-[10px] w-5 text-right flex-shrink-0 font-bold ${
                    isDone ? 'text-[#8B7355]/50 dark:text-[#C4A484]/50'
                    : isActive ? 'text-[#8B7355] dark:text-[#C4A484]'
                    : 'text-[#C4A484] dark:text-white/20'
                  }`}>
                    {isDone ? '✓' : isLocked ? '—' : `${Math.round(pct * 100)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4">

        {/* Gate-Cards */}
        {gates.map(gate => (
          <div key={gate.phase} className="mb-4 rounded-2xl border-2 border-dashed border-emerald-600/30 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/5 p-5">
            <div className="text-[13px] font-extrabold text-emerald-700 dark:text-emerald-400 mb-1">{gate.phase} kann starten</div>
            <p className="text-[12px] text-[#5C3D1E] dark:text-white/40 mb-3">Alle Vorstufen sind fertig.</p>
            <div className="flex gap-2 mb-3 flex-wrap">
              {gate.dependencies.map(dep => (
                <span key={dep} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold">
                  <Check size={10} /> {dep}
                </span>
              ))}
            </div>
            <button onClick={() => transition(session.id, gate.firstStepIdx, 'confirm_gate', { phase: gate.phase })} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[13px] transition-colors active:scale-[0.98]">{gate.phase} jetzt ansetzen</button>
          </div>
        ))}

        {/* Soft-done Steps */}
        {allSoftDoneSteps.map((sdStep) => (
          <div key={sdStep.globalIdx} className="mb-4 rounded-2xl border-2 border-amber-400/40 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-500/5 p-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-600 dark:text-amber-400">{sdStep.phase}</span>
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">Zeit abgelaufen</span>
            </div>
            <p className="text-[14px] font-semibold text-[#2C1A0E] dark:text-white/90 mb-4 leading-relaxed">{sdStep.instruction}</p>
            <div className="flex gap-2">
              <button onClick={() => transition(session.id, sdStep.globalIdx, 'complete')} className="flex-1 py-3 rounded-xl bg-[#8B7355] text-white font-bold text-[13px] active:scale-[0.98]">Ja, fertig</button>
              <button onClick={() => transition(session.id, sdStep.globalIdx, 'extend_timer', { minutes: 15 })} className="px-4 py-3 rounded-xl bg-[#EDE5D6] dark:bg-white/10 text-[#5C3D1E] dark:text-white/60 font-bold text-[13px]">+15 Min</button>
              <button onClick={() => transition(session.id, sdStep.globalIdx, 'extend_timer', { minutes: 30 })} className="px-4 py-3 rounded-xl bg-[#EDE5D6] dark:bg-white/10 text-[#5C3D1E] dark:text-white/60 font-bold text-[13px]">+30 Min</button>
            </div>
          </div>
        ))}

        {/* Primäre aktive Hero-Card */}
        {activeStep && allSoftDoneSteps.length === 0 && (
          <div ref={activeCardRef} className="mb-4 rounded-2xl border-2 border-[#8B7355]/30 dark:border-[#C4A484]/30 bg-[#8B7355]/[0.06] dark:bg-[#C4A484]/[0.08] p-5">
            <div className="flex justify-between items-center mb-2">
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide ${
                activeStep.type === 'Backen' ? 'bg-red-500 text-white'
                : activeStep.type === 'Aktion' || activeStep.type === 'Kneten'
                  ? 'bg-[#8B7355]/20 text-[#8B7355] border border-[#8B7355]/30 dark:bg-[#C4A484]/30 dark:text-[#C4A484] dark:border-[#C4A484]/30'
                  : 'bg-[#EDE5D6] text-[#A68B6A] dark:bg-white/10 dark:text-white/60'
              }`}>{activeStep.phase}</span>
              <span className="text-[11px] text-[#A68B6A] dark:text-white/30 font-bold">
  {activeStep.scheduled_start
    ? new Date(activeStep.scheduled_start) <= currentTime
      ? `seit ${formatSmartTime(new Date(activeStep.scheduled_start))}`
      : `ab ${formatSmartTime(new Date(activeStep.scheduled_start))}`
    : ''}
</span>
            </div>
            <p className="text-[14px] font-semibold text-[#2C1A0E] dark:text-white/90 mb-3 leading-relaxed">{activeStep.instruction}</p>
            {remaining !== null && remaining > 0 && activeStep.type !== 'Aktion' && activeStep.type !== 'Kneten' && (
              <div className="flex items-center gap-3 mb-3 p-3 rounded-xl bg-[#EDE5D6] dark:bg-white/5 border border-[#D6C9B4] dark:border-white/10">
                <div className="w-11 h-11 rounded-full border-[3px] border-[#D6C9B4] dark:border-white/10 flex items-center justify-center relative">
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r="19" fill="none" stroke="#8B7355" strokeWidth="3" strokeDasharray={`${timerProgress * 119.4} 119.4`} strokeLinecap="round" className="dark:[stroke:#C4A484]" />
                  </svg>
                  <span className="text-[9px] font-bold text-[#8B7355] dark:text-[#C4A484]">{Math.round(timerProgress * 100)}%</span>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-[#A68B6A] dark:text-white/30 uppercase tracking-widest">Verbleibend</div>
                  <div className="text-[20px] font-extrabold text-[#2C1A0E] dark:text-white/90 tabular-nums">{formatCountdown(remaining)}</div>
                </div>
                {activeStep.extended_by > 0 && <span className="ml-auto text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/10 px-2 py-1 rounded-lg">+{activeStep.extended_by} Min</span>}
              </div>
            )}
            <div className="flex gap-2">
              {activeStep.type === 'Backen' ? (
                <button onClick={() => transition(session.id, activeStep.globalIdx, 'complete')} className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-[13px] active:scale-[0.98]">Raus aus dem Ofen</button>
              ) : activeStep.type === 'Warten' || activeStep.type === 'Ruhen' || activeStep.type === 'Kühl' ? (
                <>
                  <button onClick={() => transition(session.id, activeStep.globalIdx, 'complete')} className="flex-1 py-3 rounded-xl bg-[#8B7355] hover:bg-[#7A6347] text-white font-bold text-[13px] active:scale-[0.98]">Fertig (Teig reif)</button>
                  <button onClick={() => transition(session.id, activeStep.globalIdx, 'extend_timer', { minutes: 15 })} className="px-4 py-3 rounded-xl bg-[#EDE5D6] dark:bg-white/10 text-[#5C3D1E] dark:text-white/60 font-bold text-[12px]">+15 Min</button>
                </>
              ) : (
                <button onClick={() => transition(session.id, activeStep.globalIdx, 'complete')} className="flex-1 py-3 rounded-xl bg-[#8B7355] hover:bg-[#7A6347] text-white font-bold text-[13px] active:scale-[0.98]">Erledigt</button>
              )}
            </div>
          </div>
        )}

        {/* Parallele aktive Schritte */}
        {parallelActiveSteps.length > 0 && allSoftDoneSteps.length === 0 && parallelActiveSteps.map(pStep => {
          const pRemaining = stepRemaining(pStep);
          return (
            <div key={pStep.globalIdx} className="mb-4 rounded-2xl border-2 border-dashed border-[#D6C9B4] dark:border-white/10 bg-[#EDE5D6]/50 dark:bg-white/[0.03] p-4">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-extrabold uppercase tracking-wide bg-[#EDE5D6] dark:bg-white/10 text-[#A68B6A] dark:text-white/40">Parallel</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-extrabold uppercase tracking-wide ${
                    pStep.type === 'Backen' ? 'bg-red-500 text-white'
                    : pStep.type === 'Aktion' || pStep.type === 'Kneten'
                      ? 'bg-[#8B7355]/15 text-[#8B7355] dark:bg-[#C4A484]/20 dark:text-[#C4A484]'
                      : 'bg-[#EDE5D6] text-[#A68B6A] dark:bg-white/10 dark:text-white/40'
                  }`}>{pStep.phase}</span>
                </div>
                {pRemaining !== null && pRemaining > 0 && <span className="text-[12px] font-bold text-[#8B7355] dark:text-[#C4A484] tabular-nums">{formatCountdown(pRemaining)}</span>}
              </div>
              <p className="text-[13px] text-[#5C3D1E] dark:text-white/70 mb-3 leading-relaxed">{pStep.instruction}</p>
              <div className="flex gap-2">
                {pStep.type === 'Warten' || pStep.type === 'Ruhen' || pStep.type === 'Kühl' ? (
                  <>
                    <button onClick={() => transition(session.id, pStep.globalIdx, 'complete')} className="flex-1 py-2.5 rounded-xl bg-[#8B7355] hover:bg-[#7A6347] text-white font-bold text-[12px] active:scale-[0.98]">Fertig (Teig reif)</button>
                    <button onClick={() => transition(session.id, pStep.globalIdx, 'extend_timer', { minutes: 15 })} className="px-3 py-2.5 rounded-xl bg-[#EDE5D6] dark:bg-white/10 text-[#5C3D1E] dark:text-white/50 font-bold text-[11px]">+15 Min</button>
                  </>
                ) : (
                  <button onClick={() => transition(session.id, pStep.globalIdx, 'complete')} className="flex-1 py-2.5 rounded-xl bg-[#8B7355] hover:bg-[#7A6347] text-white font-bold text-[12px] active:scale-[0.98]">Erledigt</button>
                )}
              </div>
            </div>
          );
        })}

        {/* Bereit zum Backen */}
        {timeline.filter(s => s.state === 'ready' && s.type === 'Backen').map(step => (
          <div key={step.globalIdx} className="mb-4 rounded-2xl border-2 border-dashed border-red-400/40 dark:border-red-400/30 bg-red-50 dark:bg-red-500/5 p-5">
            <span className="text-[10px] font-extrabold uppercase text-red-600 dark:text-red-400 mb-2 block">Bereit zum Backen</span>
            <p className="text-[13px] text-[#2C1A0E] dark:text-white/80 mb-3">{step.instruction}</p>
            <button onClick={() => transition(session.id, step.globalIdx, 'start_baking')} className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-[13px] active:scale-[0.98]">Ofen ist bereit — Backen starten</button>
          </div>
        ))}

        {/* Alle Schritte erledigt */}
        {!focusStep && gates.length === 0 && timeline.length > 0 && timeline.every(s => s.state === 'done') && (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">🎉</div>
            <h3 className="text-lg font-bold text-[#2C1A0E] dark:text-white/90 mb-2">Alle Schritte erledigt!</h3>
            <p className="text-[#A68B6A] dark:text-white/40 mb-6">Du kannst den Backplan jetzt abschließen.</p>
            <button onClick={() => setFinishModalId(session.id)} className="px-6 py-3 rounded-2xl bg-[#8B7355] text-white font-bold text-sm">Backen abschließen</button>
          </div>
        )}

        {/* Phasen mit Schritt-Liste */}
        {sortedPhases.map((phase, pIdx) => {
          const sd = getSec(phase.name);
          const ings = sd?.ingredients || [];
          const ik = `${session.id}-${phase.name}`;
          const isIO = openIngredients.has(ik);
          const doneS = phase.steps.filter(s => s.state === 'done');
          const pendS = phase.steps.filter(s => s.state !== 'done');
          return (
            <div key={pIdx} className="mb-6">
              {/* Phasen-Header */}
              <div className="flex items-center gap-3 mb-2 px-1">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold flex-shrink-0 ${
                  phase.hasActive
                    ? 'bg-[#8B7355]/20 text-[#8B7355] border border-[#8B7355]/30 dark:bg-[#C4A484]/30 dark:text-[#C4A484] dark:border-[#C4A484]/40'
                    : phase.allDone
                      ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'
                      : 'bg-[#EDE5D6] text-[#C4A484] dark:bg-white/[0.06] dark:text-white/25'
                }`}>
                  {phase.allDone ? <Check size={13} /> : pIdx + 1}
                </span>
                <span className={`text-[13px] font-extrabold flex-1 ${
                  phase.allLocked ? 'text-[#C4A484] dark:text-white/20'
                  : phase.allDone ? 'text-[#A68B6A] dark:text-white/40'
                  : 'text-[#2C1A0E] dark:text-white/80'
                }`}>{phase.name}</span>
                <span className="text-[11px] text-[#C4A484] dark:text-white/25 font-bold">{phase.done}/{phase.total}</span>
                {ings.length > 0 && (
                  <button onClick={() => toggleIng(ik)} className="flex items-center gap-1 text-[10px] font-bold text-[#8B7355]/70 hover:text-[#8B7355] dark:text-[#C4A484]/70 dark:hover:text-[#C4A484] transition-colors">
                    <Filter size={11} /> Zutaten {isIO ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </button>
                )}
              </div>

              {/* Zutaten-Drawer */}
              {isIO && ings.length > 0 && (
                <div className="ml-10 mb-3 bg-white dark:bg-white/[0.04] border border-[#D6C9B4] dark:border-white/[0.07] rounded-xl p-3">
                  {ings.map((ing: any, iIdx: number) => (
                    <div key={iIdx} className="flex justify-between text-[11px] py-1.5 border-b border-[#EDE5D6] dark:border-white/[0.06] last:border-0">
                      <span className="text-[#A68B6A] dark:text-white/50">{ing.name}</span>
                      <span className="font-bold text-[#2C1A0E] dark:text-white/80">{ing.amount ? `${scaleAmount(ing.amount, multiplier)} ${String(ing.amount||'').includes(ing.unit) ? '' : ing.unit||''}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Erledigte Schritte inline */}
              {doneS.length > 0 && !phase.allDone && (
                <div className="pl-10 mb-1.5">
                  {doneS.map((step: TimelineStep) => (
                    <div key={step.globalIdx} className="flex items-center gap-2 py-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#8B7355]/30 dark:bg-[#C4A484]/40 flex-shrink-0" />
                      <span className="text-[11px] text-[#C4A484] dark:text-white/20 line-through flex-1 truncate">{step.instruction}</span>
                      <span className="text-[10px] text-[#D6C9B4] dark:text-white/15 flex-shrink-0">{formatStepDuration(step)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Offene Schritte */}
              <div className="flex flex-col gap-1.5 pl-10">
                {pendS.map((step: TimelineStep) => {
                  const isA = step.state === 'active' || step.state === 'soft_done';
                  const isL = step.state === 'locked';
                  const isR = step.state === 'ready';
                  const sRem = isA ? stepRemaining(step) : null;
                  return (
                    <div key={step.globalIdx} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl transition-all ${
                      isA
                        ? 'border-2 border-[#8B7355]/30 bg-[#8B7355]/[0.06] dark:border-[#C4A484]/30 dark:bg-[#C4A484]/[0.08]'
                        : isR
                          ? 'border border-dashed border-[#D6C9B4] dark:border-white/15 bg-[#F5F0E8] dark:bg-white/[0.03]'
                          : isL
                            ? 'border border-[#EDE5D6] dark:border-white/[0.04] bg-transparent opacity-40'
                            : 'border border-[#EDE5D6] dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'
                    }`}>
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                        isA ? 'bg-[#8B7355] dark:bg-[#C4A484] animate-pulse'
                        : isR ? 'bg-amber-500'
                        : 'bg-[#D6C9B4] dark:bg-white/15'
                      }`} />
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[9px] font-extrabold uppercase tracking-wide flex-shrink-0 mt-0.5 ${
                        step.type === 'Backen' ? 'bg-red-500 text-white'
                        : step.type === 'Aktion' || step.type === 'Kneten'
                          ? 'bg-[#8B7355]/15 text-[#8B7355] border border-[#8B7355]/20 dark:bg-[#C4A484]/20 dark:text-[#C4A484] dark:border-[#C4A484]/20'
                          : 'bg-[#EDE5D6] text-[#A68B6A] dark:bg-white/[0.06] dark:text-white/30'
                      } ${isL ? 'opacity-50' : ''}`}>{step.type}</span>
                      <span className={`text-[12px] flex-1 leading-snug ${
                        isL ? 'text-[#C4A484] dark:text-white/20'
                        : isA ? 'text-[#2C1A0E] dark:text-white/90'
                        : 'text-[#5C3D1E] dark:text-white/55'
                      }`}>{step.instruction}</span>
                      <span className={`text-[11px] font-bold flex-shrink-0 ${
                        isA && sRem ? 'text-[#8B7355] dark:text-[#C4A484]' : 'text-[#D6C9B4] dark:text-white/20'
                      }`}>{isA && sRem ? formatCountdown(sRem) : formatStepDuration(step)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {multiplier !== 1 && (
          <div className="mt-2 text-center">
            <span className="text-[10px] font-bold text-[#8B7355] dark:text-[#C4A484] bg-[#8B7355]/10 dark:bg-[#C4A484]/10 px-3 py-1 rounded-lg">{multiplier}x Menge</span>
          </div>
        )}
        <div className="mt-6">
          <Link href={`/recipes/${session.recipe_id}`} className="block w-full text-center py-3 rounded-2xl bg-[#EDE5D6] dark:bg-white/[0.04] text-[#A68B6A] dark:text-white/40 font-bold text-[12px] border border-[#D6C9B4] dark:border-white/[0.07] hover:bg-[#D6C9B4] dark:hover:bg-white/[0.07] transition-colors">Ganzes Rezept zeigen</Link>
        </div>
      </div>
    </div>
  );
}