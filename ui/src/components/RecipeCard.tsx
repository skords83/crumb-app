"use client";

import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Clock, Layers, Utensils, Heart, Droplets } from 'lucide-react';
import { calcTotalDurationRange } from "@/lib/backplan-utils";
import { calcHydration } from '@/lib/hydration';

interface RecipeCardProps {
  recipe: any;
  onToggleFavorite: (id: number, status: boolean) => void;
  onPlan: (recipe: any) => void;
}

const getStats = (recipe: any) => {
  const { min, max } = calcTotalDurationRange(recipe.dough_sections || []);
  const fmt = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  };
  const timeString = min !== max ? `${fmt(min)} – ${fmt(max)}` : fmt(min);
  const totalSteps = (recipe.dough_sections || []).reduce(
    (s: number, sec: any) => s + (sec.steps?.length || 0), 0
  );
  const hydration = calcHydration(recipe.dough_sections || []);
  return { timeString, totalSteps, hydration };
};

const getRecipeLabels = (recipe: any) => {
  const structuredContent = {
    dough_sections: recipe.dough_sections,
    tags: recipe.tags,
  };
  const content = JSON.stringify(structuredContent).toLowerCase();
  const labels: { label: string; color: string }[] = [];

  // --- 1. Triebmittel ---
  const hatLM = content.includes("lievito madre");
  const hatSauerteig = content.includes("sauerteig") || content.includes("anstellgut") || hatLM;
  const hatHefe = /\b(hefe|trockenhefe|frischhefe|wildhefe)\b/.test(content);

  const st = "bg-[#FDE2E2] text-[#A23939] border-[#f5c5c5]";

  // Nur der Inhalt von Sauerteig/Anstellgut-Phasen entscheidet über den Typ —
  // nicht das Mehl im Hauptteig (z.B. Hafer im Hauptteig ≠ Hafersauerteig).
  const starterSections = (recipe.dough_sections || []).filter((s: any) => {
    const n = (s.name || "").toLowerCase();
    return n.includes("sauerteig") || n.includes("anstellgut") || n.includes("lievito") || n.includes("starter");
  });
  // Wenn keine explizite Starter-Phase gefunden: Fallback auf Anstellgut-Zutaten im Gesamtcontent
  const starterContent = starterSections.length > 0
    ? JSON.stringify(starterSections).toLowerCase()
    : (() => {
        // Alle Zutaten-Namen durchsuchen die explizit auf Anstellgut hinweisen
        const allIngredients = (recipe.dough_sections || []).flatMap((s: any) => s.ingredients || []);
        const starterIngs = allIngredients.filter((ing: any) =>
          /anstellgut|starter|sauerteig|lievito/.test((ing.name || "").toLowerCase())
        );
        return JSON.stringify(starterIngs).toLowerCase();
      })();

  const getSauerteigLabel = (): { label: string; color: string } => {
    // Lievito Madre hat Vorrang
    if (hatLM) return { label: "Lievito Madre", color: st };
    // Explizite Sauerteig-Typ-Namen im Gesamtcontent (Rezepttitel, Phasennamen etc.)
    if (content.includes("roggensauerteig") || content.includes("roggen-sauerteig")) return { label: "Roggensauerteig", color: st };
    if (content.includes("dinkelsauerteig") || content.includes("dinkel-sauerteig")) return { label: "Dinkelsauerteig", color: st };
    if (content.includes("weizensauerteig") || content.includes("weizen-sauerteig")) return { label: "Weizensauerteig", color: st };
    if (content.includes("hafersauerteig") || content.includes("hafer-sauerteig")) return { label: "Hafersauerteig", color: st };
    // Mehl-Heuristik: NUR im Starter-Content, nicht im Gesamtrezept
    if (starterContent.includes("roggen")) return { label: "Roggensauerteig", color: st };
    if (starterContent.includes("dinkel")) return { label: "Dinkelsauerteig", color: st };
    if (starterContent.includes("weizenmehl") || starterContent.includes("weizen")) return { label: "Weizensauerteig", color: st };
    if (starterContent.includes("hafer")) return { label: "Hafersauerteig", color: st };
    return { label: "Sauerteig", color: st };
  };

  if (hatSauerteig && hatHefe) {
    // Sauerteig-Typ bestimmen, dann "+ Hefe" anhängen
    const stLabel = getSauerteigLabel();
    labels.push({ label: `${stLabel.label} + Hefe`, color: st });
  } else if (hatSauerteig) {
    labels.push(getSauerteigLabel());
  } else if (hatHefe) {
    labels.push({ label: "Hefe", color: st });
  }

  // --- 2. Urkorn ---
  const urkornBegriffe = ["emmer", "einkorn", "kamut", "khorasan", "urdinkel", "waldstaudenroggen", "urgerste"];
  if (urkornBegriffe.some(b => content.includes(b))) {
    labels.push({ label: "Urkorn", color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });
  }

  // --- 3. Vollkorn ---
  const weizenTypen = ["405", "550", "812"];
  const dinkelTypen = ["630", "1050"];
  const roggenTypen = ["997", "1150", "1370"];
  const hatTypenMehl = [...weizenTypen, ...dinkelTypen, ...roggenTypen].some(t => content.includes(t));
  const hatVollkornBegriffe = content.includes("vollkorn") || content.includes("schrot");
  if (hatVollkornBegriffe && !hatTypenMehl) {
    labels.push({ label: "Reines Vollkorn", color: "bg-[#E1F2E5] text-[#2D5A39] border-[#b6d9be]" });
  } else if (hatVollkornBegriffe) {
    labels.push({ label: "Vollkorn-Anteil", color: "bg-[#E1F2E5] text-[#2D5A39] border-[#b6d9be]" });
  }

  // --- 4. Getreide ---
  const hatRoggen = content.includes("roggen") || roggenTypen.some(t => content.includes(t));
  const hatDinkel = content.includes("dinkel") || dinkelTypen.some(t => content.includes(t));
  const hatWeizen = content.includes("weizenmehl") || weizenTypen.some(t => content.includes(t));
  const hatHafer = content.includes("hafer");

  if (hatRoggen) labels.push({ label: "Roggen",  color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });
  if (hatDinkel) labels.push({ label: "Dinkel",  color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });
  if (hatWeizen) labels.push({ label: "Weizen",  color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });
  if (hatHafer)  labels.push({ label: "Hafer",   color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });

  return labels;
};

