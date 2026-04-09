"use client";

import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Clock, Layers, Utensils, Heart, Droplets } from 'lucide-react';
import { calcTotalDurationRange } from "@/lib/backplan-utils";
import { calcHydration } from '@/lib/hydration';
import { getCategoryStyle, getHydrationColor } from '@/lib/category-colors';

interface RecipeCardProps {
  recipe: any;
  onToggleFavorite: (id: number, status: boolean) => void;
  onPlan: (recipe: any) => void;
}

const getStats = (recipe: any) => {
  const { min, max } = calcTotalDurationRange(recipe.dough_sections || []);
  const fmt = (mins: number) => { const h = Math.floor(mins / 60), m = mins % 60; return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`; };
  const timeString = min !== max ? `${fmt(min)} – ${fmt(max)}` : fmt(min);
  const totalSteps = (recipe.dough_sections || []).reduce((s: number, sec: any) => s + (sec.steps?.length || 0), 0);
  const hydration = calcHydration(recipe.dough_sections || []);
  return { timeString, totalSteps, hydration };
};

const getRecipeLabels = (recipe: any) => {
  const content = JSON.stringify({ dough_sections: recipe.dough_sections, tags: recipe.tags }).toLowerCase();
  const labels: { label: string; color: string }[] = [];
  const hatLM = content.includes("lievito madre");
  const hatSauerteig = content.includes("sauerteig") || content.includes("anstellgut") || hatLM;
  const hatHefe = /\b(hefe|trockenhefe|frischhefe|wildhefe)\b/.test(content);
  const st = "bg-[#FDE2E2] text-[#A23939] border-[#f5c5c5]";
  const allIngredients = (recipe.dough_sections || []).flatMap((s: any) => s.ingredients || []);
  const anstellgutZutat = allIngredients.find((ing: any) => /anstellgut|starter|lievito/.test((ing.name || "").toLowerCase()));
  const anstellgutName = (anstellgutZutat?.name || "").toLowerCase();
  const getSauerteigLabel = (): { label: string; color: string } => {
    if (hatLM) return { label: "Lievito Madre", color: st };
    if (anstellgutName) {
      if (anstellgutName.includes("roggen")) return { label: "Roggensauerteig", color: st };
      if (anstellgutName.includes("dinkel")) return { label: "Dinkelsauerteig", color: st };
      if (anstellgutName.includes("weizen")) return { label: "Weizensauerteig", color: st };
      if (anstellgutName.includes("hafer")) return { label: "Hafersauerteig", color: st };
    }
    if (content.includes("roggensauerteig")) return { label: "Roggensauerteig", color: st };
    if (content.includes("dinkelsauerteig")) return { label: "Dinkelsauerteig", color: st };
    if (content.includes("weizensauerteig")) return { label: "Weizensauerteig", color: st };
    if (content.includes("hafersauerteig")) return { label: "Hafersauerteig", color: st };
    return { label: "Sauerteig", color: st };
  };
  if (hatSauerteig && hatHefe) { const stLabel = getSauerteigLabel(); labels.push({ label: `${stLabel.label} + Hefe`, color: st }); }
  else if (hatSauerteig) labels.push(getSauerteigLabel());
  else if (hatHefe) labels.push({ label: "Hefe", color: st });
  const urkornBegriffe = ["emmer","einkorn","kamut","khorasan","urdinkel","waldstaudenroggen","urgerste"];
  if (urkornBegriffe.some(b => content.includes(b))) labels.push({ label: "Urkorn", color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });
  const weizenTypen = ["405","550","812"], dinkelTypen = ["630","1050"], roggenTypen = ["997","1150","1370"];
  const hatTypenMehl = [...weizenTypen,...dinkelTypen,...roggenTypen].some(t => content.includes(t));
  const hatVollkorn = content.includes("vollkorn") || content.includes("schrot");
  if (hatVollkorn && !hatTypenMehl) labels.push({ label: "Reines Vollkorn", color: "bg-[#E1F2E5] text-[#2D5A39] border-[#b6d9be]" });
  else if (hatVollkorn) labels.push({ label: "Vollkorn-Anteil", color: "bg-[#E1F2E5] text-[#2D5A39] border-[#b6d9be]" });
  const hatRoggen = content.includes("roggen") || roggenTypen.some(t => content.includes(t));
  const hatDinkel = content.includes("dinkel") || dinkelTypen.some(t => content.includes(t));
  const hatWeizen = content.includes("weizenmehl") || weizenTypen.some(t => content.includes(t)) || /mehl typ 0{1,2}\b|tipo 0{1,2}\b/.test(content);
  const hatHafer = content.includes("hafer");
  if (hatRoggen) labels.push({ label: "Roggen", color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });
  if (hatDinkel) labels.push({ label: "Dinkel", color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });
  if (hatWeizen) labels.push({ label: "Weizen", color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });
  if (hatHafer) labels.push({ label: "Hafer", color: "bg-[#E2E8F0] text-[#475569] border-[#cbd5e1]" });
  return labels;
};

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
      for (const child of children) { if (child.offsetTop === firstTop) count++; else break; }
      if (count < labels.length && count > 0) { const lv = children[count - 1]; if (lv.offsetLeft + lv.offsetWidth + 6 + 42 > row.offsetWidth) count = Math.max(1, count - 1); }
      setVisibleCount(Math.max(1, count));
    });
  }, [labels.length]);
  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => { const ro = new ResizeObserver(measure); if (rowRef.current) ro.observe(rowRef.current); return () => ro.disconnect(); }, [measure]);
  const hidden = labels.length - visibleCount;
  return (
    <div className="relative" style={{ height: '1.625rem' }}>
      <div ref={rowRef} className="flex flex-wrap gap-1.5 absolute inset-x-0 top-0" style={{ visibility: 'hidden', pointerEvents: 'none' }}>
        {labels.map((tag, i) => <span key={i} data-badge className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap ${tag.color}`}>{tag.label}</span>)}
      </div>
      <div className="flex gap-1.5 absolute inset-x-0 top-0">
        {labels.slice(0, visibleCount).map((tag, i) => <span key={i} className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap flex-shrink-0 ${tag.color}`}>{tag.label}</span>)}
        {hidden > 0 && <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border whitespace-nowrap flex-shrink-0 inline-flex items-center bg-[#EDE5D6] dark:bg-gray-700 text-[#A68B6A] dark:text-gray-400 border-[#D6C9B4] dark:border-gray-600">+{hidden}</span>}
      </div>
    </div>
  );
}

function getSourceHostname(recipe: any): string | null {
  const url = recipe.original_source_url || recipe.source_url;
  if (!url) return null;
  try { return new URL(url).hostname.replace('www.', ''); } catch { return null; }
}

export default function RecipeCard({ recipe, onToggleFavorite, onPlan }: RecipeCardProps) {
  const stats = getStats(recipe);
  const labels = getRecipeLabels(recipe);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imageSrc = recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=800&auto=format&fit=crop';
  const catStyle = getCategoryStyle(recipe.category);
  const hydrationColor = stats.hydration !== null ? getHydrationColor(stats.hydration) : null;
  const sourceHost = getSourceHostname(recipe);
  const subtitleParts: string[] = [];
  if (catStyle) subtitleParts.push(catStyle.label);
  if (sourceHost) subtitleParts.push(sourceHost);
  const subtitle = subtitleParts.join(' · ');

  return (
    <Link
      href={`/recipes/${recipe.id}`}
      className="rounded-2xl overflow-hidden flex flex-col relative border transition-all duration-300 hover:shadow-md group active:scale-[0.98]"
      style={{
        borderLeft: catStyle ? `3px solid ${catStyle.borderColor}` : undefined,
        borderColor: undefined,
      }}
    >
      <div className="bg-white dark:bg-gray-800 border border-[#D6C9B4] dark:border-gray-700 rounded-2xl overflow-hidden flex flex-col flex-1 hover:border-[#8B7355]/30 dark:hover:border-gray-600 transition-colors">

        {/* Bild */}
        <div className="h-56 overflow-hidden relative rounded-b-2xl bg-[#EDE5D6] dark:bg-gray-700">
          <Image src={imageSrc} alt={recipe.title} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className={`object-cover transition-all duration-500 group-hover:scale-105 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImgLoaded(true)} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent pointer-events-none" />
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(recipe.id, !recipe.is_favorite); }}
            className="absolute top-3 right-3 z-10 p-2 bg-white/35 backdrop-blur-sm rounded-xl transition-transform hover:scale-110">
            <Heart size={16} className={recipe.is_favorite ? 'fill-red-500 text-red-500' : 'text-white/80'} />
          </button>
          <div className="absolute bottom-0 inset-x-0 z-10 px-4 pb-4">
            <h3 className="text-xl font-black text-white leading-tight line-clamp-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]">{recipe.title}</h3>
          </div>
        </div>

        {/* Card Body */}
        <div className="px-4 pb-4 pt-3 flex-1 flex flex-col gap-3">
          {subtitle && (
            <p className="text-[11px] font-medium leading-none -mb-1">
              <span className="dark:hidden" style={{ color: catStyle ? catStyle.textLight : '#A68B6A' }}>{subtitle}</span>
              <span className="hidden dark:inline" style={{ color: catStyle ? catStyle.textDark : '#C4A484' }}>{subtitle}</span>
            </p>
          )}

          <BadgeRow labels={labels} />

          {/* Stats Bar */}
          <div className="flex items-center bg-[#F5F0E8] dark:bg-white/[0.04] rounded-xl px-2 py-2">
            <div className="flex items-center justify-center gap-1.5 flex-[2] min-w-0">
              <Clock size={14} className="text-[#8B7355] flex-shrink-0" />
              <span className="text-[13px] font-medium text-[#5C3D1E] dark:text-gray-200 leading-none truncate">{stats.timeString}</span>
            </div>
            <div className="w-px self-center h-3.5 bg-[#D6C9B4] dark:bg-white/20 flex-shrink-0" />
            <div className="flex items-center justify-center gap-1.5 flex-1 min-w-0">
              <Layers size={14} className="text-[#8B7355] flex-shrink-0" />
              <span className="text-[13px] font-medium text-[#5C3D1E] dark:text-gray-200 leading-none">{stats.totalSteps}</span>
            </div>
            {stats.hydration !== null && hydrationColor && (
              <>
                <div className="w-px self-center h-3.5 bg-[#D6C9B4] dark:bg-white/20 flex-shrink-0" />
                <div className="flex items-center justify-center gap-1.5 flex-1 min-w-0">
                  <Droplets size={14} className="flex-shrink-0 dark:hidden" style={{ color: hydrationColor.light }} />
                  <Droplets size={14} className="flex-shrink-0 hidden dark:block" style={{ color: hydrationColor.dark }} />
                  <span className="text-[13px] font-bold leading-none dark:hidden" style={{ color: hydrationColor.light }}>{stats.hydration}%</span>
                  <span className="text-[13px] font-bold leading-none hidden dark:inline" style={{ color: hydrationColor.dark }}>{stats.hydration}%</span>
                </div>
              </>
            )}
          </div>

          {/* Buttons */}
          <div className="grid grid-cols-2 gap-4 mt-auto">
            <div className="flex items-center justify-center gap-2 py-2.5 bg-[#EDE5D6] dark:bg-gray-700/50 text-[#5C3D1E] dark:text-gray-300 rounded-xl text-xs font-bold border border-[#D6C9B4] dark:border-gray-600 hover:bg-[#D6C9B4] dark:hover:bg-gray-700 transition-colors">
              <Utensils size={13} /> Details
            </div>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlan(recipe); }}
              className="flex items-center justify-center gap-2 py-2.5 bg-[#8B7355]/10 dark:bg-[#C4A484]/10 text-[#8B7355] dark:text-[#C4A484] rounded-xl text-xs font-bold border border-[#8B7355]/25 dark:border-[#C4A484]/25 hover:bg-[#8B7355] hover:text-white dark:hover:bg-[#C4A484]/25 transition-all"
            >
              <Clock size={13} /> Planen
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}
