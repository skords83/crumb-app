"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { X, Clock, Minus, Plus } from "lucide-react";
import { calculateBackplan, calcTotalDuration } from "@/lib/backplan-utils";
import { loadSettings, saveSettings, CrumbSettings } from "@/lib/crumb-settings";

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

// ─── pure helpers ─────────────────────────────────────────────────────────────

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

function snapTo(abs: number, snap: number, fwdOnly = false): number {
  if (snap === 0) return Math.round(abs);
  const s = Math.round(abs / snap) * snap;
  return fwdOnly && s < abs ? s + snap : s;
}

function inSleepWindow(absMin: number, sleepFrom: number, sleepTo: number): boolean {
  const norm = ((Math.round(absMin) % 1440) + 1440) % 1440;
  return sleepFrom < sleepTo
    ? norm >= sleepFrom && norm < sleepTo
    : norm >= sleepFrom || norm < sleepTo;
}

function dayLabel(absMin: number): string {
  const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  if (absMin < 1440) return "heute";
  if (absMin < 2880) return "morgen";
  const d = new Date();
  d.setDate(d.getDate() + Math.floor(absMin / 1440));
  return days[d.getDay()];
}

/** Label für den Tag-Picker: "Heute", "Morgen", "Mi 26.03." etc. */
function dayPickerLabel(offset: number): string {
  if (offset === 0) return "Heute";
  if (offset === 1) return "Morgen";
  const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${days[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}

function isPastAbsolute(absMin: number): boolean {
  // absMin can be >1440 for tomorrow — compare full value against today's minutes
  // Today = 0..1439, Tomorrow = 1440..2879 etc.
  // nowMin() returns 0..1439, so today's "absolute" is just nowMin()
  // If absMin >= 1440 it's tomorrow or later → never past
  if (absMin >= 1440) return false;
  // absMin < 1440 means today — check if already passed
  return absMin < nowMin();
}

// ─── gap computation ──────────────────────────────────────────────────────────

interface GapSegment { start: number; end: number; }
interface PhaseSegment { start: number; dur: number; type: "action" | "rest"; teig: string; }

function computeGaps(phases: PhaseSegment[]): GapSegment[] {
  if (!phases.length) return [];
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

function sectionsToPhases(doughSections: any[]): PhaseSegment[] {
  // Use the same dependency-graph logic as calcTotalDuration / calculateBackplan
  // so section start offsets are accurate (pre-doughs parallel, main dough sequential).
  const phases: PhaseSegment[] = [];
  if (!doughSections?.length) return phases;

  const phaseNames = doughSections.map((s: any) => s.name as string);

  const normalizeName = (name: string): string =>
    name.toLowerCase()
      .replace(/^\d+\.\s*/, '').replace(/\bstufe\s+\d+\b/g, '')
      .replace(/\breifer?\b/g, '').replace(/\bfrischer?\b/g, '')
      .replace(/\bfertig[a-z]*\b/g, '').replace(/\s+/g, ' ').trim();

  // Build dependency graph
  // Also check ingredient.temperature field — some scrapers put the phase name there
  const deps: Record<string, string[]> = {};
  doughSections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      // Check both name and temperature fields for phase references (scraper artefact)
      const candidates = [ing.name || '', ing.temperature || ''];
      candidates.forEach(candidate => {
        const ingName = normalizeName(candidate);
        phaseNames.forEach(otherName => {
          if (otherName === section.name) return;
          const normOther = normalizeName(otherName);
          if (normOther.length < 4) return;
          // Use word-boundary matching to avoid "vorteig" matching inside "roggensauerteig"
          const wordBoundary = new RegExp(`(?:^|\\s)${normOther.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
          if (wordBoundary.test(ingName) || ingName === normOther)
            if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
        });
      });
    });
  });

  const sectionMap = Object.fromEntries(doughSections.map((s: any) => [s.name, s]));
  const endO: Record<string, number> = {};
  const startO: Record<string, number> = {};

  const stepDur = (st: any): number => {
    const min = parseInt(st.duration_min), max = parseInt(st.duration_max);
    return (!isNaN(min) && !isNaN(max)) ? Math.round((min + max) / 2) : (parseInt(st.duration) || 0);
  };

  function calcEnd(name: string, vis = new Set<string>()): number {
    if (name in endO) return endO[name];
    if (vis.has(name)) return 0;
    vis.add(name);
    const dependents = phaseNames.filter(n => deps[n]?.includes(name));
    endO[name] = dependents.length === 0 ? 0
      : Math.min(...dependents.map(d => calcStart(d, new Set(vis))));
    return endO[name];
  }
  function calcStart(name: string, vis = new Set<string>()): number {
    if (name in startO) return startO[name];
    const dur = (sectionMap[name]?.steps || []).reduce((s: number, st: any) => s + stepDur(st), 0);
    startO[name] = calcEnd(name, vis) + dur;
    return startO[name];
  }
  phaseNames.forEach(n => calcStart(n));

  // totalDur = max startOffset across all sections
  const totalDur = Math.max(...phaseNames.map(n => startO[n] || 0));

  // Convert: startOffset is "minutes before end", so
  // section starts at (totalDur - startOffset) relative to plan start
  doughSections.forEach((section: any, si: number) => {
    const teigId = `s${si}`;
    // How many minutes after plan start does this section begin?
    const sectionRelStart = totalDur - (startO[section.name] || 0);
    let t = sectionRelStart;
    (section.steps || []).forEach((step: any) => {
      const dur = stepDur(step);
      const isRest = step.type === "Warten" || step.type === "Kühl" || step.type === "Ruhen";
      phases.push({ start: t, dur, type: isRest ? "rest" : "action", teig: teigId });
      t += dur;
    });
  });

  return phases;
}

// ─── Timeline Canvas ──────────────────────────────────────────────────────────

const TEIG_COLORS: Record<string, string> = {
  s0: "#f0a500",
  s1: "#60a5fa",
  s2: "#a78bfa",
  s3: "#34d399",
};

interface TimelineProps {
  phases: PhaseSegment[];
  gaps: GapSegment[];
  planDur: number;
  planOffset: number;
  scenario: Scenario;
  sleepFrom: number;
  sleepTo: number;
  onOffsetChange: (newAbsStart: number) => void;
  snapMin: number;
}

// Block occupies 75% of canvas width — 12.5% padding each side for context
const BLOCK_RATIO = 0.75;

function TimelineCanvas({ phases, gaps, planDur, planOffset, scenario, sleepFrom, sleepTo, onOffsetChange, snapMin }: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({ startX: 0, startOffset: 0 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, 80);

    // Proportional layout: block = BLOCK_RATIO of width, equal padding each side
    const pad = (W * (1 - BLOCK_RATIO)) / 2;
    const blockW = W * BLOCK_RATIO;
    const blockX = pad;
    // Total minutes shown = planDur / BLOCK_RATIO (includes padding context)
    const totalMin = planDur / BLOCK_RATIO;
    const mpp = totalMin / W; // minutes per pixel
    const viewStart = planOffset - pad * mpp;

    const TT = 14, TH = 24, TICK_Y = TT + TH + 5;

    // Full-width track background
    ctx.fillStyle = "#21262d";
    ctx.beginPath(); ctx.roundRect(0, TT, W, TH, 5); ctx.fill();

    // Sleep zone — shown at full opacity in nacht mode, dimmed otherwise
    const sleepAlpha = scenario === "nacht" ? 1 : 0.6;
    const dayBase = Math.floor(planOffset / 1440) * 1440;
    const sleepSegs = [
      { from: dayBase + sleepFrom, to: sleepFrom < sleepTo ? dayBase + sleepTo : dayBase + sleepTo + 1440 },
      { from: dayBase + sleepFrom + 1440, to: sleepFrom < sleepTo ? dayBase + sleepTo + 1440 : dayBase + sleepTo + 2880 },
      { from: dayBase + sleepFrom - 1440, to: sleepFrom < sleepTo ? dayBase + sleepTo - 1440 : dayBase + sleepTo },
    ];
    ctx.save();
    ctx.globalAlpha = sleepAlpha;
    ctx.beginPath(); ctx.roundRect(0, TT, W, TH, 5); ctx.clip();
    for (const seg of sleepSegs) {
      const x1 = (seg.from - viewStart) / mpp, x2 = (seg.to - viewStart) / mpp;
      const cx1 = Math.max(0, x1), cx2 = Math.min(W, x2);
      if (cx2 <= cx1) continue;
      ctx.fillStyle = "rgba(96,130,210,0.12)"; ctx.fillRect(cx1, TT, cx2 - cx1, TH);
      ctx.save(); ctx.beginPath(); ctx.rect(cx1, TT, cx2 - cx1, TH); ctx.clip();
      ctx.strokeStyle = "rgba(96,130,210,0.16)"; ctx.lineWidth = 1;
      for (let s = cx1 - TH; s < cx2 + TH; s += 7) {
        ctx.beginPath(); ctx.moveTo(s, TT); ctx.lineTo(s + TH, TT + TH); ctx.stroke();
      }
      ctx.restore();
      const lx = (cx1 + cx2) / 2;
      ctx.fillStyle = "rgba(96,130,210,0.45)"; ctx.font = "11px sans-serif";
      ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText("☽", lx, TT + TH / 2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Block background
    ctx.fillStyle = "rgba(22,27,34,0.85)";
    ctx.beginPath(); ctx.roundRect(blockX, TT, blockW, TH, 5); ctx.fill();

    // Action phases inside block — proportional within block width
    ctx.save();
    ctx.beginPath(); ctx.roundRect(blockX, TT, blockW, TH, 5); ctx.clip();
    for (const p of phases) {
      if (p.type === "rest") continue;
      const x = blockX + (p.start / planDur) * blockW;
      const pw = Math.max(6, (p.dur / planDur) * blockW);
      ctx.fillStyle = TEIG_COLORS[p.teig] || "#f0a500";
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, TT + 3, pw, TH - 6);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Block border
    ctx.strokeStyle = isDragging ? "rgba(240,165,0,0.9)" : "rgba(240,165,0,0.55)";
    ctx.lineWidth = isDragging ? 1.5 : 1;
    ctx.beginPath(); ctx.roundRect(blockX, TT, blockW, TH, 5); ctx.stroke();

    // Grip handle
    const gx = blockX + blockW / 2, gy = TT + TH / 2;
    ctx.strokeStyle = isDragging ? "rgba(240,165,0,0.7)" : "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5; ctx.lineCap = "round";
    [-4, 0, 4].forEach((dx) => {
      ctx.beginPath(); ctx.moveTo(gx + dx, gy - 4); ctx.lineTo(gx + dx, gy + 4); ctx.stroke();
    });

    // Time labels above block edges
    ctx.font = "9px sans-serif"; ctx.fillStyle = "#f0a500"; ctx.textBaseline = "bottom";
    ctx.textAlign = "left"; ctx.fillText(minToHHMM(planOffset), blockX + 2, TT);
    ctx.textAlign = "right"; ctx.fillText(minToHHMM(planOffset + planDur), blockX + blockW - 2, TT);

    // Adaptive axis ticks — step based on totalMin shown
    const step = totalMin <= 180 ? 30 : totalMin <= 480 ? 60 : totalMin <= 960 ? 120 : 240;
    const first = Math.ceil(viewStart / step) * step;
    for (let t = first; t <= viewStart + totalMin + step; t += step) {
      const x = (t - viewStart) / mpp;
      if (x < 0 || x > W) continue;
      ctx.strokeStyle = "#2d3440"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, TICK_Y); ctx.lineTo(x, TICK_Y + 4); ctx.stroke();
      ctx.fillStyle = "#484f58"; ctx.font = "10px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(minToHHMM(t), x, TICK_Y + 5);
    }

    // Now line (fixed on axis)
    const nx = (nowMin() - viewStart) / mpp;
    if (nx >= 0 && nx <= W) {
      ctx.strokeStyle = "#f85149"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(nx, TT - 2); ctx.lineTo(nx, TT + TH + 2); ctx.stroke();
      ctx.fillStyle = "#f85149"; ctx.beginPath(); ctx.arc(nx, TT - 2, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }, [phases, planDur, planOffset, scenario, isDragging, sleepFrom, sleepTo]);

  // ResizeObserver: setzt Dimensionen sobald wrap wirklich eine Breite hat,
  // dann draw(). Löst das Problem dass canvas.width=0 beim ersten Render.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      if (w === 0) return;
      canvas.width = w * dpr;
      canvas.height = 80 * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = "80px";
      draw();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    return () => ro.disconnect();
  }, [draw]);

  // Redraw whenever draw-deps change (planOffset, scenario, isDragging etc.)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) return;
    draw();
  }, [draw]);

  const mpp = () => {
    const c = canvasRef.current;
    if (!c) return 1;
    const w = c.getBoundingClientRect().width; // CSS width
    return w > 0 ? (planDur / BLOCK_RATIO) / w : 1; // min per pixel
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", height: 80, cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
      onPointerDown={(e) => {
        setIsDragging(true);
        dragState.current = { startX: e.clientX, startOffset: planOffset };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!isDragging) return;
        onOffsetChange(dragState.current.startOffset + (e.clientX - dragState.current.startX) * mpp());
      }}
      onPointerUp={(e) => {
        setIsDragging(false);
        const raw = dragState.current.startOffset + (e.clientX - dragState.current.startX) * mpp();
        onOffsetChange(snapTo(raw, snapMin));
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function PlanModal({ isOpen, onClose, onConfirm, recipe }: PlanModalProps) {
  const [settings, setSettings] = useState<CrumbSettings>(() => loadSettings());
  const { sleepFrom, sleepTo, abendZiel, morgenZiel, snapMin, showFreieZeit, minFreieZeit } = settings;

  const [multiplier, setMultiplier] = useState(1);
  const [scenario, setScenario] = useState<Scenario>("jetzt");
  const [planOffset, setPlanOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0); // 0 = heute, 1 = morgen, 2+ = weitere Tage
  const [manualHint, setManualHint] = useState("");
  const [pickerTarget, setPickerTarget] = useState<"from" | "to" | null>(null);
  const [pickerH, setPickerH] = useState(22);
  const [pickerM, setPickerM] = useState(0);
  const [pickerError, setPickerError] = useState("");

  // Re-read settings when modal opens (picks up changes made in Nav settings)
  useEffect(() => {
    if (isOpen) {
      const s = loadSettings();
      setSettings(s);
      setMultiplier(1);
      setManualHint("");
      setPickerTarget(null);
      setDayOffset(0);
      setPlanOffset(snapTo(nowMin(), s.snapMin, true));
      setScenario("jetzt");
    }
  }, [isOpen]);

  // ─── derived ───────────────────────────────────────────────────────────────

  const totalMinutes = useMemo(() => calcTotalDuration(recipe?.dough_sections ?? []), [recipe]);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalMins = totalMinutes % 60;
  const phases = useMemo(() => sectionsToPhases(recipe?.dough_sections ?? []), [recipe]);
  const gaps = useMemo(() => computeGaps(phases), [phases]);
  const longestGap = useMemo(() =>
    gaps.length ? gaps.reduce((a, b) => b.end - b.start > a.end - a.start ? b : a, gaps[0]) : null,
    [gaps]);
  const planDur = totalMinutes;
  const planStart = planOffset;

  const baseWeight = useMemo(() => {
    let w = 0;
    (recipe?.dough_sections ?? []).forEach((s: any) =>
      (s.ingredients || []).forEach((ing: any) => {
        const a = parseFloat(ing.amount) || 0;
        const u = (ing.unit || "").toLowerCase();
        if (u === "g") w += a; else if (u === "kg") w += a * 1000;
        else if (u === "ml") w += a; else if (u === "l") w += a * 1000;
      })
    );
    return w;
  }, [recipe]);
  const scaledWeight = baseWeight > 0
    ? `${((baseWeight * multiplier) / 1000).toFixed(2).replace(".", ",")} kg`
    : null;

  // ─── scenario logic ────────────────────────────────────────────────────────

  const isNachtAvailable = useMemo(() => {
    if (!longestGap || longestGap.end - longestGap.start < 30) return false;
    return ((sleepTo + 1440 - sleepFrom) % 1440) >= 30;
  }, [longestGap, sleepFrom, sleepTo]);

  const computeScenarioStart = useCallback((s: Scenario, day = dayOffset): number => {
    const now = nowMin();
    const base = day * 1440; // absolute offset for selected day
    if (s === "jetzt") {
      if (day === 0) return snapTo(now, snapMin, true);
      // Anderer Tag: frühestmöglich = 06:00 (oder Snap danach)
      return snapTo(base, snapMin, true);
    }
    if (s === "abend") {
      let start = base + abendZiel - planDur;
      if (day === 0 && start <= now) start += 1440;
      return snapTo(start, snapMin);
    }
    if (s === "morgen") {
      // "Morgen früh" relativ zum gewählten Tag = nächster Morgen
      let start = base + 1440 + morgenZiel - planDur;
      if (day === 0 && start < now) start += 1440;
      return snapTo(start, snapMin);
    }
    if (s === "nacht" && longestGap) {
      const gapMid = (longestGap.start + longestGap.end) / 2;
      const sleepDur = ((sleepTo + 1440 - sleepFrom) % 1440);
      const sleepMid = (sleepFrom + sleepDur / 2) % 1440;
      const baseStart = snapTo(base + sleepMid - gapMid, snapMin);
      const candidates = [baseStart, baseStart + 1440, baseStart + 2880];
      const chosen = candidates.find(c => c > now) ?? candidates[candidates.length - 1];
      return chosen;
    }
    return planOffset;
  }, [dayOffset, abendZiel, morgenZiel, planDur, longestGap, sleepFrom, sleepTo, snapMin, planOffset]);

  const activateScenario = useCallback((s: Scenario) => {
    if (s === "nacht" && !isNachtAvailable) return;
    setScenario(s);
    setPlanOffset(computeScenarioStart(s));
    setManualHint("");
  }, [computeScenarioStart, isNachtAvailable]);

  // ─── warnings ─────────────────────────────────────────────────────────────

  const warning = useMemo((): { level: "error" | "hint"; text: string } | null => {
    if (isPastAbsolute(planStart)) return { level: "error", text: "Plan liegt in der Vergangenheit" };
    if (inSleepWindow(((planStart % 1440) + 1440) % 1440, sleepFrom, sleepTo))
      return { level: "hint", text: `Plan startet um ${minToHHMM(planStart)} – mitten in der Nachtruhe` };
    const actionInSleep = phases.filter((p) => p.type === "action").some((p) => {
      for (let t = p.start; t < p.start + p.dur; t++) {
        // Normalize to 0..1439 correctly regardless of how many days ahead planStart is
        const absT = ((planStart + t) % 1440 + 1440) % 1440;
        if (inSleepWindow(absT, sleepFrom, sleepTo)) return true;
      }
      return false;
    });
    if (actionInSleep) return { level: "hint", text: "Eine Aktionsphase fällt in die Nachtruhe" };
    return null;
  }, [planStart, sleepFrom, sleepTo, phases]);

  // Only block on past — sleep collision is a hint, user can override
  const isPastWarning = warning?.text?.includes("Vergangenheit");
  const canConfirm = !isPastWarning;

  // ─── card notes ───────────────────────────────────────────────────────────

  const abendNote = abendZiel - planDur <= nowMin() ? "→ morgen Abend" : "";
  const morgenNote = (() => {
    const s = morgenZiel - planDur;
    return (s <= nowMin() ? s + 1440 : s) >= 2 * 1440 ? "→ übermorgen früh" : "";
  })();
  const nachtNote = !isNachtAvailable
    ? (((sleepTo + 1440 - sleepFrom) % 1440) < 30 ? "Schlaffenster zu kurz" : "keine langen Ruhephasen")
    : "";

  // ─── confirm ──────────────────────────────────────────────────────────────

  const handleConfirm = () => {
    if (!canConfirm) return;
    const endDate = absMinToDate(planStart + planDur);
    const target = toLocalISOString(endDate);
    const timeline = calculateBackplan(target, recipe?.dough_sections ?? []);
    onConfirm(target, multiplier, timeline, timeline);
  };

  // ─── picker (persists to localStorage) ────────────────────────────────────

  const openPicker = (target: "from" | "to") => {
    const val = target === "from" ? sleepFrom : sleepTo;
    setPickerH(Math.floor(val / 60)); setPickerM(val % 60);
    setPickerError(""); setPickerTarget(target);
  };

  const closePicker = (save: boolean) => {
    if (save) {
      const val = pickerH * 60 + pickerM;
      const nf = pickerTarget === "from" ? val : sleepFrom;
      const nt = pickerTarget === "to" ? val : sleepTo;
      if (nf === nt) { setPickerError("Von und bis dürfen nicht gleich sein"); return; }
      if (((nt + 1440 - nf) % 1440) < 30) { setPickerError("Schlaffenster muss mind. 30 min betragen"); return; }
      const updated = saveSettings(pickerTarget === "from" ? { sleepFrom: val } : { sleepTo: val });
      setSettings(updated);
    }
    setPickerTarget(null);
  };

  const handleOffsetChange = (newAbsStart: number) => {
    setPlanOffset(newAbsStart);
    setDayOffset(Math.max(0, Math.floor(newAbsStart / 1440)));
    setScenario("manuell");
    setManualHint("Manuell angepasst — Szenario wählen zum Zurücksetzen");
  };

  if (!isOpen || !recipe) return null;

  // ─── scenario card definitions ────────────────────────────────────────────

  const iconColor = (id: Scenario) => scenario === id ? "#f0a500" : "#8b949e";
  const scenarioCards: { id: Scenario; label: string; sub: string; note: string }[] = [
    { id: "jetzt",  label: dayOffset === 0 ? "Jetzt" : "Frühestmöglich", sub: dayOffset === 0 ? "so früh wie möglich" : `ab ${dayPickerLabel(dayOffset)} 00:00`, note: "" },
    { id: "abend",  label: "Abend",        sub: `fertig um ${minToHHMM(abendZiel)}`, note: abendNote },
    { id: "morgen", label: "Nächster Morgen", sub: `fertig um ${minToHHMM(morgenZiel)}`, note: morgenNote },
    { id: "nacht",  label: "Schlaf schonen", sub: "längste Pause ins Schlaffenster", note: nachtNote },
  ];

  const ScenarioIcon = ({ id }: { id: Scenario }) => {
    const c = iconColor(id);
    if (id === "jetzt") return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke={c} strokeWidth="1.1"/><path d="M7 4v3l2 1.2" stroke={c} strokeWidth="1.1" strokeLinecap="round"/></svg>;
    if (id === "abend") return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10c1-3 5-5 10-3" stroke={c} strokeWidth="1.1" strokeLinecap="round"/><circle cx="7" cy="5" r="2.5" stroke={c} strokeWidth="1.1"/></svg>;
    if (id === "morgen") return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v1M7 11v1M2 7H1M13 7h-1M3.5 3.5l.7.7M9.8 9.8l.7.7M3.5 10.5l.7-.7M9.8 4.2l.7-.7" stroke={c} strokeWidth="1.1" strokeLinecap="round"/><circle cx="7" cy="7" r="2.5" stroke={c} strokeWidth="1.1"/></svg>;
    return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2a5 5 0 1 0 0 10A6.5 6.5 0 0 1 10 2z" stroke={c} strokeWidth="1.1" strokeLinecap="round"/></svg>;
  };

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

        {/* Body */}
        <div className="overflow-y-auto flex-1">

          {/* Menge */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-widest">Menge</span>
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={() => setMultiplier(Math.max(0.5, +(multiplier - 0.5).toFixed(1)))}
                  className="w-8 h-8 rounded-lg bg-[#21262d] border border-[#30363d] flex items-center justify-center text-[#8b949e] hover:text-[#e6edf3] transition-colors">
                  <Minus size={14} />
                </button>
                <span className="text-sm font-semibold text-[#e6edf3] min-w-[80px] text-center">
                  {multiplier}×{scaledWeight && <span className="text-[#8b949e] font-normal"> ({scaledWeight})</span>}
                </span>
                <button onClick={() => setMultiplier(Math.min(3, +(multiplier + 0.5).toFixed(1)))}
                  className="w-8 h-8 rounded-lg bg-[#21262d] border border-[#30363d] flex items-center justify-center text-[#8b949e] hover:text-[#e6edf3] transition-colors">
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="h-px bg-[#21262d]" />

          {/* Planning block */}
          <div className="px-4 py-4">
            <p className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-widest mb-3">Wann soll's fertig sein?</p>

            {/* Tag-Auswahl — horizontal scrollbar */}
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 -mx-1 px-1">
              {Array.from({ length: 8 }, (_, i) => {
                const isActive = dayOffset === i;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      setDayOffset(i);
                      // Szenario neu berechnen für den gewählten Tag
                      const newStart = computeScenarioStart(scenario === "manuell" ? "jetzt" : scenario, i);
                      setPlanOffset(newStart);
                      if (scenario === "manuell") setScenario("jetzt");
                      setManualHint("");
                    }}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                      isActive
                        ? "bg-[rgba(240,165,0,0.12)] border-[#f0a500] text-[#f0a500]"
                        : "bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#484f58]"
                    }`}
                  >
                    {dayPickerLabel(i)}
                  </button>
                );
              })}
            </div>

            {/* Scenario grid */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {scenarioCards.map((sc) => {
                const isActive = scenario === sc.id;
                const isDisabled = sc.id === "nacht" && !isNachtAvailable;
                const isManual = scenario === "manuell";
                return (
                  <div
                    key={sc.id}
                    onClick={() => !isDisabled && activateScenario(sc.id)}
                    className={[
                      "rounded-xl px-3 py-2 flex items-center gap-2.5 transition-colors select-none",
                      isDisabled ? "bg-[#21262d] border border-[#30363d] opacity-35 cursor-not-allowed"
                      : isActive ? "bg-[rgba(240,165,0,0.07)] border border-[#f0a500] cursor-pointer"
                      : isManual ? "bg-[#21262d] border border-[#30363d] opacity-50 cursor-pointer hover:opacity-75 hover:border-[#484f58]"
                      : "bg-[#21262d] border border-[#30363d] cursor-pointer hover:border-[#484f58]",
                    ].join(" ")}
                  >
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${isActive ? "bg-[rgba(240,165,0,0.15)]" : "bg-[#2d333b]"}`}>
                      <ScenarioIcon id={sc.id} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[12px] font-semibold text-[#e6edf3] leading-snug">{sc.label}</span>
                      <span className={`text-[10px] leading-snug ${isActive ? "text-[#f0a500]" : "text-[#8b949e]"}`}>{sc.sub}</span>
                      {sc.note && (
                        <span className={`text-[10px] leading-snug ${sc.id === "nacht" ? "text-[#f85149]" : "text-[#e3b341]"}`}>{sc.note}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Times */}
            <div className="flex items-baseline justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="flex flex-col items-start">
                  <span className="text-base font-semibold text-[#f0a500] leading-tight">{minToHHMM(planStart)}</span>
                  <span className="text-[10px] text-[#8b949e] leading-tight h-[14px]">{dayLabel(planStart)}</span>
                </div>
                <span className="text-sm text-[#484f58]">→</span>
                <div className="flex flex-col items-start">
                  <span className="text-base font-semibold text-[#f0a500] leading-tight">{minToHHMM(planStart + planDur)}</span>
                  <span className="text-[10px] text-[#8b949e] leading-tight h-[14px]">{dayLabel(planStart + planDur)}</span>
                </div>
              </div>
              <span className="text-xs text-[#484f58]">{totalHours}h {totalMins}m</span>
            </div>

            {/* Timeline */}
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 pt-2.5 pb-2">
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
                phases={phases} gaps={gaps} planDur={planDur}
                planOffset={planOffset} scenario={scenario}
                sleepFrom={sleepFrom} sleepTo={sleepTo}
                onOffsetChange={handleOffsetChange} snapMin={snapMin}
              />

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
              {manualHint && !warning && (
                <div className="flex items-center justify-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-[#484f58]">Manuell angepasst —</span>
                  <button
                    onClick={() => { activateScenario(scenario === "manuell" ? "jetzt" : scenario); }}
                    className="text-[10px] text-[#f0a500] hover:text-[#f5c060] underline underline-offset-2 transition-colors"
                  >
                    Zurücksetzen
                  </button>
                </div>
              )}

            </div>
          </div>

          {/* Freie Zeit Liste — nur wenn in Settings aktiviert */}
          {showFreieZeit && gaps.filter(g => g.end - g.start >= minFreieZeit).length > 0 && (
            <div className="px-4 pb-2">
              <p className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-widest mb-2">Freie Zeit</p>
              <div className="flex flex-col gap-1.5">
                {gaps
                  .filter(g => g.end - g.start >= minFreieZeit)
                  .map((g, i) => {
                    const absStart = planStart + g.start;
                    const absEnd = planStart + g.end;
                    const dur = g.end - g.start;
                    // Only show as "night" (blue) if the gap starts during the sleep window
                    // — a long gap that spans overnight is still primarily "free time"
                    const gapAbsStart = ((absStart % 1440) + 1440) % 1440;
                    const night = inSleepWindow(gapAbsStart, sleepFrom, sleepTo);
                    const durText = dur < 60 ? `${dur} min` : `${Math.floor(dur/60)}h${dur%60>0?' '+dur%60+'m':''}`;
                    return (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-[rgba(34,197,94,0.06)] border-[rgba(34,197,94,0.2)]">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#22c55e]" />
                        <span className="text-[12px] text-[#e6edf3]">
                          {minToHHMM(absStart)} – {minToHHMM(absEnd)}{night ? " ☽" : ""}
                        </span>
                        <span className="text-[11px] ml-auto flex-shrink-0 text-[#22c55e]">
                          {durText}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-px bg-[#21262d] flex-shrink-0" />
        <div className="flex gap-3 px-4 py-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors">
            Abbrechen
          </button>
          <button onClick={handleConfirm} disabled={!canConfirm}
            className={`flex-[2] py-3 rounded-xl text-sm font-semibold transition-colors ${
              canConfirm ? "bg-[#1a7a3c] text-[#4ade80] hover:bg-[#1f9447]" : "bg-[#21262d] text-[#484f58] cursor-not-allowed"
            }`}>
            {warning && !isPastWarning ? "Trotzdem starten" : "Backplan starten"}
          </button>
        </div>

        {/* Picker overlay */}
        {pickerTarget && (
          <div className="absolute inset-0 bg-black/55 flex items-center justify-center rounded-[1.75rem] z-10">
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 w-[220px]">
              <p className="text-[11px] text-[#8b949e] uppercase tracking-widest mb-3">
                {pickerTarget === "from" ? "Nachtruhe von" : "Nachtruhe bis"}
              </p>
              <div className="flex items-center gap-2 justify-center mb-3">
                <input type="number" min={0} max={23} value={pickerH}
                  onChange={(e) => setPickerH(Math.max(0, Math.min(23, +e.target.value || 0)))}
                  className="bg-[#21262d] border border-[#30363d] rounded-lg p-2 text-2xl font-semibold text-[#e6edf3] w-[72px] text-center font-mono" />
                <span className="text-2xl text-[#484f58]">:</span>
                <input type="number" min={0} max={59} step={15} value={pickerM}
                  onChange={(e) => setPickerM(Math.max(0, Math.min(59, +e.target.value || 0)))}
                  className="bg-[#21262d] border border-[#30363d] rounded-lg p-2 text-2xl font-semibold text-[#e6edf3] w-[72px] text-center font-mono" />
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