// Badge-Zeile: eine Zeile, überlaufende als +X mit Tooltip
function BadgeRow({ labels }: { labels: { label: string; color: string }[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(labels.length);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    requestAnimationFrame(() => {
      const row = rowRef.current;
      if (!row || labels.length === 0) return;
      const children = Array.from(row.querySelectorAll('[data-badge]')) as HTMLElement[];
      if (children.length === 0) return;
      const firstTop = children[0].offsetTop;
      let count = 0;
      for (const child of children) {
        if (child.offsetTop === firstTop) count++;
        else break;
      }
      if (count < labels.length && count > 0) {
        const containerWidth = row.offsetWidth;
        const lastVisible = children[count - 1];
        const usedWidth = lastVisible.offsetLeft + lastVisible.offsetWidth;
        const plusWidth = 42;
        const gap = 6;
        if (usedWidth + gap + plusWidth > containerWidth) {
          count = Math.max(1, count - 1);
        }
      }
      setVisibleCount(Math.max(1, count));
    });
  }, [labels.length]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (rowRef.current) ro.observe(rowRef.current);
    return () => ro.disconnect();
  }, [measure]);

  // Tooltip schließen bei Klick außerhalb
  useEffect(() => {
    if (!tooltipOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setTooltipOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [tooltipOpen]);

  const hidden = labels.length - visibleCount;
  const hiddenLabels = labels.slice(visibleCount);

  return (
    <div className="relative" style={{ height: '1.625rem' }}>
      {/* Messreihe: unsichtbar für Layout-Berechnung */}
      <div
        ref={rowRef}
        className="flex flex-wrap gap-1.5 absolute inset-x-0 top-0"
        style={{ visibility: 'hidden', pointerEvents: 'none' }}
      >
        {labels.map((tag, i) => (
          <span
            key={i}
            data-badge
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap ${tag.color}`}
          >
            {tag.label}
          </span>
        ))}
      </div>

      {/* Sichtbare Badges */}
      <div className="flex gap-1.5 absolute inset-x-0 top-0">
        {labels.slice(0, visibleCount).map((tag, i) => (
          <span
            key={i}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap flex-shrink-0 ${tag.color}`}
          >
            {tag.label}
          </span>
        ))}

        {hidden > 0 && (
          <div ref={tooltipRef} className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTooltipOpen(o => !o); }}
              onMouseEnter={() => setTooltipOpen(true)}
              onMouseLeave={() => setTooltipOpen(false)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              +{hidden}
            </button>

            {tooltipOpen && (
              <div
                className="absolute bottom-full left-0 mb-2 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg p-2 flex flex-col gap-1.5 min-w-max"
                onMouseEnter={() => setTooltipOpen(true)}
                onMouseLeave={() => setTooltipOpen(false)}
              >
                {hiddenLabels.map((tag, i) => (
                  <span
                    key={i}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap ${tag.color}`}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RecipeCard({ recipe, onToggleFavorite, onPlan }: RecipeCardProps) {
  const stats = getStats(recipe);
  const labels = getRecipeLabels(recipe);
  const [imgLoaded, setImgLoaded] = useState(false);

  const imageSrc = recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=800&auto=format&fit=crop';

  return (
    <Link
      href={`/recipes/${recipe.id}`}
      className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden flex flex-col relative border border-gray-100 dark:border-gray-700 shadow-sm transition-all duration-300 hover:shadow-md hover:border-gray-200 dark:hover:border-gray-600 group active:scale-[0.98]"
    >
      {/* Bild mit Titel-Overlay */}
      <div className="h-56 overflow-hidden relative rounded-b-2xl bg-gray-100 dark:bg-gray-700">
        <Image
          src={imageSrc}
          alt={recipe.title}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className={`object-cover transition-all duration-500 group-hover:scale-105 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImgLoaded(true)}
        />

        {/* Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent pointer-events-none" />

        {/* Herz oben rechts */}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(recipe.id, !recipe.is_favorite); }}
          className="absolute top-3 right-3 z-10 p-2 bg-white/35 backdrop-blur-sm rounded-xl transition-transform hover:scale-110"
        >
          <Heart size={16} className={`${recipe.is_favorite ? 'fill-red-500 text-red-500' : 'text-white/80'}`} />
        </button>

        {/* Titel unten im Bild */}
        <div className="absolute bottom-0 inset-x-0 z-10 px-4 pb-4">
          <h3 className="text-xl font-black text-white leading-tight line-clamp-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
            {recipe.title}
          </h3>
        </div>
      </div>

      {/* Card Body */}
      <div className="px-4 pb-0 pt-3 flex-1 flex flex-col gap-3">

        {/* Badges eine Zeile + X mit Tooltip */}
        <BadgeRow labels={labels} />

        {/* Stats Bar — Variant D */}
        <div className="flex items-center bg-gray-50 dark:bg-white/[0.04] rounded-xl px-2 py-2">
          <div className="flex items-center justify-center gap-1.5 flex-[2] min-w-0">
            <Clock size={14} className="text-[#8B7355] dark:text-[#A68B6A] flex-shrink-0" />
            <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200 leading-none truncate">{stats.timeString}</span>
          </div>
          <div className="w-px self-center h-3.5 bg-gray-300 dark:bg-white/20 flex-shrink-0" />
          <div className="flex items-center justify-center gap-1.5 flex-1 min-w-0">
            <Layers size={14} className="text-[#8B7355] dark:text-[#A68B6A] flex-shrink-0" />
            <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200 leading-none">{stats.totalSteps}</span>
          </div>
          {stats.hydration !== null && (
            <>
              <div className="w-px self-center h-3.5 bg-gray-300 dark:bg-white/20 flex-shrink-0" />
              <div className="flex items-center justify-center gap-1.5 flex-1 min-w-0">
                <Droplets size={14} className="text-blue-500 dark:text-blue-400 flex-shrink-0" />
                <span className="text-[13px] font-bold text-blue-500 dark:text-blue-400 leading-none">{stats.hydration}%</span>
              </div>
            </>
          )}
        </div>

        {/* Buttons — gap = px-4 für Symmetrie */}
        <div className="grid grid-cols-2 gap-4 mt-auto">
          <div className="flex items-center justify-center gap-2 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 rounded-xl text-xs font-bold border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
            <Utensils size={13} /> Details
          </div>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlan(recipe); }}
            className="flex items-center justify-center gap-2 py-2.5 bg-[#8B7355]/15 dark:bg-[#8B7355]/25 text-[#6B5340] dark:text-[#C4A484] rounded-xl text-xs font-bold border border-[#8B7355]/30 dark:border-[#8B7355]/40 hover:bg-[#8B7355] hover:text-white transition-all"
          >
            <Clock size={13} /> Planen
          </button>
        </div>

        {/* Quelle — feste Höhe damit Buttons nicht rutschen */}
        <div className="text-right h-5 flex items-center justify-end pb-1">
          {(() => {
            const url = recipe.original_source_url || recipe.source_url;
            try {
              return url ? (
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                  {new URL(url).hostname.replace('www.', '')}
                </span>
              ) : null;
            } catch { return null; }
          })()}
        </div>
      </div>
    </Link>
  );
}