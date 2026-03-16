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
  const hatSauerteig = content.includes("sauerteig") || content.includes("anstellgut") || content.includes("lievito madre");
  const hatHefe = /\b(hefe|trockenhefe|frischhefe|wildhefe)\b/.test(content);

  const getSauerteigLabel = (): { label: string; color: string } => {
    const st = "bg-[#FDE2E2] text-[#A23939] border-[#f5c5c5]";
    if (content.includes("roggensauerteig") || content.includes("roggen-sauerteig")) return { label: "Roggensauerteig", color: st };
    if (content.includes("dinkelsauerteig") || content.includes("dinkel-sauerteig")) return { label: "Dinkelsauerteig", color: st };
    if (content.includes("weizensauerteig") || content.includes("weizen-sauerteig")) return { label: "Weizensauerteig", color: st };
    if (content.includes("hafersauerteig") || content.includes("hafer-sauerteig")) return { label: "Hafersauerteig", color: st };
    if (content.includes("roggen")) return { label: "Roggensauerteig", color: st };
    if (content.includes("dinkel")) return { label: "Dinkelsauerteig", color: st };
    if (content.includes("weizenmehl") || content.includes("weizen")) return { label: "Weizensauerteig", color: st };
    if (content.includes("hafer")) return { label: "Hafersauerteig", color: st };
    return { label: "Sauerteig", color: st };
  };

  if (hatSauerteig && hatHefe) {
    labels.push({ label: "Gemischt", color: "bg-[#FDE2E2] text-[#A23939] border-[#f5c5c5]" });
  } else if (hatSauerteig) {
    labels.push(getSauerteigLabel());
  } else if (hatHefe) {
    labels.push({ label: "Hefe", color: "bg-[#FDE2E2] text-[#A23939] border-[#f5c5c5]" });
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

// Badge-Zeile: eine Zeile, überlaufende als +X
function BadgeRow({ labels }: { labels: { label: string; color: string }[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(labels.length);

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

  const hidden = labels.length - visibleCount;

  return (
    <div className="relative" style={{ height: '1.625rem' }}>
      {/* Messreihe: flex-wrap im Flow, aber unsichtbar */}
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
          <span key={i} className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap flex-shrink-0 ${tag.color}`}>
            {tag.label}
          </span>
        ))}
        {hidden > 0 && (
          <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600">
            +{hidden}
          </span>
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
          className="absolute top-3 right-3 z-10 p-2 bg-white/20 backdrop-blur-sm rounded-xl transition-transform hover:scale-110"
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
      <div className="px-4 pb-2 pt-3 flex-1 flex flex-col gap-2.5">

        {/* Badges eine Zeile + X */}
        <BadgeRow labels={labels} />

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5">
            <Clock size={13} className="text-[#8B7355] dark:text-[#A68B6A]" />
            {stats.timeString}
          </span>
          <span className="flex items-center gap-1.5">
            <Layers size={13} className="text-[#8B7355] dark:text-[#A68B6A]" />
            {stats.totalSteps} Schritte
          </span>
          {stats.hydration !== null && (
            <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400 font-bold ml-auto">
              <Droplets size={12} />
              {stats.hydration}%
            </span>
          )}
        </div>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-2 mt-auto">
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

        {/* Quelle */}
        {(() => {
          const url = recipe.original_source_url || recipe.source_url;
          try {
            return url ? (
              <div className="text-right">
                <span className="text-[10px] text-gray-300 dark:text-gray-600 font-medium">
                  {new URL(url).hostname.replace('www.', '')}
                </span>
              </div>
            ) : null;
          } catch { return null; }
        })()}
      </div>
    </Link>
  );
}