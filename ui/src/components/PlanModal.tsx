"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { X, Clock, Minus, Plus } from "lucide-react";
import { calculateBackplan, calcTotalDuration } from "@/lib/backplan-utils";

interface PlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (plannedAt: string, multiplier: number, timeline: any[], plannedTimeline?: any[]) => void;
  recipe: {
    id: number | string;
    title: string;
    dough_sections: any[];
  } | null;
}

type Scenario = "jetzt" | "abend" | "morgen" | "nacht" | "manuell";

// ─── helpers ─────────────────────────────────────────────────────────────────

function nowMin() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function minToHHMM(m: number) {
  const n = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
}

function absMinToDate(absMin: number): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(today.getTime() + absMin * 60000);
}

function toLocalISOString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function snapTo(abs: number, snapMin: number, fwdOnly = false): number {
  if (snapMin === 0) return Math.round(abs);
  const s = Math.round(abs / snapMin) * snapMin;
  return fwdOnly && s < abs ? s + snapMin : s;
}

function inSleepWindow(absMin: number, sleepFrom: number, sleepTo: number): boolean {
  const norm = ((Math.round(absMin) % 1440) + 1440) % 1440;
  return sleepFrom < sleepTo
    ? norm >= sleepFrom && norm < sleepTo
    : norm >= sleepFrom || norm < sleepTo;
}

function isPastAbsolute(absMin: number): boolean {
  // absMin > 1440 means tomorrow → never past
  if (absMin >= 1440) return false;
  return absMin < nowMin();
}

// ─── gap computation ──────────────────────────────────────────────────────────

interface GapSegment { start: number; end: number; }
interface PhaseSegment { start: number; dur: number; type: "action" | "rest"; teig: string; }

function computeGaps(phases: PhaseSegment[]): GapSegment[] {
  const teigs = [...new Set(phases.map((p) => p.teig))];
  const gaps: GapSegment[] = [];
  let inGap = false, gs = 0;
  const total = Math.max(...phases.map((p) => p.start + p.dur));
  for (let t = 0; t <= total; t++) {
    const started = teigs.filter((teig) => phases.some((p) => p.teig === teig && p.start <= t));
    if (!started.length) { inGap = false; continue; }
    const active = started.some((teig) =>
      phases.some((p) => p.teig === teig && p.type === "action" && p.start <= t && t < p.start + p.dur)
    );
    if (!active) { if (!inGap) { inGap = true; gs = t; } }
    else { if (inGap) { gaps.push({ start: gs, end: t }); inGap = false; } }
  }
  if (inGap) gaps.push({ start: gs, end: total });
  return gaps;
}

// ─── convert dough_sections to flat phases ───────────────────────────────────

function sectionsToPhases(doughSections: any[]): PhaseSegment[] {
  const phases: PhaseSegment[] = [];
  let cursor = 0;
  (doughSections || []).forEach((section: any, si: number) => {
    const teigId = `s${si}`;
    let t = si === 0 ? 0 : cursor; // parallel sections start at 0 if they're pre-doughs
    // Simplified: treat all sections sequentially for now, using step durations
    (section.steps || []).forEach((step: any) => {
      const dur = step.duration || step.duration_min || 1;
      const isRest = step.type === "Warten" || step.type === "Kühl" || step.type === "Ruhen";
      phases.push({ start: t, dur, type: isRest ? "rest" : "action", teig: teigId });
      t += dur;
    });
    if (si === 0) cursor = t;
  });
  return phases;
}

// ─── Timeline Canvas ──────────────────────────────────────────────────────────

interface TimelineProps {
  phases: PhaseSegment[];
  gaps: GapSegment[];
  planDur: number;
  planOffset: number; // absolute minutes from midnight for plan start
  scenario: Scenario;
  sleepFrom: number;
  sleepTo: number;
  onOffsetChange: (newAbsStart: number) => void;
  snapMin: number;
}

