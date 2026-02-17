"use client";

import React from 'react';
import Link from 'next/link';
import { Clock, Layers, Utensils, Heart } from 'lucide-react';

interface RecipeCardProps {
  recipe: any;
  onToggleFavorite: (id: number, status: boolean) => void;
  onPlan: (recipe: any) => void;
}

const getStats = (recipe: any) => {
  let maxParallelDuration = 0;
  let sequentialDuration = 0;
  let totalSteps = 0;

  if (recipe.dough_sections && Array.isArray(recipe.dough_sections)) {
    recipe.dough_sections.forEach((section: any) => {
      totalSteps += (section.steps?.length || 0);
      let sectionDuration = 0;
      section.steps?.forEach((step: any) => {
        const d = parseInt(String(step.duration));
        if (!isNaN(d)) sectionDuration += d;
      });

      if (section.is_parallel) {
        maxParallelDuration = Math.max(maxParallelDuration, sectionDuration);
      } else {
        sequentialDuration += sectionDuration;
      }
    });
  }

  const totalMinutes = maxParallelDuration + sequentialDuration;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const timeString = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return { timeString, totalSteps };
};

const getRecipeLabels = (recipe: any) => {
  const content = JSON.stringify(recipe).toLowerCase();
  const labels = [];

  const hatSauerteig = content.includes("sauerteig") || content.includes("anstellgut") || content.includes("lievito madre");
  const hatHefe = content.includes("hefe");

  if (hatSauerteig && hatHefe) {
    labels.push({ label: "Gemischt", color: "bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 border-purple-100 dark:border-purple-800" });
  } else if (hatSauerteig) {
    labels.push({ label: "Sauerteig", color: "bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-300 border-orange-100 dark:border-orange-800" });
  } else if (hatHefe) {
    labels.push({ label: "Hefe", color: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 border-blue-100 dark:border-blue-800" });
  }

  const hatVollkornBegriffe = content.includes("vollkorn") || content.includes("schrot");
  const typenMehle = ["405", "550", "610", "630", "812", "997", "1050", "1150", "1200", "1370"];
  const hatTypenMehl = typenMehle.some(type => content.includes(type));

  if (hatVollkornBegriffe && !hatTypenMehl) {
    labels.push({ label: "Reines Vollkorn", color: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800" });
  } else if (hatVollkornBegriffe) {
    labels.push({ label: "Vollkorn-Anteil", color: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-800" });
  }

  if (content.includes("roggen")) {
    labels.push({ label: "Roggen", color: "bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800" });
  }

  if (labels.length === 0) {
    labels.push({ label: "Brot", color: "bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-300 border-gray-100 dark:border-gray-600" });
  }

  return labels;
};

export default function RecipeCard({ recipe, onToggleFavorite, onPlan }: RecipeCardProps) {
  const stats = getStats(recipe);
  const labels = getRecipeLabels(recipe);

  return (
    <Link 
      href={`/recipes/${recipe.id}`}
      className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden flex flex-col relative border border-gray-100 dark:border-gray-700 shadow-sm transition-all duration-300 hover:shadow-md hover:border-gray-200 dark:hover:border-gray-600 group active:scale-[0.98]"
    >
      <button 
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(recipe.id, !recipe.is_favorite);
        }}
        className="absolute top-4 right-4 z-20 p-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 transition-transform hover:scale-110"
      >
        <Heart 
          size={18} 
          className={`${recipe.is_favorite ? 'fill-red-500 text-red-500' : 'text-gray-400 dark:text-gray-500'}`} 
        />
      </button>

      <div className="h-64 overflow-hidden relative rounded-b-2xl">
        <img 
          src={recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=800&auto=format&fit=crop'} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
          alt={recipe.title} 
        />
        
        <div className="absolute top-6 left-6 flex flex-wrap gap-2 pr-6">
          {labels.map((tag, i) => (
            <span 
              key={i} 
              className={`backdrop-blur-md px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-sm border ${tag.color}`}
            >
              {tag.label}
            </span>
          ))}
        </div>
      </div>

      <div className="px-6 pb-6 pt-2 flex-1 flex flex-col">
        <h3 className="text-xl font-bold mb-0 mt-4 text-gray-800 dark:text-gray-100 tracking-tight line-clamp-2 min-h-[3.5rem]">
          {recipe.title}
        </h3>
        
        <div className="bg-[#F9F9F9] dark:bg-gray-900/40 rounded-2xl p-3 mb-6">
          <div className="flex flex-col gap-3 text-sm text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-[#8B7355] dark:text-[#A68B6A]" /> {stats.timeString}
            </div>
            <div className="flex items-center gap-3">
              <Layers size={16} className="text-[#8B7355] dark:text-[#A68B6A]" /> {stats.totalSteps} Schritte
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-auto">
          <div className="flex items-center justify-center gap-2 py-2.5 bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 rounded-xl text-xs font-bold border border-gray-100 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <Utensils size={14} /> Details
          </div>
          <button 
            onClick={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              onPlan(recipe); 
            }} 
            className="flex items-center justify-center gap-2 py-2.5 bg-[#8B7355]/10 dark:bg-[#8B7355]/20 text-[#8B7355] dark:text-[#C4A484] rounded-xl text-xs font-bold border border-[#8B7355]/20 dark:border-[#8B7355]/30 hover:bg-[#8B7355] hover:text-white transition-all"
          >
            <Clock size={14} /> Planen
          </button>
        </div>
      </div>
    </Link>
  );
}