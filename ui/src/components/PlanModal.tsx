// ui/src/components/PlanModal.tsx
// ============================================================
// PLAN MODAL v2 — Erstellt eine bake_session statt planned_at
//
// Vereinfacht: Szenario-Auswahl + Multiplier + Bestätigung
// Die alte Timeline-Canvas und erweiterten Settings bleiben erhalten,
// aber der Confirm-Flow erstellt jetzt eine Server-Session.
// ============================================================

'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { X, Minus, Plus, Moon, Coffee, Clock, Sunrise, ChevronDown } from 'lucide-react';
import { calcTotalDuration, calculateBackplan, formatDuration, formatSmartTime, parseLocalDate } from '@/lib/backplan-utils';
import { loadSettings, saveSettings, SETTINGS_DEFAULTS, minToHHMM, hhmmToMin } from '@/lib/crumb-settings';

const API = process.env.NEXT_PUBLIC_API_URL;

type Scenario = 'jetzt' | 'abend' | 'morgen' | 'nacht' | 'manuell';

interface PlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipe: any;
  onSessionCreated?: (session: any) => void;
}

// ── Helpers ─────────────────────────────────────────────────
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const snapTo = (v: number, snap: number, up = false) => up ? Math.ceil(v / snap) * snap : Math.round(v / snap) * snap;
const minToHHMM_local = (m: number) => {
  const h = Math.floor(((m % 1440) + 1440) % 1440 / 60);
  const min = ((m % 1440) + 1440) % 1440 % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

function absMinToDate(absMin: number): Date {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(todayStart.getTime() + absMin * 60000);
}

function toLocalISOString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function dayPickerInfo(offset: number) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  if (offset === 0) return { label: 'Heute', date: `${d.getDate()}.${d.getMonth() + 1}` };
  if (offset === 1) return { label: 'Morgen', date: `${d.getDate()}.${d.getMonth() + 1}` };
  return { label: days[d.getDay()], date: `${d.getDate()}.${d.getMonth() + 1}` };
}