const TEIG_COLORS: Record<string, string> = {
  s0: "#f0a500",
  s1: "#60a5fa",
  s2: "#a78bfa",
  s3: "#34d399",
};

function TimelineCanvas({
  phases, gaps, planDur, planOffset, scenario,
  sleepFrom, sleepTo, onOffsetChange, snapMin,
}: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({ startX: 0, startOffset: 0 });
  const WINDOW = 220;

  const getSleepSegments = useCallback((planStart: number) => {
    const dayBase = Math.floor(planStart / 1440) * 1440;
    let from = dayBase + sleepFrom;
    let to = sleepTo < sleepFrom ? dayBase + sleepTo + 1440 : dayBase + sleepTo;
    if (to < planStart) { from += 1440; to += 1440; }
    return [{ from, to }];
  }, [sleepFrom, sleepTo]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const ppm = W / WINDOW;
    const planStart = planOffset;
    const viewStart = planStart - (WINDOW - planDur) / 2;
    const ax = (abs: number) => (abs - viewStart) * ppm;
    const bx = (rel: number) => ax(planStart + rel);

    const TT = 14, TH = 24, TICK_Y = TT + TH + 5;
    const blockX = bx(0), blockW = planDur * ppm;

    // Track background
    ctx.fillStyle = "#1a1f27";
    ctx.beginPath(); ctx.roundRect(0, TT, W, TH, 5); ctx.fill();
    ctx.strokeStyle = "#252c38"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.roundRect(0, TT, W, TH, 5); ctx.stroke();

    // Sleep zone
    const sleepAlpha = scenario === "nacht" ? 1 : 0.35;
    const drawSleep = (clip: boolean) => {
      const segs = getSleepSegments(planStart);
      for (const seg of segs) {
        const x1 = ax(seg.from), x2 = ax(seg.to);
        const cx1 = Math.max(0, x1), cx2 = Math.min(W, x2);
        if (cx2 <= cx1) continue;
        ctx.fillStyle = "rgba(96,130,210,0.09)"; ctx.fillRect(cx1, TT, cx2 - cx1, TH);
        ctx.save(); ctx.beginPath(); ctx.rect(cx1, TT, cx2 - cx1, TH); ctx.clip();
        ctx.strokeStyle = "rgba(96,130,210,0.13)"; ctx.lineWidth = 1;
        for (let s = cx1 - TH; s < cx2 + TH; s += 7) {
          ctx.beginPath(); ctx.moveTo(s, TT); ctx.lineTo(s + TH, TT + TH); ctx.stroke();
        }
        ctx.restore();
        if (!clip) {
          if (x1 >= 0 && x1 <= W) {
            ctx.save(); ctx.strokeStyle = "rgba(96,130,210,0.35)"; ctx.lineWidth = 0.75;
            ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x1, TT); ctx.lineTo(x1, TT + TH); ctx.stroke();
            ctx.setLineDash([]); ctx.restore();
            ctx.fillStyle = "rgba(96,130,210,0.55)"; ctx.font = "9px sans-serif";
            ctx.textBaseline = "bottom"; ctx.textAlign = "left";
            ctx.fillText(minToHHMM(sleepFrom), x1 + 2, TT - 1);
          }
          if (x2 >= 0 && x2 <= W) {
            ctx.save(); ctx.strokeStyle = "rgba(96,130,210,0.35)"; ctx.lineWidth = 0.75;
            ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x2, TT); ctx.lineTo(x2, TT + TH); ctx.stroke();
            ctx.setLineDash([]); ctx.restore();
            ctx.fillStyle = "rgba(96,130,210,0.55)"; ctx.font = "9px sans-serif";
            ctx.textBaseline = "bottom"; ctx.textAlign = "right";
            ctx.fillText(minToHHMM(sleepTo), x2 - 2, TT - 1);
          }
          const lx = (Math.max(cx1, 0) + Math.min(cx2, W)) / 2;
          ctx.fillStyle = "rgba(96,130,210,0.4)"; ctx.font = "11px sans-serif";
          ctx.textBaseline = "middle"; ctx.textAlign = "center";
          ctx.fillText("☽", lx, TT + TH / 2);
        }
      }
    };
    ctx.save(); ctx.globalAlpha = sleepAlpha; ctx.beginPath(); ctx.roundRect(0, TT, W, TH, 5); ctx.clip();
    drawSleep(true); ctx.restore();
    ctx.globalAlpha = sleepAlpha; drawSleep(false); ctx.globalAlpha = 1;

    // Gaps
    ctx.save(); ctx.beginPath(); ctx.roundRect(0, TT, W, TH, 5); ctx.clip();
    for (const g of gaps) {
      const x1 = bx(g.start), x2 = bx(g.end), gw = x2 - x1;
      if (gw < 1) continue;
      ctx.fillStyle = "rgba(34,197,94,0.22)"; ctx.fillRect(x1, TT, gw, TH);
      if (gw > 36) {
        ctx.fillStyle = "rgba(34,197,94,0.75)"; ctx.font = "9px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`${g.end - g.start} min`, x1 + gw / 2, TT + TH / 2);
      }
    }
    ctx.restore();

    // Block fill + phases
    ctx.save(); ctx.beginPath(); ctx.roundRect(blockX, TT, blockW, TH, 5); ctx.clip();
    ctx.fillStyle = "rgba(30,36,46,0.6)"; ctx.fillRect(blockX, TT, blockW, TH);
    for (const p of phases) {
      if (p.type === "rest") continue;
      ctx.fillStyle = TEIG_COLORS[p.teig] || "#f0a500";
      ctx.globalAlpha = 0.9;
      ctx.fillRect(bx(p.start), TT + 3, p.dur * ppm, TH - 6);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Block border
    ctx.strokeStyle = isDragging ? "rgba(240,165,0,0.9)" : "rgba(240,165,0,0.5)";
    ctx.lineWidth = isDragging ? 1.5 : 1;
    ctx.beginPath(); ctx.roundRect(blockX, TT, blockW, TH, 5); ctx.stroke();

    // Grip handle
    const gripX = blockX + blockW / 2, gripY = TT + TH / 2;
    ctx.strokeStyle = isDragging ? "rgba(240,165,0,0.7)" : "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1.5; ctx.lineCap = "round";
    [-4, 0, 4].forEach((dx) => {
      ctx.beginPath(); ctx.moveTo(gripX + dx, gripY - 4); ctx.lineTo(gripX + dx, gripY + 4); ctx.stroke();
    });

    // Time labels
    ctx.font = "9px sans-serif"; ctx.fillStyle = "#f0a500"; ctx.textBaseline = "bottom";
    ctx.textAlign = "left"; ctx.fillText(minToHHMM(planStart), blockX + 2, TT - 1);
    ctx.textAlign = "right"; ctx.fillText(minToHHMM(planStart + planDur), blockX + blockW - 2, TT - 1);

    // Axis ticks
    const step = 30, first = Math.ceil(viewStart / step) * step;
    for (let t = first; t <= viewStart + WINDOW + step; t += step) {
      const x = ax(t);
      ctx.strokeStyle = "#2d3440"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, TICK_Y); ctx.lineTo(x, TICK_Y + 4); ctx.stroke();
      ctx.fillStyle = "#484f58"; ctx.font = "10px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(minToHHMM(t), x, TICK_Y + 5);
    }

    // Now line
    const nm = nowMin(), nx = ax(nm);
    if (nx >= 0 && nx <= W) {
      ctx.strokeStyle = "#f85149"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(nx, TT - 2); ctx.lineTo(nx, TT + TH + 2); ctx.stroke();
      ctx.fillStyle = "#f85149"; ctx.beginPath(); ctx.arc(nx, TT - 2, 3, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }, [phases, gaps, planDur, planOffset, scenario, isDragging, getSleepSegments, sleepFrom, sleepTo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 58 * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = "58px";
    draw();
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  const getMinPerPx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return 1;
    return WINDOW / canvas.getBoundingClientRect().width;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    dragState.current = { startX: e.clientX, startOffset: planOffset };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragState.current.startX;
    const newOffset = dragState.current.startOffset - dx * getMinPerPx();
    onOffsetChange(newOffset); // raw, no snap during drag
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    const dx = e.clientX - dragState.current.startX;
    const rawOffset = dragState.current.startOffset - dx * getMinPerPx();
    onOffsetChange(snapTo(rawOffset, snapMin)); // snap on release
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", height: 58 }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function PlanModal({ isOpen, onClose, onConfirm, recipe }: PlanModalProps) {
  const [multiplier, setMultiplier] = useState(1);
  const [scenario, setScenario] = useState<Scenario>("jetzt");
  const [planOffset, setPlanOffset] = useState(0); // absolute minutes from midnight
  const [snapMin, setSnapMin] = useState(15);
  const [sleepFrom, setSleepFrom] = useState(22 * 60);
  const [sleepTo, setSleepTo] = useState(6 * 60 + 30);
  const [abendZiel] = useState(19 * 60);
  const [morgenZiel] = useState(7 * 60 + 30);
  const [manualHint, setManualHint] = useState("");
  const [pickerTarget, setPickerTarget] = useState<"from" | "to" | null>(null);
  const [pickerH, setPickerH] = useState(22);
  const [pickerM, setPickerM] = useState(0);
  const [pickerError, setPickerError] = useState("");

  // ─── derived data ───────────────────────────────────────────────────────────

  const totalMinutes = useMemo(() => calcTotalDuration(recipe?.dough_sections ?? []), [recipe]);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalMins = totalMinutes % 60;

  const phases = useMemo(() => sectionsToPhases(recipe?.dough_sections ?? []), [recipe]);
  const gaps = useMemo(() => computeGaps(phases), [phases]);
  const longestGap = useMemo(() =>
    gaps.length ? gaps.reduce((a, b) => b.end - b.start > a.end - a.start ? b : a, gaps[0]) : null,
    [gaps]);

  const planDur = totalMinutes;
  const planStart = planOffset; // absolute minutes from midnight (can be >1440 for tomorrow)

  const baseWeight = useMemo(() => {
    if (!recipe?.dough_sections) return 0;
    let w = 0;
    recipe.dough_sections.forEach((s: any) => {
      (s.ingredients || []).forEach((ing: any) => {
        const a = parseFloat(ing.amount) || 0;
        const u = (ing.unit || "").toLowerCase();
        if (u === "g") w += a;
        else if (u === "kg") w += a * 1000;
        else if (u === "ml") w += a;
        else if (u === "l") w += a * 1000;
      });
    });
    return w;
  }, [recipe]);
  const scaledWeight = baseWeight > 0 ? `${((baseWeight * multiplier) / 1000).toFixed(2).replace(".", ",")} kg` : null;

  // ─── scenario logic ─────────────────────────────────────────────────────────

  const isNachtAvailable = useMemo(() => {
    if (!longestGap || longestGap.end - longestGap.start < 30) return false;
    return ((sleepTo + 1440 - sleepFrom) % 1440) >= 30;
  }, [longestGap, sleepFrom, sleepTo]);

  const computeScenarioStart = useCallback((s: Scenario): number => {
    const now = nowMin();
    if (s === "jetzt") return snapTo(now, snapMin, true);
    if (s === "abend") {
      let start = abendZiel - planDur;
      if (start <= now) start += 1440;
      return snapTo(start, snapMin);
    }
    if (s === "morgen") {
      let start = morgenZiel - planDur;
      if (start <= now) start += 1440;
      return snapTo(start, snapMin);
    }
    if (s === "nacht" && longestGap) {
      const gapMid = (longestGap.start + longestGap.end) / 2;
      const sleepDur = ((sleepTo + 1440 - sleepFrom) % 1440);
      const sleepMid = (sleepFrom + sleepDur / 2) % 1440;
      return snapTo(sleepMid - gapMid, snapMin);
    }
    return planOffset;
  }, [abendZiel, morgenZiel, planDur, longestGap, sleepFrom, sleepTo, snapMin, planOffset]);

  const activateScenario = useCallback((s: Scenario) => {
    if (s === "nacht" && !isNachtAvailable) return;
    setScenario(s);
    setPlanOffset(computeScenarioStart(s));
    setManualHint("");
  }, [computeScenarioStart, isNachtAvailable]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setMultiplier(1);
      setManualHint("");
      setPickerTarget(null);
      const start = snapTo(nowMin(), snapMin, true);
      setPlanOffset(start);
      setScenario("jetzt");
    }
  }, [isOpen]);

  // ─── warnings ───────────────────────────────────────────────────────────────

  const warning = useMemo((): { level: "error" | "hint"; text: string } | null => {
    if (isPastAbsolute(planStart)) return { level: "error", text: "Plan liegt in der Vergangenheit" };
    if (inSleepWindow(planStart, sleepFrom, sleepTo))
      return { level: "error", text: `Plan startet um ${minToHHMM(planStart)} – mitten in der Nachtruhe` };
    const actionInSleep = phases.filter((p) => p.type === "action").some((p) => {
      for (let t = p.start; t < p.start + p.dur; t++)
        if (inSleepWindow(planStart + t, sleepFrom, sleepTo)) return true;
      return false;
    });
    if (actionInSleep) return { level: "hint", text: "Eine Aktionsphase fällt in die Nachtruhe" };
    return null;
  }, [planStart, sleepFrom, sleepTo, phases]);

  const canConfirm = !warning || warning.level !== "error";

  // ─── card hints ─────────────────────────────────────────────────────────────

  const abendNote = useMemo(() => {
    const start = abendZiel - planDur;
    return start <= nowMin() ? "→ morgen Abend" : "";
  }, [abendZiel, planDur]);

  const morgenNote = useMemo(() => {
    const start = morgenZiel - planDur;
    const absStart = start <= nowMin() ? start + 1440 : start;
    return absStart >= 2 * 1440 ? "→ übermorgen früh" : "";
  }, [morgenZiel, planDur]);

  const nachtNote = useMemo(() => {
    if (!isNachtAvailable) {
      const dur = ((sleepTo + 1440 - sleepFrom) % 1440);
      return dur < 30 ? "Schlaffenster zu kurz" : "keine langen Ruhephasen";
    }
    return "";
  }, [isNachtAvailable, sleepFrom, sleepTo]);

  // ─── confirm ────────────────────────────────────────────────────────────────

  const handleConfirm = () => {
    if (!canConfirm) return;
    const endDate = absMinToDate(planStart + planDur);
    const target = toLocalISOString(endDate);
    const timeline = calculateBackplan(target, recipe?.dough_sections ?? []);
    onConfirm(target, multiplier, timeline);
  };

  // ─── picker ──────────────────────────────────────────────────────────────────

  const openPicker = (target: "from" | "to") => {
    const val = target === "from" ? sleepFrom : sleepTo;
    setPickerH(Math.floor(val / 60));
    setPickerM(val % 60);
    setPickerError("");
    setPickerTarget(target);
  };

  const closePicker = (save: boolean) => {
    if (save) {
      const val = pickerH * 60 + pickerM;
      const nf = pickerTarget === "from" ? val : sleepFrom;
      const nt = pickerTarget === "to" ? val : sleepTo;
      if (nf === nt) { setPickerError("Von und bis dürfen nicht gleich sein"); return; }
      if (((nt + 1440 - nf) % 1440) < 30) { setPickerError("Schlaffenster muss mind. 30 min betragen"); return; }
      if (pickerTarget === "from") setSleepFrom(val);
      else setSleepTo(val);
    }
    setPickerTarget(null);
  };

  // ─── handle manual drag ──────────────────────────────────────────────────────

  const handleOffsetChange = (newAbsStart: number) => {
    setPlanOffset(newAbsStart);
    // If this was triggered by drag (not by scenario button), mark as manual
    setScenario("manuell");
    setManualHint("Manuell angepasst — Szenario wählen zum Zurücksetzen");
  };

  if (!isOpen || !recipe) return null;

  // ─── render ──────────────────────────────────────────────────────────────────

  const scenarios: { id: Scenario; label: string; sub: string; note?: string; icon: React.ReactNode }[] = [
    {
      id: "jetzt", label: "Jetzt", sub: "so früh wie möglich",
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke={scenario === "jetzt" ? "#f0a500" : "#8b949e"} strokeWidth="1.1"/>
          <path d="M7 4v3l2 1.2" stroke={scenario === "jetzt" ? "#f0a500" : "#8b949e"} strokeWidth="1.1" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "abend", label: "Abend", sub: `fertig um ${minToHHMM(abendZiel)}`, note: abendNote,
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 10c1-3 5-5 10-3" stroke={scenario === "abend" ? "#f0a500" : "#8b949e"} strokeWidth="1.1" strokeLinecap="round"/>
          <circle cx="7" cy="5" r="2.5" stroke={scenario === "abend" ? "#f0a500" : "#8b949e"} strokeWidth="1.1"/>
        </svg>
      ),
    },
    {
      id: "morgen", label: "Morgen früh", sub: `fertig um ${minToHHMM(morgenZiel)}`, note: morgenNote,
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v1M7 11v1M2 7H1M13 7h-1M3.5 3.5l.7.7M9.8 9.8l.7.7M3.5 10.5l.7-.7M9.8 4.2l.7-.7" stroke={scenario === "morgen" ? "#f0a500" : "#8b949e"} strokeWidth="1.1" strokeLinecap="round"/>
          <circle cx="7" cy="7" r="2.5" stroke={scenario === "morgen" ? "#f0a500" : "#8b949e"} strokeWidth="1.1"/>
        </svg>
      ),
    },
    {
      id: "nacht", label: "Schlaf schonen", sub: "längste Pause ins Schlaffenster",
      note: nachtNote,
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M10 2a5 5 0 1 0 0 10A6.5 6.5 0 0 1 10 2z" stroke={scenario === "nacht" ? "#f0a500" : "#8b949e"} strokeWidth="1.1" strokeLinecap="round"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div
        className="relative bg-[#161b22] rounded-[1.75rem] w-full max-w-[440px] shadow-2xl overflow-hidden max-h-[92svh] flex flex-col border border-[#30363d]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-0 flex-shrink-0">
          <div className="flex items-center gap-2 bg-[#21262d] border border-[#30363d] rounded-full px-3 py-1">
            <Clock size={12} className="text-[#8b949e]" />
            <span className="text-xs text-[#8b949e] font-medium">{totalHours}h {totalMins}m Gesamtzeit</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-[#21262d] border border-[#30363d] flex items-center justify-center text-[#8b949e] hover:text-[#e6edf3] transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="text-center pt-3 pb-3 flex-shrink-0">
          <h2 className="text-lg font-semibold text-[#e6edf3]">Backplan erstellen</h2>
          <p className="text-sm text-[#8b949e]">{recipe.title}</p>
        </div>

        <div className="h-px bg-[#21262d] flex-shrink-0" />

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">

          {/* Menge */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-widest">Menge</span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setMultiplier(Math.max(0.5, +(multiplier - 0.5).toFixed(1)))}
                  className="w-8 h-8 rounded-lg bg-[#21262d] border border-[#30363d] flex items-center justify-center text-[#8b949e] hover:text-[#e6edf3] transition-colors"
                >
                  <Minus size={14} />
                </button>
                <span className="text-sm font-semibold text-[#e6edf3] min-w-[40px] text-center">
                  {multiplier}× {scaledWeight && <span className="text-[#8b949e] font-normal">({scaledWeight})</span>}
                </span>
                <button
                  onClick={() => setMultiplier(Math.min(3, +(multiplier + 0.5).toFixed(1)))}
                  className="w-8 h-8 rounded-lg bg-[#21262d] border border-[#30363d] flex items-center justify-center text-[#8b949e] hover:text-[#e6edf3] transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="h-px bg-[#21262d]" />

          {/* Planning block */}
          <div className="px-4 py-4">
            <p className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-widest mb-3">Wann soll's fertig sein?</p>

            {/* Scenario grid */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {scenarios.map((sc) => {
                const isActive = scenario === sc.id;
                const isDisabled = sc.id === "nacht" && !isNachtAvailable;
                return (
                  <div
                    key={sc.id}
                    onClick={() => !isDisabled && activateScenario(sc.id)}
                    className={[
                      "rounded-xl p-3 flex flex-col gap-1 transition-colors",
                      isActive
                        ? "bg-[rgba(240,165,0,0.07)] border border-[#f0a500]"
                        : isDisabled
                        ? "bg-[#21262d] border border-[#30363d] opacity-35 cursor-not-allowed"
                        : scenario === "manuell"
                        ? "bg-[#21262d] border border-[#30363d] opacity-50 cursor-pointer hover:border-[#484f58]"
                        : "bg-[#21262d] border border-[#30363d] cursor-pointer hover:border-[#484f58]",
                    ].join(" ")}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isActive ? "bg-[rgba(240,165,0,0.15)]" : "bg-[#2d333b]"}`}>
                      {sc.icon}
                    </div>
                    <div className="text-[13px] font-semibold text-[#e6edf3]">{sc.label}</div>
                    <div className={`text-[11px] ${isActive ? "text-[#f0a500]" : "text-[#8b949e]"}`}>{sc.sub}</div>
                    {sc.note && (
                      <div className={`text-[10px] ${sc.id === "nacht" ? "text-[#f85149]" : "text-[#e3b341]"}`}>
                        {sc.note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Sleep settings (nacht mode) */}
            {scenario === "nacht" && (
              <div className="flex items-center gap-3 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 mb-3">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
                  <path d="M9 2a4 4 0 1 0 0 8 5 5 0 0 1 0-8z" stroke="#8b949e" strokeWidth="1" strokeLinecap="round"/>
                </svg>
                <span className="text-xs text-[#8b949e] flex-1">Nachtruhe</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => openPicker("from")} className="bg-[#21262d] border border-[#30363d] rounded px-2.5 py-1 text-sm text-[#e6edf3] font-mono hover:border-[#484f58] transition-colors">
                    {minToHHMM(sleepFrom)}
                  </button>
                  <span className="text-xs text-[#484f58]">–</span>
                  <button onClick={() => openPicker("to")} className="bg-[#21262d] border border-[#30363d] rounded px-2.5 py-1 text-sm text-[#e6edf3] font-mono hover:border-[#484f58] transition-colors">
                    {minToHHMM(sleepTo)}
                  </button>
                </div>
              </div>
            )}

            {/* Times display */}
            <div className="flex items-baseline justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-[#f0a500]">{minToHHMM(planStart)}</span>
                <span className="text-sm text-[#484f58]">→</span>
                <span className="text-base font-semibold text-[#f0a500]">{minToHHMM(planStart + planDur)}</span>
              </div>
              <span className="text-xs text-[#484f58]">{totalHours}h {totalMins}m</span>
            </div>

            {/* Timeline */}
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 pt-2.5 pb-2">
              {/* Legend */}
              <div className="flex gap-3 mb-2 flex-wrap">
                {[...new Set(phases.map((p) => p.teig))].map((teig, i) => (
                  <div key={teig} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-sm" style={{ background: TEIG_COLORS[teig] || "#f0a500" }} />
                    <span className="text-[10px] text-[#8b949e]">
                      {recipe?.dough_sections?.[i]?.name || (i === 0 ? "Hauptteig" : `Teig ${i + 1}`)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm" style={{ background: "rgba(34,197,94,0.5)" }} />
                  <span className="text-[10px] text-[#8b949e]">Freie Zeit</span>
                </div>
                {scenario === "nacht" && (
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-sm" style={{ background: "rgba(96,130,210,0.35)", border: "0.5px solid rgba(96,130,210,0.5)" }} />
                    <span className="text-[10px] text-[#8b949e]">Nachtruhe</span>
                  </div>
                )}
              </div>

              <TimelineCanvas
                phases={phases}
                gaps={gaps}
                planDur={planDur}
                planOffset={planOffset}
                scenario={scenario}
                sleepFrom={sleepFrom}
                sleepTo={sleepTo}
                onOffsetChange={handleOffsetChange}
                snapMin={snapMin}
              />

              {/* Warning */}
              {warning && (
                <div className={`flex items-center gap-1.5 mt-1.5 text-[11px] ${warning.level === "error" ? "text-[#f85149]" : "text-[#e3b341]"}`}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1L11 10H1L6 1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                    <path d="M6 5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <circle cx="6" cy="8.5" r="0.6" fill="currentColor"/>
                  </svg>
                  {warning.text}
                </div>
              )}

              {/* Manual hint */}
              {manualHint && !warning && (
                <p className="text-[10px] text-[#484f58] text-center mt-1.5">{manualHint}</p>
              )}

              {/* Snap */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-[#484f58]">snap</span>
                <div className="flex gap-1">
                  {[0, 5, 15, 30].map((v) => (
                    <button
                      key={v}
                      onClick={() => setSnapMin(v)}
                      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                        snapMin === v
                          ? "text-[#f0a500] border-[rgba(240,165,0,0.5)] bg-[rgba(240,165,0,0.08)]"
                          : "text-[#484f58] border-[#30363d] bg-[#21262d]"
                      }`}
                    >
                      {v === 0 ? "aus" : `${v} min`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-px bg-[#21262d] flex-shrink-0" />
        <div className="flex gap-3 px-4 py-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors">
            Abbrechen
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`flex-[2] py-3 rounded-xl text-sm font-semibold transition-colors ${
              canConfirm
                ? "bg-[#1a7a3c] text-[#4ade80] hover:bg-[#1f9447]"
                : "bg-[#21262d] text-[#484f58] cursor-not-allowed"
            }`}
          >
            Backplan starten
          </button>
        </div>

        {/* Time picker overlay */}
        {pickerTarget && (
          <div className="absolute inset-0 bg-black/55 flex items-center justify-center rounded-[1.75rem] z-10">
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 w-[220px]">
              <p className="text-[11px] text-[#8b949e] uppercase tracking-widest mb-3">
                {pickerTarget === "from" ? "Nachtruhe von" : "Nachtruhe bis"}
              </p>
              <div className="flex items-center gap-2 justify-center mb-3">
                <input
                  type="number" min={0} max={23} value={pickerH}
                  onChange={(e) => setPickerH(Math.max(0, Math.min(23, +e.target.value || 0)))}
                  className="bg-[#21262d] border border-[#30363d] rounded-lg p-2 text-2xl font-semibold text-[#e6edf3] w-[72px] text-center font-mono"
                />
                <span className="text-2xl text-[#484f58]">:</span>
                <input
                  type="number" min={0} max={59} step={15} value={pickerM}
                  onChange={(e) => setPickerM(Math.max(0, Math.min(59, +e.target.value || 0)))}
                  className="bg-[#21262d] border border-[#30363d] rounded-lg p-2 text-2xl font-semibold text-[#e6edf3] w-[72px] text-center font-mono"
                />
              </div>
              {pickerError && <p className="text-[11px] text-[#f85149] text-center mb-3">{pickerError}</p>}
              <div className="flex gap-2">
                <button onClick={() => closePicker(false)} className="flex-1 py-2 rounded-lg bg-[#21262d] text-sm text-[#8b949e]">Abbrechen</button>
                <button onClick={() => closePicker(true)} className="flex-1 py-2 rounded-lg bg-[#1a7a3c] text-sm font-semibold text-[#4ade80]">OK</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}