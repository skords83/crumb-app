"use client";

import React from 'react';
import Link from 'next/link';
import { Clock, Layers, Utensils, Heart } from 'lucide-react';

interface RecipeCardProps {
  recipe: any;
  onToggleFavorite: (id: number, status: boolean) => void;
  onPlan: (recipe: any) => void;
}

// Hilfsfunktion für Zeit und Schritte
const getStats = (recipe: any) => {
  let maxParallelDuration = 0;
  let sequentialDuration = 0;
  let totalSteps = 0;

  if (recipe.dough_sections && Array.isArray(recipe.dough_sections)) {
    recipe.dough_sections.forEach((section: any) => {
      totalSteps += (section.steps?.length || 0);
      
      // Berechne die Dauer dieser einzelnen Sektion
      let sectionDuration = 0;
      section.steps?.forEach((step: any) => {
        const d = parseInt(String(step.duration));
        if (!isNaN(d)) sectionDuration += d;
      });

      // Logik für parallele vs. sequentielle Phasen
      if (section.is_parallel) {
        // Von allen parallelen Phasen zählt nur die zeitlich längste für die Gesamtzeit
        maxParallelDuration = Math.max(maxParallelDuration, sectionDuration);
      } else {
        // Hauptteig, Backen etc. werden immer addiert
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

// Hilfsfunktion für den Typ-Tag
const getRecipeLabels = (recipe: any) => {
  const content = JSON.stringify(recipe).toLowerCase();
  const labels = [];

  // 1. Basis-Typ (Hefe / Sauerteig / Gemischt)
  const hatSauerteig = content.includes("sauerteig") || content.includes("anstellgut") || content.includes("lievito madre");
  const hatHefe = content.includes("hefe");

  if (hatSauerteig && hatHefe) {
    labels.push({ label: "Gemischt", color: "bg-purple-50 text-purple-600 border-purple-100" });
  } else if (hatSauerteig) {
    labels.push({ label: "Sauerteig", color: "bg-orange-50 text-orange-600 border-orange-100" });
  } else if (hatHefe) {
    labels.push({ label: "Hefe", color: "bg-blue-50 text-blue-600 border-blue-100" });
  }

  // 2. Die Mehl-Analyse (Vollkorn Check)
  const hatVollkornBegriffe = content.includes("vollkorn") || content.includes("schrot");
  
  // Deine Liste der "Störfaktoren" (Typenmehle)
  const typenMehle = ["405", "550", "610", "630", "812", "997", "1050", "1150", "1200", "1370"];
  const hatTypenMehl = typenMehle.some(type => content.includes(type));

  if (hatVollkornBegriffe && !hatTypenMehl) {
    labels.push({ label: "Reines Vollkorn", color: "bg-emerald-100 text-emerald-900 border-emerald-200" });
  } else if (hatVollkornBegriffe) {
    labels.push({ label: "Vollkorn-Anteil", color: "bg-emerald-50 text-emerald-700 border-emerald-100" });
  }

  // 3. Roggen Check
  if (content.includes("roggen")) {
    labels.push({ label: "Roggen", color: "bg-amber-100 text-amber-900 border-amber-200" });
  }

  if (labels.length === 0) {
    labels.push({ label: "Brot", color: "bg-gray-50 text-gray-500 border-gray-100" });
  }

  return labels;
};

export default function RecipeCard({ recipe, onToggleFavorite, onPlan }: RecipeCardProps) {
  const stats = getStats(recipe);
  const labels = getRecipeLabels(recipe);

  return (
    <Link 
      href={`/recipes/${recipe.id}`}
      className="bg-white rounded-2xl overflow-hidden flex flex-col relative border border-gray-100 shadow-sm transition-all duration-300 hover:shadow-md hover:border-gray-200 group active:scale-[0.98]"
    >
      {/* Favorit Button */}
      <button 
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(recipe.id, !recipe.is_favorite);
        }}
        className="absolute top-4 right-4 z-20 p-2 bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-100 transition-transform hover:scale-110"
      >
        <Heart 
          size={18} 
          className={`${recipe.is_favorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} 
        />
      </button>

{/* Bild-Bereich mit Mehrfach-Labels */}
<div className="h-64 overflow-hidden relative rounded-b-2xl"> {/* Rundung unten hinzugefügt */}
  <img 
    src={recipe.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=800&auto=format&fit=crop'} 
    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
    alt={recipe.title} 
  />
  
  {/* Labels */}
  <div className="absolute top-6 left-6 flex flex-wrap gap-2 pr-6">
    {labels.map((tag, i) => (
      <span 
        key={i} 
        className={`backdrop-blur-sm px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-sm border ${tag.color}`}
      >
        {tag.label}
      </span>
    ))}
  </div>
</div>

      {/* Inhalt */}
      <div className="px-6 pb-6 pt-2 flex-1 flex flex-col">
        <h3 className="text-xl font-bold mb-0 mt-4 text-gray-800 tracking-tight line-clamp-2 min-h-[3.5rem]">
          {recipe.title}
        </h3>
        
        <div className="bg-[#F9F9F9] rounded-2xl p-3 mb-6">
          <div className="flex flex-col gap-3 text-sm text-gray-500">
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-[#8B7355]" /> {stats.timeString}
            </div>
            <div className="flex items-center gap-3">
              <Layers size={16} className="text-[#8B7355]" /> {stats.totalSteps} Schritte
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-auto">
          <div className="flex items-center justify-center gap-2 py-2.5 bg-gray-50 text-gray-600 rounded-xl text-xs font-bold border border-gray-100 hover:bg-gray-100 transition-colors">
            <Utensils size={14} /> Details
          </div>
          <button 
            onClick={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              onPlan(recipe); 
            }} 
            className="flex items-center justify-center gap-2 py-2.5 bg-[#8B7355]/10 text-[#8B7355] rounded-xl text-xs font-bold border border-[#8B7355]/20 hover:bg-[#8B7355] hover:text-white transition-all"
          >
            <Clock size={14} /> Planen
          </button>
        </div>
      </div>
    </Link>
  );
}