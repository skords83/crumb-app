// DATEI: ui/src/app/backplan/page.tsx
// Konsolidiertes Backplan-Konzept:
// - Eine kompakte Card pro aktive Phase (zeigt nur aktiven Schritt + Button)
// - Erledigte/kommende Schritte der Phase als hauchdünne Zeilen ober-/unterhalb
// - Zutaten aufgeklappt solange noch Aktion-Schritte folgen, sonst kollabiert
// - Wartephasen eskalieren visuell je nach Restzeit (>30min / 5-30min / <5min / soft_done)
// - Backen mit rotem Akzent, Sub-Steps als Stepper
// - Locked-Phasen als Mini-Streifen
// - Sortierung nach Dringlichkeit (soft_done > imminent > soon > active > waiting > locked > done)

"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  Check,
  Sun,
  RotateCcw,
} from "lucide-react";
import PushPermissionBanner from "@/components/PushPermissionBanner";
import {
  type BakeSession,
  type TimelineStep,
  type PhaseGate,
  formatSmartTime,
  formatCountdown,
  formatDuration,
  formatStepDuration,
  getProgress,
  getPhases,
  getPhaseProgress,
} from "@/lib/backplan-utils";

const API = process.env.NEXT_PUBLIC_API_URL;
const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("crumb_token")}`,
});

const WAIT_TYPES = new Set(["Warten", "Ruhen", "Kühl"]);
const ACTION_TYPES = new Set(["Aktion", "Kneten"]);

function scaleAmount(rawAmount: string | number, multiplier: number): string {
  if (multiplier === 1) return String(rawAmount);
  const parsed = parseFloat(String(rawAmount || "0").replace(",", "."));
  if (isNaN(parsed) || parsed === 0) return String(rawAmount);
  const result = Math.round(parsed * multiplier * 10) / 10;
  return result % 1 === 0 ? String(result) : String(result).replace(".", ",");
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

// Urgency-Level für Wartephasen (Sekunden Restzeit)
type Urgency = "normal" | "soon" | "imminent" | "softdone";
function computeUrgency(
  secondsLeft: number | null,
  isSoftDone: boolean,
): Urgency {
  if (isSoftDone) return "softdone";
  if (secondsLeft === null) return "normal";
  if (secondsLeft <= 0) return "softdone";
  if (secondsLeft < 300) return "imminent"; // < 5 min
  if (secondsLeft < 1800) return "soon"; // < 30 min
  return "normal";
}

export default function BackplanPage() {
  const [sessions, setSessions] = useState<BakeSession[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [finishModalId, setFinishModalId] = useState<number | null>(null);
  const [finishNotes, setFinishNotes] = useState("");
  const [openIngredients, setOpenIngredients] = useState<Set<string>>(
    new Set(),
  );

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/bake-sessions/active`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch {}
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(loadSessions, 30000);
    return () => clearInterval(t);
  }, [loadSessions]);

  const transition = async (
    sid: number,
    stepIdx: number,
    action: string,
    extra: Record<string, any> = {},
  ) => {
    try {
      const res = await fetch(`${API}/bake-sessions/${sid}/transition`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ stepIndex: stepIdx, action, ...extra }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setSessions((prev) =>
        prev.map((s) =>
          s.id !== sid
            ? s
            : {
                ...s,
                step_states: data.step_states,
                step_timestamps: data.step_timestamps,
                projected_end: data.projected_end,
                timeline: data.timeline,
                gates: data.gates,
              },
        ),
      );
    } catch {
      loadSessions();
    }
  };

  const finishBaking = async (sid: number) => {
    try {
      const res = await fetch(`${API}/bake-sessions/${sid}/finish`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ notes: finishNotes || null }),
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sid));
        setActiveIdx(0);
        setFinishModalId(null);
        setFinishNotes("");
        if (sessions.length <= 1) window.location.href = "/";
      }
    } catch {
      alert("Fehler");
    }
  };

  const toggleIng = (key: string) =>
    setOpenIngredients((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const session = sessions[activeIdx];
  const timeline = session?.timeline || [];
  const gates = session?.gates || [];
  const multiplier = session?.multiplier || 1;

  const stepRemaining = useCallback(
    (step: TimelineStep) => {
      if (!step.end) return null;
      return Math.max(
        0,
        Math.round(
          (new Date(step.end).getTime() - currentTime.getTime()) / 1000,
        ),
      );
    },
    [currentTime],
  );

  const sortedPhases = useMemo(() => {
    const phases = getPhases(timeline).map((name) => {
      const steps = timeline.filter((s) => s.phase === name);
      const { done, total } = getPhaseProgress(timeline, name);
      const activeOrSoftDone = steps.find(
        (s) => s.state === "active" || s.state === "soft_done",
      );
      const readyStep = steps.find((s) => s.state === "ready");
      const activePhaseStep = activeOrSoftDone || readyStep || null;
      const hasActive = activePhaseStep != null;
      const allDone = done === total;
      const allLocked = steps.every((s) => s.state === "locked");
      const isActiveWaiting =
        hasActive &&
        activePhaseStep != null &&
        WAIT_TYPES.has(activePhaseStep.type);
      const isActiveAction = hasActive && !isActiveWaiting;
      const isSoftDone = activePhaseStep?.state === "soft_done";
      const isBaking = activePhaseStep?.type === "Backen";

      // Zutaten sind nur am Anfang einer Phase relevant — beim Abwiegen.
      // Sobald irgendein Schritt der Phase erledigt ist, hat der Baker alles bereit
      // und braucht die Mengen nicht mehr prominent.
      const ingredientsRelevant = steps.every((s) => s.state !== "done");

      // Urgency-Berechnung für Wartephasen
      const waitRem =
        activePhaseStep && activePhaseStep.end
          ? Math.max(
              0,
              Math.round(
                (new Date(activePhaseStep.end).getTime() -
                  currentTime.getTime()) /
                  1000,
              ),
            )
          : null;
      const urgency = isActiveWaiting
        ? computeUrgency(waitRem, !!isSoftDone)
        : isSoftDone
          ? ("softdone" as Urgency)
          : ("normal" as Urgency);

      return {
        name,
        steps,
        done,
        total,
        hasActive,
        allDone,
        allLocked,
        isActiveWaiting,
        isActiveAction,
        isSoftDone,
        isBaking,
        activePhaseStep,
        ingredientsRelevant,
        urgency,
        waitRem,
      };
    });

    // Sortierung nach Dringlichkeit
    return [...phases].sort((a, b) => {
      const rank = (p: typeof a) => {
        if (p.isSoftDone) return 0;
        if (p.isActiveWaiting && p.urgency === "imminent") return 1;
        if (p.isActiveWaiting && p.urgency === "soon") return 2;
        if (p.isActiveAction) return 3;
        if (p.isActiveWaiting) return 4;
        if (p.allLocked) return 5;
        if (p.allDone) return 6;
        return 7;
      };
      return rank(a) - rank(b);
    });
  }, [timeline, currentTime]);

  // Auto-toggle: Zutaten aufklappen wenn noch Aktion-Schritte folgen
  useEffect(() => {
    if (!session) return;
    setOpenIngredients((prev) => {
      const n = new Set(prev);
      sortedPhases.forEach((p) => {
        const k = `${session.id}-${p.name}`;
        if (p.hasActive && p.ingredientsRelevant) {
          n.add(k);
        } else if (p.hasActive && !p.ingredientsRelevant) {
          n.delete(k);
        }
      });
      return n;
    });
  }, [
    session?.id,
    sortedPhases
      .map((p) => `${p.name}:${p.ingredientsRelevant}:${p.hasActive}`)
      .join("|"),
  ]);

  const focusPhases = useMemo(() =>
    sortedPhases.filter(p =>
      !p.allDone && !p.allLocked && p.hasActive &&
      (p.isSoftDone || p.isActiveAction)
    ), [sortedPhases]);

  const waitingPhases = useMemo(() =>
    [...sortedPhases.filter(p => p.isActiveWaiting && !p.isSoftDone)]
      .sort((a, b) => (a.waitRem ?? Infinity) - (b.waitRem ?? Infinity)),
    [sortedPhases]);

  const lockedPhases = useMemo(() =>
    sortedPhases.filter(p => p.allLocked), [sortedPhases]);

  const donePhases = useMemo(() =>
    sortedPhases.filter(p => p.allDone), [sortedPhases]);

  const getSec = (name: string) =>
    session?.dough_sections?.find((s: any) => s.name === name);

  if (isLoading) return <BackplanSkeleton />;
  if (sessions.length === 0)
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F0E8] dark:bg-[#0F172A] px-6">
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-[#EDE5D6] dark:bg-white/10 flex items-center justify-center mx-auto mb-6">
            <Sun size={32} className="text-[#8B7355] dark:text-[#C4A484]" />
          </div>
          <h2 className="text-2xl font-bold text-[#2C1A0E] dark:text-white/90 mb-2">
            Keine Backpläne aktiv
          </h2>
          <p className="text-[#A68B6A] dark:text-white/40 mb-8">
            Plane ein Rezept um hier loszulegen.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-[#8B7355] text-white px-6 py-3 rounded-2xl font-bold text-sm"
          >
            <ChevronLeft size={16} /> Zur Übersicht
          </Link>
        </div>
      </div>
    );
  if (!session) return null;
  const projectedEnd = session.projected_end
    ? new Date(session.projected_end)
    : null;

  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] pb-32 transition-colors duration-200">
      {/* ── Finish Modal ── */}
      {finishModalId !== null &&
        (() => {
          const ms = sessions.find((s) => s.id === finishModalId);
          if (!ms) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0">
              <div
                className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
                onClick={() => setFinishModalId(null)}
              />
              <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-[#D6C9B4] dark:border-white/10">
                <div className="relative h-36 overflow-hidden rounded-t-3xl">
                  <img
                    src={
                      ms.image_url ||
                      "https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=400"
                    }
                    className="w-full h-full object-cover"
                    alt=""
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                  <div className="absolute bottom-3 left-4">
                    <p className="text-white font-extrabold text-[15px] truncate">
                      {ms.title}
                    </p>
                  </div>
                </div>
                <div className="p-5">
                  <p className="text-[13px] text-[#A68B6A] dark:text-white/50 mb-3">
                    Notizen zum Backergebnis (optional):
                  </p>
                  <textarea
                    value={finishNotes}
                    onChange={(e) => setFinishNotes(e.target.value)}
                    placeholder="z.B. Krume perfekt, nächstes Mal länger Stockgare..."
                    className="w-full h-20 px-3 py-2 rounded-xl border border-[#D6C9B4] dark:border-white/10 bg-[#F5F0E8] dark:bg-white/5 text-sm text-[#2C1A0E] dark:text-white/80 resize-none focus:outline-none focus:ring-2 focus:ring-[#8B7355]/30 mb-4 placeholder:text-[#C4A484] dark:placeholder:text-white/20"
                  />
                  <button
                    onClick={() => finishBaking(finishModalId)}
                    className="w-full py-3.5 rounded-2xl bg-[#8B7355] hover:bg-[#7A6347] active:scale-[0.98] text-white font-extrabold text-[14px] transition-all shadow-lg shadow-[#8B7355]/20 mb-3"
                  >
                    Fertig gebacken
                  </button>
                  <button
                    onClick={() => setFinishModalId(null)}
                    className="w-full py-2 text-[#A68B6A] dark:text-white/30 font-bold text-[13px]"
                  >
                    Weiterbacken
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* ── Mehrsessions-Switcher ── */}
      {sessions.length > 1 && (
        <div className="bg-[#EDE5D6] dark:bg-[#0F172A] border-b border-[#D6C9B4] dark:border-white/[0.07]">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#A68B6A] dark:text-white/20 mb-2">
              {sessions.length} aktive Backpläne
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sessions.map((s, idx) => {
                const p = getProgress(s.timeline || []);
                const isAct = idx === activeIdx;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveIdx(idx)}
                    className={`flex-shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${
                      isAct
                        ? "bg-[#8B7355]/15 border-[#8B7355]/40 dark:bg-[#C4A484]/20 dark:border-[#C4A484]/40"
                        : "bg-white dark:bg-white/5 border-[#D6C9B4] dark:border-white/10"
                    }`}
                  >
                    <img
                      src={
                        s.image_url ||
                        "https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=100"
                      }
                      className="w-8 h-8 rounded-lg object-cover"
                      alt=""
                    />
                    <div className="text-left min-w-0">
                      <div
                        className={`text-[12px] font-extrabold truncate max-w-[130px] ${isAct ? "text-[#5C3D1E] dark:text-white" : "text-[#2C1A0E] dark:text-white/70"}`}
                      >
                        {s.title}
                      </div>
                      <div
                        className={`text-[10px] font-bold ${isAct ? "text-[#8B7355] dark:text-[#C4A484]" : "text-[#A68B6A] dark:text-white/30"}`}
                      >
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

      {/* ── Sticky Header ── */}
      <div className="sticky top-0 z-30 bg-[#F5F0E8] dark:bg-[#0F172A] border-b border-[#D6C9B4] dark:border-white/[0.07]">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="p-2 rounded-xl hover:bg-[#EDE5D6] dark:hover:bg-white/10 transition-colors"
              >
                <ChevronLeft
                  size={18}
                  className="text-[#A68B6A] dark:text-white/40"
                />
              </Link>
              <img
                src={
                  session.image_url ||
                  "https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=200"
                }
                className="w-10 h-10 rounded-xl object-cover"
                alt=""
              />
              <div>
                <h1
                  className="text-[17px] leading-tight text-[#2C1A0E] dark:text-[#F5EDD8]"
                  style={{ fontFamily: "var(--font-dm-serif), serif" }}
                >
                  {session.title}
                </h1>
                <p className="text-[12px] text-[#8B7355] dark:text-[#C4A484]/70 font-medium flex items-center gap-1">
                  <Clock size={11} />
                  {projectedEnd
                    ? `Fertig um ~${formatSmartTime(projectedEnd)} Uhr`
                    : "Berechne..."}
                </p>
              </div>
            </div>
            <button
              onClick={() => setFinishModalId(session.id)}
              className="px-3 py-2 rounded-xl bg-green-600/10 dark:bg-green-500/15 text-green-700 dark:text-green-400 text-[11px] font-bold border border-green-600/20 dark:border-green-500/20 hover:bg-green-600/15 dark:hover:bg-green-500/25 transition-colors"
            >
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
                  <span
                    className={`text-[10px] w-[72px] flex-shrink-0 truncate font-bold ${
                      isDone
                        ? "text-[#8B7355]/50 dark:text-[#C4A484]/50"
                        : isActive
                          ? "text-[#8B7355] dark:text-[#C4A484]"
                          : "text-[#C4A484] dark:text-white/20"
                    }`}
                  >
                    {phase.name}
                  </span>
                  <div className="flex-1 h-[3px] rounded-full bg-[#D6C9B4] dark:bg-white/[0.07] overflow-hidden">
                    {isDone && (
                      <div className="h-full w-full rounded-full bg-[#8B7355]/40 dark:bg-[#C4A484]/40" />
                    )}
                    {isActive && (
                      <div
                        className="h-full rounded-full bg-[#8B7355] dark:bg-[#C4A484] animate-pulse"
                        style={{ width: `${pct * 100}%` }}
                      />
                    )}
                    {!isDone && !isActive && !isLocked && (
                      <div
                        className="h-full rounded-full bg-[#8B7355]/25 dark:bg-[#C4A484]/25"
                        style={{ width: `${pct * 100}%` }}
                      />
                    )}
                  </div>
                  <span
                    className={`text-[10px] w-5 text-right flex-shrink-0 font-bold ${
                      isDone
                        ? "text-[#8B7355]/50 dark:text-[#C4A484]/50"
                        : isActive
                          ? "text-[#8B7355] dark:text-[#C4A484]"
                          : "text-[#C4A484] dark:text-white/20"
                    }`}
                  >
                    {isDone
                      ? "✓"
                      : isLocked
                        ? "—"
                        : `${Math.round(pct * 100)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4">
        <PushPermissionBanner />

        {/* ── Alle Schritte erledigt ── */}
        {gates.length === 0 &&
          timeline.length > 0 &&
          timeline.every((s) => s.state === "done") && (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">🎉</div>
              <h3 className="text-lg font-bold text-[#2C1A0E] dark:text-white/90 mb-2">
                Alle Schritte erledigt!
              </h3>
              <p className="text-[#A68B6A] dark:text-white/40 mb-6">
                Du kannst den Backplan jetzt abschließen.
              </p>
              <button
                onClick={() => setFinishModalId(session.id)}
                className="px-6 py-3 rounded-2xl bg-[#8B7355] text-white font-bold text-sm"
              >
                Backen abschließen
              </button>
            </div>
          )}

        {/* ── JETZT: Gates + Focus-Phasen ── */}
        {(gates.length > 0 || focusPhases.length > 0) && (
          <div className="mb-5">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#A68B6A] dark:text-white/25 mb-2 px-1">
              Jetzt
            </p>

            {/* Gate-Cards */}
            {gates.map((gate) => (
              <div
                key={gate.phase}
                className="mb-3 rounded-2xl border-2 border-dashed border-emerald-600/30 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/5 p-5"
              >
                <div className="text-[13px] font-extrabold text-emerald-700 dark:text-emerald-400 mb-1">
                  {gate.phase} kann starten
                </div>
                <p className="text-[12px] text-[#5C3D1E] dark:text-white/40 mb-3">
                  Alle Vorstufen sind fertig.
                </p>
                <div className="flex gap-2 mb-3 flex-wrap">
                  {gate.dependencies.map((dep) => (
                    <span
                      key={dep}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold"
                    >
                      <Check size={10} /> {dep}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() =>
                    transition(session.id, gate.firstStepIdx, "confirm_gate", {
                      phase: gate.phase,
                    })
                  }
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[13px] transition-colors active:scale-[0.98]"
                >
                  {gate.phase} jetzt ansetzen
                </button>
              </div>
            ))}

            {/* Focus-Phase Cards */}
            {focusPhases.map((phase) => {
              const sd = getSec(phase.name);
              const ings = sd?.ingredients || [];
              const ik = `${session.id}-${phase.name}`;
              const isIO = openIngredients.has(ik);
              const doneSteps = phase.steps.filter((s) => s.state === "done");
              const activePhaseStep = phase.activePhaseStep!;
              const isBaking = phase.isBaking;
              const isReadyBaking =
                activePhaseStep.state === "ready" && isBaking;
              const nextStepAfterActive =
                phase.steps.find(
                  (s) =>
                    s.globalIdx > activePhaseStep.globalIdx &&
                    s.state !== "done",
                ) ?? null;
              const lastDoneStep =
                doneSteps.length > 0
                  ? doneSteps.reduce(
                      (acc, s) => (s.globalIdx > acc.globalIdx ? s : acc),
                      doneSteps[0],
                    )
                  : null;

              const undoButton =
                lastDoneStep && WAIT_TYPES.has(activePhaseStep.type) ? (
                  <button
                    onClick={() =>
                      transition(session.id, activePhaseStep.globalIdx, "undo")
                    }
                    className="mt-1.5 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold text-[#A68B6A]/70 dark:text-white/20 hover:text-[#8B7355] dark:hover:text-white/50 hover:bg-[#EDE5D6]/50 dark:hover:bg-white/[0.04] transition-colors"
                  >
                    <RotateCcw size={11} /> Schritt zurück
                  </button>
                ) : null;

              const IngredientsSection =
                ings.length === 0 ? null : !phase.ingredientsRelevant ? (
                  <div className="mb-1.5">
                    <button
                      onClick={() => toggleIng(ik)}
                      className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-transparent border border-[#EDE5D6] dark:border-white/[0.05] opacity-60 hover:opacity-100 transition-opacity"
                    >
                      <span className="text-[10px] font-semibold text-[#A68B6A] dark:text-white/35">
                        {ings.length} Zutaten · {phase.name}
                      </span>
                      <span className="text-[10px] text-[#8B7355]/60 dark:text-[#C4A484]/50 flex items-center gap-1">
                        {isIO ? (
                          <>
                            einklappen <ChevronUp size={10} />
                          </>
                        ) : (
                          <>
                            einblenden <ChevronDown size={10} />
                          </>
                        )}
                      </span>
                    </button>
                    {isIO && (
                      <div className="px-3 pb-2.5 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 rounded-b-lg border border-t-0 border-[#EDE5D6] dark:border-white/[0.05] bg-white/40 dark:bg-white/[0.02]">
                        {ings.map((ing: any, iIdx: number) => (
                          <div
                            key={iIdx}
                            className="flex justify-between text-[11px] py-1 border-b border-[#EDE5D6]/60 dark:border-white/[0.04] last:border-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-0"
                          >
                            <span className="text-[#5C3D1E]/80 dark:text-white/55">
                              {ing.name}
                            </span>
                            <span className="font-bold text-[#2C1A0E] dark:text-white/85">
                              {ing.amount
                                ? `${scaleAmount(ing.amount, multiplier)} ${String(ing.amount || "").includes(ing.unit) ? "" : ing.unit || ""}`
                                : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mb-2 rounded-xl bg-white/60 dark:bg-white/[0.03] border border-[#D6C9B4] dark:border-white/[0.07] overflow-hidden">
                    <button
                      onClick={() => toggleIng(ik)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#EDE5D6]/40 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#8B7355]/80 dark:text-[#C4A484]/70">
                        {phase.name} · Zutaten
                      </span>
                      <div className="flex items-center gap-2">
                        {multiplier !== 1 && (
                          <span className="text-[10px] font-bold text-[#8B7355] dark:text-[#C4A484]">
                            {multiplier}×
                          </span>
                        )}
                        {isIO ? (
                          <ChevronUp
                            size={12}
                            className="text-[#A68B6A] dark:text-white/30"
                          />
                        ) : (
                          <ChevronDown
                            size={12}
                            className="text-[#A68B6A] dark:text-white/30"
                          />
                        )}
                      </div>
                    </button>
                    {isIO && (
                      <div className="px-3 pb-2.5 pt-0.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                        {ings.map((ing: any, iIdx: number) => (
                          <div
                            key={iIdx}
                            className="flex justify-between text-[11px] py-1 border-b border-[#EDE5D6]/60 dark:border-white/[0.04] last:border-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-0"
                          >
                            <span className="text-[#5C3D1E]/80 dark:text-white/55">
                              {ing.name}
                            </span>
                            <span className="font-bold text-[#2C1A0E] dark:text-white/85">
                              {ing.amount
                                ? `${scaleAmount(ing.amount, multiplier)} ${String(ing.amount || "").includes(ing.unit) ? "" : ing.unit || ""}`
                                : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );

              // SOFT_DONE — Timer abgelaufen, Bestätigung nötig
              if (phase.isSoftDone) {
                return (
                  <div
                    key={phase.name}
                    className="mb-3 rounded-2xl border-2 border-amber-400/60 dark:border-amber-400/50 bg-amber-50 dark:bg-amber-500/[0.08] p-4 shadow-md shadow-amber-200/30 dark:shadow-amber-900/20"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[12px] font-extrabold flex-1 text-[#2C1A0E] dark:text-white/90 uppercase tracking-wide">
                        {phase.name}
                      </span>
                      <span className="text-[11px] font-extrabold text-amber-700 dark:text-amber-300 animate-pulse">
                        Bereit!
                      </span>
                    </div>
                    <div className="inline-flex items-center px-2 py-0.5 rounded-lg text-[9px] font-extrabold uppercase tracking-wide bg-amber-200 text-amber-800 dark:bg-amber-500/30 dark:text-amber-200 mb-2">
                      Bestätigung nötig
                    </div>
                    <p className="text-[13px] font-semibold text-[#2C1A0E] dark:text-white/90 mb-3 leading-snug">
                      {activePhaseStep.instruction}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          transition(
                            session.id,
                            activePhaseStep.globalIdx,
                            "complete",
                          )
                        }
                        className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-[13px] active:scale-[0.98] shadow-sm"
                      >
                        Ja, fertig
                      </button>
                      <button
                        onClick={() =>
                          transition(
                            session.id,
                            activePhaseStep.globalIdx,
                            "extend_timer",
                            { minutes: 15 },
                          )
                        }
                        className="px-3 py-3 rounded-xl bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold text-[12px]"
                      >
                        +15
                      </button>
                      <button
                        onClick={() =>
                          transition(
                            session.id,
                            activePhaseStep.globalIdx,
                            "extend_timer",
                            { minutes: 30 },
                          )
                        }
                        className="px-3 py-3 rounded-xl bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold text-[12px]"
                      >
                        +30
                      </button>
                    </div>
                    {undoButton}
                  </div>
                );
              }

              // BAKING READY — Ofen ist bereit, Backen starten
              if (isReadyBaking) {
                const lastDone =
                  doneSteps.length > 0
                    ? doneSteps[doneSteps.length - 1]
                    : null;
                const prevWasBaking = lastDone?.type === "Backen";
                return (
                  <React.Fragment key={phase.name}>
                    {IngredientsSection}
                    <div className="mb-3 rounded-2xl border-2 border-dashed border-red-400/50 dark:border-red-400/40 bg-red-50/70 dark:bg-red-500/[0.06] p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[12px] font-extrabold flex-1 text-[#2C1A0E] dark:text-white/85 uppercase tracking-wide">
                          {phase.name}
                        </span>
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-red-700 dark:text-red-400">
                          Bereit zum Backen
                        </span>
                      </div>
                      <p className="text-[13px] font-semibold text-[#2C1A0E] dark:text-white/85 mb-3 leading-snug">
                        {activePhaseStep.instruction}
                      </p>
                      <button
                        onClick={() =>
                          transition(
                            session.id,
                            activePhaseStep.globalIdx,
                            "start_baking",
                          )
                        }
                        className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-[13px] active:scale-[0.98]"
                      >
                        {prevWasBaking
                          ? "Weiter backen"
                          : "Ofen ist bereit — Backen starten"}
                      </button>
                      {undoButton}
                    </div>
                  </React.Fragment>
                );
              }

              // AKTIVE AKTION (inkl. aktives Backen)
              const sRem = stepRemaining(activePhaseStep);
              const actionElapsed =
                activePhaseStep.start && ACTION_TYPES.has(activePhaseStep.type)
                  ? Math.round(
                      (currentTime.getTime() -
                        new Date(activePhaseStep.start).getTime()) /
                        1000,
                    )
                  : null;
              const actionCountdownSec = (() => {
                if (sRem !== null) return sRem;
                if (
                  !activePhaseStep.start ||
                  !ACTION_TYPES.has(activePhaseStep.type)
                )
                  return null;
                const durMin = activePhaseStep.duration_min;
                const durMax = activePhaseStep.duration_max;
                if (durMin != null && durMax != null) return null;
                const durSec = activePhaseStep.duration * 60;
                const target =
                  new Date(activePhaseStep.start).getTime() + durSec * 1000;
                return Math.max(
                  0,
                  Math.round((target - currentTime.getTime()) / 1000),
                );
              })();
              const actionRangeStatus = (() => {
                if (actionElapsed === null) return null;
                const durMin = activePhaseStep.duration_min;
                const durMax = activePhaseStep.duration_max;
                if (durMin == null || durMax == null) return null;
                const elapsedMin = actionElapsed / 60;
                if (elapsedMin >= durMax) return "over" as const;
                if (elapsedMin >= durMin) return "ready" as const;
                return "running" as const;
              })();
              const cardStyle = isBaking
                ? "border-2 border-red-400/45 bg-red-50/50 dark:border-red-400/30 dark:bg-red-500/[0.06]"
                : "border-2 border-[#8B7355]/30 bg-[#8B7355]/[0.06] dark:border-[#C4A484]/30 dark:bg-[#C4A484]/[0.08]";
              const stepBadge = isBaking
                ? "bg-red-500 text-white"
                : "bg-[#8B7355]/15 text-[#8B7355] border border-[#8B7355]/20 dark:bg-[#C4A484]/20 dark:text-[#C4A484] dark:border-[#C4A484]/20";

              return (
                <React.Fragment key={phase.name}>
                  {IngredientsSection}
                  <div className={`mb-3 rounded-2xl p-4 ${cardStyle}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[12px] font-extrabold flex-1 text-[#2C1A0E] dark:text-white/85 uppercase tracking-wide">
                        {phase.name}
                      </span>
                      <span className="text-[10px] text-[#A68B6A] dark:text-white/30 font-bold">
                        {activePhaseStep.scheduled_start
                          ? new Date(activePhaseStep.scheduled_start) <=
                            currentTime
                            ? `seit ${formatSmartTime(new Date(activePhaseStep.scheduled_start))}`
                            : `ab ${formatSmartTime(new Date(activePhaseStep.scheduled_start))}`
                          : ""}
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl mb-3 bg-white/40 dark:bg-white/[0.04]">
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${isBaking ? "bg-red-500" : "bg-[#8B7355] dark:bg-[#C4A484]"} animate-pulse`}
                      />
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[9px] font-extrabold uppercase tracking-wide flex-shrink-0 mt-0.5 ${stepBadge}`}
                      >
                        {activePhaseStep.type}
                      </span>
                      <span className="text-[13px] font-semibold flex-1 leading-snug text-[#2C1A0E] dark:text-white/90">
                        {activePhaseStep.instruction}
                      </span>
                      {actionRangeStatus !== null && actionElapsed !== null ? (
                        <span
                          className={`text-[13px] font-extrabold flex-shrink-0 tabular-nums ${
                            actionRangeStatus === "over"
                              ? "text-amber-600 dark:text-amber-400"
                              : actionRangeStatus === "ready"
                                ? "text-green-600 dark:text-green-400"
                                : isBaking
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-[#8B7355] dark:text-[#C4A484]"
                          }`}
                        >
                          {formatCountdown(actionElapsed)}
                        </span>
                      ) : actionCountdownSec !== null ? (
                        <span
                          className={`text-[13px] font-extrabold flex-shrink-0 tabular-nums ${isBaking ? "text-red-600 dark:text-red-400" : "text-[#8B7355] dark:text-[#C4A484]"}`}
                        >
                          {actionCountdownSec > 0
                            ? formatCountdown(actionCountdownSec)
                            : "0:00"}
                        </span>
                      ) : (
                        <span
                          className={`text-[11px] font-bold flex-shrink-0 tabular-nums ${isBaking ? "text-red-600 dark:text-red-400" : "text-[#8B7355] dark:text-[#C4A484]"}`}
                        >
                          {sRem !== null && sRem > 0
                            ? formatCountdown(sRem)
                            : formatStepDuration(activePhaseStep)}
                        </span>
                      )}
                    </div>
                    {actionRangeStatus !== null && actionElapsed !== null && (
                      <div className="flex items-center gap-2 px-3 pb-1 -mt-2 mb-1">
                        <div className="flex-1 h-1 rounded-full bg-[#EDE5D6] dark:bg-white/[0.08] overflow-hidden">
                          {(() => {
                            const durMinSec =
                              activePhaseStep.duration_min! * 60;
                            const durMaxSec =
                              activePhaseStep.duration_max! * 60;
                            const pct = Math.min(
                              actionElapsed / durMaxSec,
                              1,
                            );
                            const minPct = durMinSec / durMaxSec;
                            return (
                              <div className="relative h-full">
                                <div
                                  className={`absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ${
                                    actionRangeStatus === "over"
                                      ? "bg-amber-500"
                                      : actionRangeStatus === "ready"
                                        ? "bg-green-500"
                                        : "bg-[#8B7355] dark:bg-[#C4A484]"
                                  }`}
                                  style={{ width: `${pct * 100}%` }}
                                />
                                <div
                                  className="absolute top-0 h-full w-0.5 bg-white/60 dark:bg-white/30"
                                  style={{ left: `${minPct * 100}%` }}
                                />
                              </div>
                            );
                          })()}
                        </div>
                        <span
                          className={`text-[10px] font-bold flex-shrink-0 ${
                            actionRangeStatus === "over"
                              ? "text-amber-600 dark:text-amber-400"
                              : actionRangeStatus === "ready"
                                ? "text-green-600 dark:text-green-400"
                                : "text-[#A68B6A] dark:text-white/30"
                          }`}
                        >
                          {actionRangeStatus === "over"
                            ? "Maximalzeit überschritten"
                            : actionRangeStatus === "ready"
                              ? "Fertig wenn bereit"
                              : `Ziel: ${formatStepDuration(activePhaseStep)}`}
                        </span>
                      </div>
                    )}
                    {isBaking ? (
                      <button
                        onClick={() =>
                          transition(
                            session.id,
                            activePhaseStep.globalIdx,
                            "complete",
                          )
                        }
                        className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-[13px] active:scale-[0.98]"
                      >
                        {nextStepAfterActive?.type === "Backen"
                          ? "Weiter"
                          : "Raus aus dem Ofen"}
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          transition(
                            session.id,
                            activePhaseStep.globalIdx,
                            "complete",
                          )
                        }
                        className="w-full py-3 rounded-xl bg-[#8B7355] hover:bg-[#7A6347] text-white font-bold text-[13px] active:scale-[0.98]"
                      >
                        Erledigt
                      </button>
                    )}
                    {undoButton}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* ── LÄUFT NEBENHER: kompakter Timer-Strip ── */}
        {waitingPhases.length > 0 && (
          <div className="mb-5">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#A68B6A] dark:text-white/25 mb-2 px-1">
              {gates.length > 0 || focusPhases.length > 0
                ? "Läuft nebenher"
                : "Läuft"}
            </p>
            <div className="flex flex-col gap-2">
              {waitingPhases.map((phase) => {
                const step = phase.activePhaseStep!;
                const isImminent = phase.urgency === "imminent";
                const isSoon = phase.urgency === "soon";
                return (
                  <div
                    key={phase.name}
                    className={`rounded-xl px-3 py-2.5 flex items-center gap-3 ${
                      isImminent
                        ? "bg-amber-100/40 dark:bg-amber-500/[0.10] border border-amber-300/50 dark:border-amber-400/30"
                        : "bg-[#EDE5D6]/40 dark:bg-white/[0.03] border border-[#D6C9B4] dark:border-white/[0.06]"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-[11px] font-extrabold uppercase tracking-wide truncate ${
                          isImminent
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-[#5C3D1E] dark:text-white/60"
                        }`}
                      >
                        {phase.name}
                      </div>
                      <div className="text-[10px] text-[#A68B6A] dark:text-white/30 truncate">
                        {step.instruction}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {phase.waitRem !== null && phase.waitRem > 0 && (
                        <span
                          className={`text-[14px] font-extrabold tabular-nums ${
                            isImminent
                              ? "text-amber-700 dark:text-amber-300"
                              : isSoon
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-[#8B7355] dark:text-[#C4A484]"
                          }`}
                        >
                          {formatCountdown(phase.waitRem)}
                        </span>
                      )}
                      <button
                        onClick={() =>
                          transition(
                            session.id,
                            step.globalIdx,
                            "extend_timer",
                            { minutes: 15 },
                          )
                        }
                        className="px-2 py-1 rounded-lg bg-[#EDE5D6] dark:bg-white/[0.06] text-[#5C3D1E] dark:text-white/40 font-bold text-[10px] hover:bg-[#D6C9B4] dark:hover:bg-white/10 transition-colors"
                      >
                        +15
                      </button>
                      <button
                        onClick={() =>
                          transition(session.id, step.globalIdx, "complete")
                        }
                        className={`px-2 py-1 rounded-lg font-bold text-[10px] transition-colors ${
                          isImminent
                            ? "bg-amber-200 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 hover:bg-amber-300 dark:hover:bg-amber-500/30"
                            : "bg-[#8B7355]/10 dark:bg-white/[0.05] text-[#8B7355] dark:text-white/40 hover:bg-[#8B7355]/20 dark:hover:bg-white/10"
                        }`}
                      >
                        Fertig
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── DANACH: Nächste + restliche gesperrte Phasen ── */}
        {lockedPhases.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#A68B6A] dark:text-white/25 mb-2 px-1">
              Danach
            </p>
            {/* Erste locked Phase als Preview */}
            {(() => {
              const next = lockedPhases[0];
              const firstStep = next.steps[0];
              const startTime = firstStep?.start
                ? new Date(firstStep.start)
                : null;
              return (
                <div className="mb-2 rounded-xl border border-[#D6C9B4] dark:border-white/[0.06] bg-white/30 dark:bg-white/[0.02] px-4 py-3 opacity-65">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-extrabold text-[#5C3D1E] dark:text-white/45 uppercase tracking-wide flex-1 truncate">
                      {next.name}
                    </span>
                    <span className="text-[10px] text-[#C4A484] dark:text-white/20 flex-shrink-0">
                      {startTime
                        ? `~${formatSmartTime(startTime)} Uhr`
                        : `${next.total} Schritte`}
                    </span>
                  </div>
                  {firstStep && (
                    <p className="text-[11px] text-[#A68B6A] dark:text-white/30 truncate">
                      {firstStep.instruction}
                    </p>
                  )}
                </div>
              );
            })()}
            {/* Weitere locked Phasen als Mini-Zeilen */}
            {lockedPhases.slice(1).map((phase) => {
              const firstStep = phase.steps[0];
              const startTime = firstStep?.start
                ? new Date(firstStep.start)
                : null;
              return (
                <div
                  key={phase.name}
                  className="mb-1 flex items-center gap-2.5 px-3 py-1 opacity-35"
                >
                  <div className="w-1 h-1 rounded-full bg-[#D6C9B4] dark:bg-white/20 flex-shrink-0" />
                  <span className="text-[10px] text-[#A68B6A] dark:text-white/30 flex-1 truncate">
                    {phase.name}
                  </span>
                  <span className="text-[10px] text-[#C4A484] dark:text-white/15 flex-shrink-0">
                    {startTime
                      ? `~${formatSmartTime(startTime)}`
                      : `${phase.total} Schritte`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Erledigte Phasen ── */}
        {donePhases.length > 0 && (
          <div className="mb-4">
            {donePhases.map((phase) => (
              <div
                key={phase.name}
                className="mb-1 flex items-center gap-2 px-2 py-1 opacity-30"
              >
                <Check
                  size={10}
                  className="text-[#8B7355] dark:text-[#C4A484] flex-shrink-0"
                />
                <span className="text-[10px] text-[#8B7355] dark:text-[#C4A484] flex-1">
                  {phase.name}
                </span>
                <span className="text-[9px] text-[#C4A484] dark:text-white/15">
                  {phase.total} Schritte
                </span>
              </div>
            ))}
          </div>
        )}

        {multiplier !== 1 && (
          <div className="mt-2 text-center">
            <span className="text-[10px] font-bold text-[#8B7355] dark:text-[#C4A484] bg-[#8B7355]/10 dark:bg-[#C4A484]/10 px-3 py-1 rounded-lg">
              {multiplier}x Menge
            </span>
          </div>
        )}

        <div className="mt-6">
          <Link
            href={`/recipes/${session.recipe_id}`}
            className="block w-full text-center py-3 rounded-2xl bg-[#EDE5D6] dark:bg-white/[0.04] text-[#A68B6A] dark:text-white/40 font-bold text-[12px] border border-[#D6C9B4] dark:border-white/[0.07] hover:bg-[#D6C9B4] dark:hover:bg-white/[0.07] transition-colors"
          >
            Ganzes Rezept zeigen
          </Link>
        </div>
      </div>
    </div>
  );
}