// ── Main Modal ──────────────────────────────────────────────
export default function PlanModal({ isOpen, onClose, recipe, onSessionCreated }: PlanModalProps) {
  const [settings] = useState(() => loadSettings());
  const { sleepFrom, sleepTo, abendZiel, morgenZiel, snapMin } = settings;

  const [multiplier, setMultiplier] = useState(1);
  const [scenario, setScenario] = useState<Scenario>('jetzt');
  const [dayOffset, setDayOffset] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMultiplier(1);
      setScenario('jetzt');
      setDayOffset(0);
      setIsSubmitting(false);
      setError('');
    }
  }, [isOpen]);

  const totalMinutes = useMemo(() => calcTotalDuration(recipe?.dough_sections ?? []), [recipe]);

  // ── Compute planned end time ──────────────────────────────
  const computeEndTime = useCallback((): Date => {
    const now = nowMin();
    const base = dayOffset * 1440;
    const dur = totalMinutes;
    let startMin: number;

    if (scenario === 'jetzt') {
      startMin = dayOffset === 0 ? snapTo(now, snapMin, true) : base + morgenZiel - dur;
    } else if (scenario === 'abend') {
      startMin = base + abendZiel - dur;
      if (dayOffset === 0 && startMin <= now) startMin += 1440;
    } else if (scenario === 'morgen') {
      startMin = base + 1440 + morgenZiel - dur;
    } else {
      startMin = dayOffset === 0 ? snapTo(now, snapMin, true) : base + morgenZiel - dur;
    }

    return absMinToDate(startMin + dur);
  }, [scenario, dayOffset, totalMinutes, snapMin, abendZiel, morgenZiel]);

  const endTime = useMemo(() => computeEndTime(), [computeEndTime]);
  const startTime = useMemo(() => new Date(endTime.getTime() - totalMinutes * 60000), [endTime, totalMinutes]);

  // Warnung wenn Start in der Vergangenheit
  const isPast = startTime.getTime() < Date.now() - 60000;

  // ── Gewicht berechnen ─────────────────────────────────────
  const baseWeight = useMemo(() => {
    let w = 0;
    (recipe?.dough_sections ?? []).forEach((s: any) =>
      (s.ingredients || []).forEach((ing: any) => {
        const a = parseFloat(ing.amount) || 0;
        const u = (ing.unit || '').toLowerCase();
        if (u === 'g') w += a; else if (u === 'kg') w += a * 1000;
        else if (u === 'ml') w += a; else if (u === 'l') w += a * 1000;
      })
    );
    return w;
  }, [recipe]);
  const scaledWeight = baseWeight > 0
    ? `${((baseWeight * multiplier) / 1000).toFixed(2).replace('.', ',')} kg`
    : null;

  // ── Confirm: Create bake_session ──────────────────────────
  const handleConfirm = async () => {
    if (isPast || isSubmitting) return;
    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch(`${API}/bake-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('crumb_token')}`,
        },
        body: JSON.stringify({
          recipe_id: recipe.id,
          planned_at: toLocalISOString(endTime),
          multiplier,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Fehler beim Erstellen');
        setIsSubmitting(false);
        return;
      }

      const data = await res.json();
      onSessionCreated?.(data);
      onClose();

      // Navigate to backplan
      window.location.href = '/backplan';
    } catch (err: any) {
      setError(err.message || 'Netzwerkfehler');
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !recipe) return null;

  const scenarioCards = [
    {
      id: 'jetzt' as Scenario,
      label: dayOffset === 0 ? 'Jetzt starten' : 'Frühestmöglich',
      icon: <Play size={14} />,
      sub: `Fertig um ~${formatSmartTime(endTime)}`,
    },
    {
      id: 'abend' as Scenario,
      label: 'Zum Abend',
      icon: <Coffee size={14} />,
      sub: `Fertig um ~${minToHHMM_local(abendZiel)}`,
    },
    {
      id: 'morgen' as Scenario,
      label: 'Zum Frühstück',
      icon: <Sunrise size={14} />,
      sub: `Fertig um ~${minToHHMM_local(morgenZiel)}`,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[85vh] bg-[#161b22] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[#30363d]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d]">
          <div className="flex items-center gap-3">
            <img src={recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=100'}
              className="w-10 h-10 rounded-lg object-cover" alt="" />
            <div>
              <p className="text-[13px] font-bold text-[#e6edf3] truncate max-w-[200px]">{recipe.title}</p>
              <p className="text-[11px] text-[#8b949e]">
                {formatDuration(totalMinutes)} Gesamtdauer
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#21262d] text-[#8b949e]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Multiplier */}
          <div className="px-4 py-3 border-b border-[#21262d]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-widest">Menge</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setMultiplier(Math.max(0.5, +(multiplier - 0.5).toFixed(1)))}
                  className="w-8 h-8 rounded-lg bg-[#21262d] border border-[#30363d] flex items-center justify-center text-[#8b949e]">
                  <Minus size={14} />
                </button>
                <span className="text-sm font-semibold text-[#e6edf3] min-w-[80px] text-center">
                  {multiplier}×{scaledWeight && <span className="text-[#8b949e] font-normal"> ({scaledWeight})</span>}
                </span>
                <button onClick={() => setMultiplier(Math.min(3, +(multiplier + 0.5).toFixed(1)))}
                  className="w-8 h-8 rounded-lg bg-[#21262d] border border-[#30363d] flex items-center justify-center text-[#8b949e]">
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Planning */}
          <div className="px-4 py-4">
            <p className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-widest mb-3">Wann soll's fertig sein?</p>

            {/* Tag-Auswahl */}
            <div className="grid grid-cols-7 gap-1 mb-3">
              {Array.from({ length: 7 }, (_, i) => {
                const isActive = dayOffset === i;
                const info = dayPickerInfo(i);
                return (
                  <button key={i} onClick={() => { setDayOffset(i); if (scenario === 'manuell') setScenario('jetzt'); }}
                    className={`flex flex-col items-center py-1.5 rounded-lg border transition-colors ${
                      isActive ? 'bg-[rgba(240,165,0,0.12)] border-[#f0a500]' : 'bg-[#21262d] border-[#30363d]'
                    }`}>
                    <span className={`text-[10px] font-semibold ${isActive ? 'text-[#f0a500]' : 'text-[#8b949e]'}`}>{info.label}</span>
                    <span className={`text-[9px] ${isActive ? 'text-[#f0a500]/70' : 'text-[#484f58]'}`}>{info.date}</span>
                  </button>
                );
              })}
            </div>

            {/* Szenario-Karten */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {scenarioCards.map(sc => {
                const isActive = scenario === sc.id;
                return (
                  <button key={sc.id} onClick={() => setScenario(sc.id)}
                    className={`rounded-xl px-3 py-3 flex flex-col items-center gap-1 border transition-colors ${
                      isActive ? 'bg-[rgba(240,165,0,0.07)] border-[#f0a500]' : 'bg-[#21262d] border-[#30363d]'
                    }`}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isActive ? 'bg-[rgba(240,165,0,0.15)] text-[#f0a500]' : 'bg-[#2d333b] text-[#8b949e]'}`}>
                      {sc.icon}
                    </div>
                    <span className={`text-[11px] font-semibold ${isActive ? 'text-[#f0a500]' : 'text-[#e6edf3]'}`}>{sc.label}</span>
                    <span className={`text-[9px] ${isActive ? 'text-[#f0a500]/70' : 'text-[#8b949e]'}`}>{sc.sub}</span>
                  </button>
                );
              })}
            </div>

            {/* Zusammenfassung */}
            <div className="rounded-xl bg-[#21262d] border border-[#30363d] p-4">
              <div className="flex justify-between text-[12px] mb-1">
                <span className="text-[#8b949e]">Start</span>
                <span className="text-[#e6edf3] font-semibold">
                  {dayOffset === 0 && scenario === 'jetzt' ? 'Jetzt' : formatSmartTime(startTime)} Uhr
                </span>
              </div>
              <div className="flex justify-between text-[12px] mb-1">
                <span className="text-[#8b949e]">Fertig</span>
                <span className="text-[#f0a500] font-bold">{formatSmartTime(endTime)} Uhr</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-[#8b949e]">Dauer</span>
                <span className="text-[#e6edf3]">{formatDuration(totalMinutes)}</span>
              </div>
            </div>

            {isPast && (
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-[#f85149]">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1L11 10H1L6 1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                </svg>
                Plan liegt in der Vergangenheit
              </div>
            )}

            {error && (
              <div className="mt-2 text-[11px] text-[#f85149] bg-[#f85149]/10 px-3 py-2 rounded-lg">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#21262d] flex gap-3 px-4 py-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d]">
            Abbrechen
          </button>
          <button onClick={handleConfirm} disabled={isPast || isSubmitting}
            className={`flex-[2] py-3 rounded-xl text-sm font-semibold transition-colors ${
              isPast || isSubmitting ? 'bg-[#21262d] text-[#484f58] cursor-not-allowed' : 'bg-[#1a7a3c] text-[#4ade80] hover:bg-[#1f9447]'
            }`}>
            {isSubmitting ? 'Wird erstellt...' : 'Backplan starten'}
          </button>
        </div>
      </div>
    </div>
  );
}
