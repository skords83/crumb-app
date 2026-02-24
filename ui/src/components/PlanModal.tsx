"use client";

import React, { useState, useMemo, useEffect } from "react";
import { X, Play, Clock, Target, Sun, Utensils, Moon, Plus, Minus } from "lucide-react";
import { calculateBackplan, formatTimeManual } from "@/lib/backplan-utils";

interface PlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (plannedAt: string, multiplier: number, timeline: any[]) => void;
  recipe: {
    title: string;
    dough_sections: any[];
  };
}

export default function PlanModal({ isOpen, onClose, onConfirm, recipe }: PlanModalProps) {
  const [mode, setMode] = useState<"now" | "start" | "end">("end");
  const [selectedTime, setSelectedTime] = useState("");
  const [multiplier, setMultiplier] = useState(1);
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset beim Öffnen
  useEffect(() => {
    if (isOpen) {
      setMode("end");
      setSelectedTime("");
      setMultiplier(1);
      setActivePreset(null);
      setError(null);
    }
  }, [isOpen]);

  // Validate when selectedTime or mode changes
  useEffect(() => {
    if (mode === "end" && selectedTime) {
      setError(validateEndTime(selectedTime));
    } else {
      setError(null);
    }
  }, [selectedTime, mode]);

  // FIX: Gesamtzeit korrekt berechnen – parallele Phasen (Vorteige) laufen gleichzeitig,
  // nur die längste zählt. Sequentielle Phasen (Hauptteig etc.) werden addiert.
  const totalMinutes = useMemo(() => {
    if (!recipe?.dough_sections) return 0;
    let parallelMax = 0;
    let sequential = 0;
    recipe.dough_sections.forEach((section: any) => {
      const dur = (section.steps || []).reduce(
        (sum: number, step: any) => sum + (parseInt(step.duration) || 0), 0
      );
      if (section.is_parallel) {
        parallelMax = Math.max(parallelMax, dur);
      } else {
        sequential += dur;
      }
    });
    return parallelMax + sequential;
  }, [recipe]);

  const totalHours = Math.floor(totalMinutes / 60);
  const totalMins = totalMinutes % 60;

  // Basisgewicht aus allen Zutaten
  const baseWeight = useMemo(() => {
    if (!recipe?.dough_sections) return 0;
    let weight = 0;
    recipe.dough_sections.forEach((section: any) => {
      (section.ingredients || []).forEach((ing: any) => {
        const amount = parseFloat(ing.amount) || 0;
        const unit = (ing.unit || "").toLowerCase();
        if (unit === "g") weight += amount;
        else if (unit === "kg") weight += amount * 1000;
        else if (unit === "ml") weight += amount;
        else if (unit === "l") weight += amount * 1000;
      });
    });
    return weight;
  }, [recipe]);

  // Hilfsfunktionen
  const parseTimeInput = (val: string): Date => {
    if (!val) return new Date();
    const [d, t] = val.split("T");
    const [y, m, day] = d.split("-").map(Number);
    const [h, min] = t.split(":").map(Number);
    return new Date(y, m - 1, day, h, min);
  };

// toLocalISOString in PlanModal.tsx – Offset WEGLASSEN
const toLocalISOString = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${date}T${time}`; // z.B. "2025-01-05T09:00" – kein +01:00
};

  // Validation function for end time
  const validateEndTime = (timeStr: string): string | null => {
    if (!timeStr || mode !== "end") return null;
    const endTime = parseTimeInput(timeStr);
    const now = new Date();

    if (endTime <= now) {
      return "Die Endzeit liegt in der Vergangenheit. Bitte wähle eine Zeit in der Zukunft.";
    }

    const timeDiffMinutes = (endTime.getTime() - now.getTime()) / 60000;
    if (timeDiffMinutes < totalMinutes) {
      return `Für dieses Rezept werden ${totalHours}h ${totalMins}m benötigt. Die gewählte Zeit ist zu nah.`;
    }

    return null;
  };

  const formatTime = (date: Date): string => {
    return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  };

  const formatRelative = (date: Date): string => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return `Heute, ${formatTime(date)}`;
    if (date.toDateString() === tomorrow.toDateString()) return `Morgen, ${formatTime(date)}`;

    const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    return `${days[date.getDay()]}, ${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, "0")}. ${formatTime(date)}`;
  };

  // FIX: Alle drei Modi geben jetzt einen String MIT Timezone-Offset zurück.
  const getTargetTimeString = (): string | null => {
    const now = new Date();

    if (mode === "now") {
      return toLocalISOString(new Date(now.getTime() + totalMinutes * 60000));
    }
    if (mode === "start" && selectedTime) {
      const start = parseTimeInput(selectedTime);
      return toLocalISOString(new Date(start.getTime() + totalMinutes * 60000));
    }
    if (mode === "end" && selectedTime) {
      return toLocalISOString(parseTimeInput(selectedTime));
    }
    return null;
  };

  // Berechnete Start/End-Zeiten für die Anzeige
  const calculated = useMemo(() => {
    const now = new Date();

    if (mode === "now") {
      const end = new Date(now.getTime() + totalMinutes * 60000);
      return { start: now, end, startLabel: "Jetzt", endLabel: formatRelative(end) };
    }
    if (mode === "start" && selectedTime) {
      const start = parseTimeInput(selectedTime);
      const end = new Date(start.getTime() + totalMinutes * 60000);
      return { start, end, startLabel: formatRelative(start), endLabel: formatRelative(end) };
    }
    if (mode === "end" && selectedTime) {
      const end = parseTimeInput(selectedTime);
      const start = new Date(end.getTime() - totalMinutes * 60000);
      return { start, end, startLabel: formatRelative(start), endLabel: formatRelative(end) };
    }
    return null;
  }, [mode, selectedTime, totalMinutes]);

  // Quick Presets
  const presets = [
    {
      label: "Morgenfrisch",
      icon: <Sun size={18} />,
      desc: "Fertig 07:00",
      getTime: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(7, 0, 0, 0);
        return d;
      },
    },
    {
      label: "Zum Mittag",
      icon: <Utensils size={18} />,
      desc: "Fertig 12:00",
      getTime: () => {
        const d = new Date();
        if (d.getHours() >= 12) d.setDate(d.getDate() + 1);
        d.setHours(12, 0, 0, 0);
        return d;
      },
    },
    {
      label: "Zum Abend",
      icon: <Moon size={18} />,
      desc: "Fertig 18:00",
      getTime: () => {
        const d = new Date();
        if (d.getHours() >= 18) d.setDate(d.getDate() + 1);
        d.setHours(18, 0, 0, 0);
        return d;
      },
    },
  ];

  const handlePreset = (preset: typeof presets[0], idx: number) => {
    setActivePreset(idx);
    setMode("end");
    const t = preset.getTime();
    setSelectedTime(
      `${t.getFullYear()}-${(t.getMonth() + 1).toString().padStart(2, "0")}-${t.getDate().toString().padStart(2, "0")}T${formatTime(t)}`
    );
  };

  const handleConfirm = () => {
    const target = getTargetTimeString();
    if (!target) return;

    if (mode === "end") {
      const validationError = validateEndTime(selectedTime);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    const timeline = calculateBackplan(target, recipe.dough_sections);
    onConfirm(target, multiplier, timeline);
  };

  const canConfirm = mode === "now" || (!!selectedTime && !error);
  const scaledWeight = baseWeight > 0
    ? `${((baseWeight * multiplier) / 1000).toFixed(2).replace(".", ",")} kg`
    : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div
        className="bg-[#FFFDF9] dark:bg-gray-800 rounded-[2rem] w-full max-w-[420px] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-7 pt-7 pb-0 text-center relative">
          <button
            onClick={onClose}
            className="absolute right-5 top-5 p-2 text-gray-300 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300 transition-colors rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X size={18} />
          </button>

          <div className="inline-flex items-center gap-2 bg-[#F5F0E8] dark:bg-gray-700 px-4 py-1.5 rounded-full mb-4">
            <Clock size={14} className="text-[#8B7355] dark:text-[#A0845C]" />
            <span className="text-[13px] font-bold text-[#8B7355] dark:text-[#A0845C]">
              {totalHours}h {totalMins}m Gesamtzeit
            </span>
          </div>

          <h2 className="text-2xl font-extrabold text-[#2D2D2D] dark:text-gray-100 tracking-tight mb-1">
            Backplan erstellen
          </h2>
          <p className="text-[13px] text-gray-400 dark:text-gray-400">{recipe.title}</p>
        </div>

        {/* Mengen-Slider */}
        <div className="mx-7 mt-5 bg-[#FAF7F2] dark:bg-gray-700/50 rounded-2xl p-4 border border-[#F0EBE3] dark:border-gray-600">
          <div className="flex justify-between items-center mb-3">
            <span className="text-[11px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-widest">
              Menge
            </span>
            <span className="text-[15px] font-extrabold text-[#2D2D2D] dark:text-gray-100">
              {multiplier}×{" "}
              {scaledWeight && (
                <span className="font-semibold text-[#8B7355] dark:text-[#A0845C]">({scaledWeight})</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMultiplier(Math.max(0.5, +(multiplier - 0.5).toFixed(1)))}
              className="w-9 h-9 rounded-xl border-2 border-[#E8E2D8] dark:border-gray-600 bg-white dark:bg-gray-800 flex items-center justify-center text-[#8B7355] dark:text-[#A0845C] hover:border-[#8B7355] dark:hover:border-[#A0845C] transition-colors"
            >
              <Minus size={16} strokeWidth={2.5} />
            </button>
            <div className="flex-1 relative h-1.5 bg-[#E8E2D8] dark:bg-gray-600 rounded-full">
              <div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-[#8B7355] to-[#A0845C] dark:from-[#A0845C] dark:to-[#B8956A] rounded-full transition-all duration-200"
                style={{ width: `${((multiplier - 0.5) / 2.5) * 100}%` }}
              />
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.5"
                value={multiplier}
                onChange={(e) => setMultiplier(parseFloat(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
              />
            </div>
            <button
              onClick={() => setMultiplier(Math.min(3, +(multiplier + 0.5).toFixed(1)))}
              className="w-9 h-9 rounded-xl border-2 border-[#E8E2D8] dark:border-gray-600 bg-white dark:bg-gray-800 flex items-center justify-center text-[#8B7355] dark:text-[#A0845C] hover:border-[#8B7355] dark:hover:border-[#A0845C] transition-colors"
            >
              <Plus size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Modus-Tabs */}
        <div className="flex gap-1 mx-7 mt-5 bg-[#F5F0E8] dark:bg-gray-700 rounded-2xl p-1">
          {([
            { id: "now" as const, label: "Jetzt", icon: <Play size={13} /> },
            { id: "start" as const, label: "Startzeit", icon: <Clock size={13} /> },
            { id: "end" as const, label: "Fertig um", icon: <Target size={13} /> },
          ]).map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                setActivePreset(null);
                setError(null);
                if (m.id === "now") setSelectedTime("");
              }}
              className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 ${
                mode === m.id
                  ? "bg-white dark:bg-gray-700 text-[#2D2D2D] dark:text-gray-100 font-bold shadow-sm"
                  : "text-gray-400 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>

        {/* Quick Presets (nur "end" Modus) */}
        {mode === "end" && (
          <div className="flex gap-2 mx-7 mt-4">
            {presets.map((p, i) => (
              <button
                key={i}
                onClick={() => handlePreset(p, i)}
                className={`flex-1 py-3 px-2 rounded-2xl border-2 text-center transition-all duration-200 ${
                  activePreset === i
                    ? "border-[#8B7355] dark:border-[#A0845C] bg-[#FAF5ED] dark:bg-[#4A4030]"
                    : "border-[#F0EBE3] dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-[#D4C9B8] dark:hover:border-gray-500"
                }`}
              >
                <div className="flex justify-center mb-1 text-[#8B7355] dark:text-[#A0845C]">{p.icon}</div>
                <div className="text-[12px] font-bold text-[#2D2D2D] dark:text-gray-100">{p.label}</div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 font-semibold">{p.desc}</div>
              </button>
            ))}
          </div>
        )}

        {/* Datetime Input (nicht bei "now") */}
        {mode !== "now" && (
          <div className="mx-7 mt-4">
            <label className="block text-[11px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-widest mb-2">
              {mode === "start" ? "Wann willst du starten?" : "Wann soll das Brot fertig sein?"}
            </label>
            <input
              type="datetime-local"
              value={selectedTime}
              onChange={(e) => {
                setSelectedTime(e.target.value);
                setActivePreset(null);
              }}
              className={`w-full p-3.5 rounded-2xl border-2 text-[16px] font-bold outline-none transition-colors ${
                error
                  ? "border-red-400 bg-red-50 text-red-700 focus:border-red-500"
                  : "border-[#F0EBE3] dark:border-gray-600 bg-white dark:bg-gray-800 text-[#2D2D2D] dark:text-gray-100 focus:border-[#8B7355] dark:focus:border-[#A0845C]"
              }`}
            />
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mx-7 mt-3 p-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-[13px] font-semibold text-red-600">{error}</p>
          </div>
        )}

        {/* Berechnetes Ergebnis */}
        {(mode === "now" || calculated) && (
          <div className="mx-7 mt-4 bg-gradient-to-br from-[#FAF7F2] to-[#F5F0E8] dark:from-gray-700 dark:to-gray-800 rounded-2xl p-4 border border-[#E8E2D8] dark:border-gray-600">
            <div className="flex items-center justify-between">
              {/* Start */}
              <div className="text-center flex-1">
                <div className="text-[10px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                  Start
                </div>
                <div
                  className={`text-[14px] font-extrabold ${
                    mode === "start" || mode === "now" ? "text-[#8B7355] dark:text-[#A0845C]" : "text-[#2D2D2D] dark:text-gray-100"
                  }`}
                >
                  {calculated?.startLabel || "—"}
                </div>
              </div>

              {/* Pfeil */}
              <div className="flex flex-col items-center gap-1 px-3">
                <div className="w-12 h-0.5 bg-gradient-to-r from-[#D4C9B8] via-[#8B7355] to-[#D4C9B8] dark:from-[#5A5040] dark:via-[#A0845C] dark:to-[#5A5040] rounded-full relative">
                  <div className="absolute -right-1 -top-[3px] w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[5px] border-l-[#8B7355] dark:border-l-[#A0845C]" />
                </div>
                <span className="text-[10px] font-bold text-gray-300 dark:text-gray-500">
                  {totalHours}h {totalMins}m
                </span>
              </div>

              {/* Ende */}
              <div className="text-center flex-1">
                <div className="text-[10px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                  Fertig
                </div>
                <div
                  className={`text-[14px] font-extrabold ${
                    mode === "end" ? "text-[#8B7355] dark:text-[#A0845C]" : "text-[#2D2D2D] dark:text-gray-100"
                  }`}
                >
                  {calculated?.endLabel || "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 px-7 pt-5 pb-7">
          <button
            onClick={onClose}
            className="flex-1 py-4 rounded-2xl text-[14px] font-bold text-gray-400 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
          >
            Abbrechen
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`flex-[1.5] py-4 rounded-2xl text-[14px] font-extrabold uppercase tracking-wide transition-all duration-300 ${
              canConfirm
                ? "bg-gradient-to-br from-[#8B7355] to-[#6B5740] dark:from-[#A0845C] dark:to-[#8B7355] text-white shadow-lg shadow-[#8B7355]/30 dark:shadow-[#A0845C]/30 hover:scale-[1.02] active:scale-[0.98]"
                : "bg-[#E8E2D8] dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
            }`}
          >
            Backplan starten
          </button>
        </div>
      </div>
    </div>
  );
}