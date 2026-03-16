"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Clock, Layers, Utensils, Heart, Droplets } from 'lucide-react';
import { calcTotalDuration, calcTotalDurationRange } from "@/lib/backplan-utils";
import { calcHydration, FLOUR_KEYWORDS } from '@/lib/hydration';

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
  // Nur strukturierte Daten durchsuchen – NICHT description/title,
  // um falsche Treffer durch Fließtext zu vermeiden.
  const structuredContent = {
    dough_sections: recipe.dough_sections,
    tags: recipe.tags,
  };
  const content = JSON.stringify(structuredContent).toLowerCase();
  const labels: { label: string; color: string }[] = [];

  // --- 1. Triebmittel (always first) ---
  const hatSauerteig = content.includes("sauerteig") || content.includes("anstellgut") || content.includes("lievito madre");
  const hatHefe = /\b(hefe|trockenhefe|frischhefe|wildhefe)\b/.test(content);

  const getSauerteigLabel = (): { label: string; color: string } => {
    // Explicit compound terms first
    if (content.includes("roggensauerteig") || content.includes("roggen-sauerteig")) {
      return { label: "Roggensauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" };
    }
    if (content.includes("dinkelsauerteig") || content.includes("dinkel-sauerteig")) {
      return { label: "Dinkelsauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" };
    }
    if (content.includes("weizensauerteig") || content.includes("weizen-sauerteig")) {
      return { label: "Weizensauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" };
    }
    if (content.includes("hafersauerteig") || content.includes("hafer-sauerteig")) {
      return { label: "Hafersauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" };
    }
    // Infer from dominant grain in recipe
    if (content.includes("roggen")) {
      return { label: "Roggensauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" };
    }
    if (content.includes("dinkel")) {
      return { label: "Dinkelsauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" };
    }
    if (content.includes("weizenmehl") || content.includes("weizen")) {
      return { label: "Weizensauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" };
    }
    if (content.includes("hafer")) {
      return { label: "Hafersauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" };
    }
    // Fallback
    return { label: "Sauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" };
  };

  if (hatSauerteig && hatHefe) {
    labels.push({ label: "Gemischt", color: "bg-purple-50 text-purple-600 border-purple-100" });
  } else if (hatSauerteig) {
    labels.push(getSauerteigLabel());
  } else if (hatHefe) {
    labels.push({ label: "Hefe", color: "bg-blue-50 text-blue-600 border-blue-100" });
  }

  // --- 2. Urkorn ---
  const urkornBegriffe = ["emmer", "einkorn", "kamut", "khorasan", "urdinkel", "waldstaudenroggen", "urgerste"];
  if (urkornBegriffe.some(b => content.includes(b))) {
    labels.push({ label: "Urkorn", color: "bg-rose-50 text-rose-700 border-rose-200" });
  }

  // --- 3. Vollkorn ---
  const weizenTypen = ["405", "550", "812"];
  const dinkelTypen = ["630", "1050"];
  const roggenTypen = ["997", "1150", "1370"];
  const hatTypenMehl = [...weizenTypen, ...dinkelTypen, ...roggenTypen].some(t => content.includes(t));
  const hatVollkornBegriffe = content.includes("vollkorn") || content.includes("schrot");
  if (hatVollkornBegriffe && !hatTypenMehl) {
    labels.push({ label: "Reines Vollkorn", color: "bg-emerald-100 text-emerald-900 border-emerald-200" });
  } else if (hatVollkornBegriffe) {
    labels.push({ label: "Vollkorn-Anteil", color: "bg-emerald-50 text-emerald-700 border-emerald-100" });
  }

  // --- 4. Getreide (via Begriff + Mehltyp) ---
  const hatRoggen = content.includes("roggen") || roggenTypen.some(t => content.includes(t));
  const hatDinkel = content.includes("dinkel") || dinkelTypen.some(t => content.includes(t));
  const hatWeizen = content.includes("weizenmehl") || weizenTypen.some(t => content.includes(t));
  const hatHafer = content.includes("hafer");

  if (hatRoggen) {
    labels.push({ label: "Roggen", color: "bg-amber-100 text-amber-900 border-amber-200" });
  }
  if (hatDinkel) {
    labels.push({ label: "Dinkel", color: "bg-lime-100 text-lime-800 border-lime-200" });
  }
  if (hatWeizen) {
    labels.push({ label: "Weizen", color: "bg-yellow-50 text-yellow-700 border-yellow-200" });
  }
  if (hatHafer) {
    labels.push({ label: "Hafer", color: "bg-stone-100 text-stone-700 border-stone-200" });
  }

  return labels.slice(0, 3).sort((a, b) => b.label.length - a.label.length);
};

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
      <div className="h-64 overflow-hidden relative bg-gray-100 dark:bg-gray-700">
        <Image
          src={imageSrc}
          alt={recipe.title}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className={`object-cover transition-all duration-500 group-hover:scale-105 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImgLoaded(true)}
        />

        {/* Gradient oben */}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/65 to-transparent pointer-events-none" />

        {/* Gradient unten */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

        {/* Titel + Herz oben */}
        <div className="absolute top-0 inset-x-0 flex items-start justify-between gap-2 p-4 z-10">
          <h3 className="text-[15px] font-semibold text-white leading-snug drop-shadow line-clamp-2">
            {recipe.title}
          </h3>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(recipe.id, !recipe.is_favorite); }}
            className="flex-shrink-0 p-1.5 bg-white/15 backdrop-blur-sm rounded-xl transition-transform hover:scale-110"
          >
            <Heart size={18} className={`${recipe.is_favorite ? 'fill-red-500 text-red-500' : 'text-white/80'}`} />
          </button>
        </div>

        {/* Badges unten */}
        <div className="absolute bottom-0 inset-x-0 flex flex-wrap gap-1.5 p-3 z-10">
          {labels.map((tag, i) => (
            <span key={i} className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-sm border ${tag.color}`}>
              {tag.label}
            </span>
          ))}
        </div>
      </div>

      <div className="px-6 pb-2 pt-4 flex-1 flex flex-col">
        <div className="bg-[#F9F9F9] dark:bg-gray-900/40 rounded-2xl p-3 mb-6">
          <div className="flex flex-col gap-3 text-sm text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-[#8B7355] dark:text-[#A68B6A]" /> {stats.timeString}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Layers size={16} className="text-[#8B7355] dark:text-[#A68B6A]" /> {stats.totalSteps} Schritte
              </div>
              {stats.hydration !== null && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-500 dark:text-blue-400">
                  <Droplets size={13} />
                  {stats.hydration}%
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-auto">
          <div className="flex items-center justify-center gap-2 py-2.5 bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 rounded-xl text-xs font-bold border border-gray-100 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <Utensils size={14} /> Details
          </div>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlan(recipe); }}
            className="flex items-center justify-center gap-2 py-2.5 bg-[#8B7355]/10 dark:bg-[#8B7355]/20 text-[#8B7355] dark:text-[#C4A484] rounded-xl text-xs font-bold border border-[#8B7355]/20 dark:border-[#8B7355]/30 hover:bg-[#8B7355] hover:text-white transition-all"
          >
            <Clock size={14} /> Planen
          </button>
        </div>
        {(() => {
          const url = recipe.original_source_url || recipe.source_url;
          try {
            return (
              <div className="text-right mt-2 mb-2 h-4">
                {url ? (
                  <span className="text-[10px] text-gray-300 dark:text-gray-600 font-medium">
                    {new URL(url).hostname.replace('www.', '')}
                  </span>
                ) : null}
              </div>
            );
          } catch { return <div className="mt-2 mb-2 h-4" />; }
        })()}
      </div>
    </Link>
  );
}