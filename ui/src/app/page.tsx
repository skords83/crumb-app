"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, BookOpen, Search } from 'lucide-react';
import PlanModal from "@/components/PlanModal";
import RecipeCard from "@/components/RecipeCard";

export default function HomePage() {
  const [recipes, setRecipes] = useState<any[]>([]);
  const [filteredRecipes, setFilteredRecipes] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("Alle");
  const [isLoading, setIsLoading] = useState(true);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<any>(null);

  const getRecipeDuration = (recipe: any) => {
    let totalMinutes = 0;
    if (recipe.dough_sections) {
      recipe.dough_sections.forEach((s: any) => {
        s.steps?.forEach((st: any) => {
          const d = parseInt(String(st.duration));
          if (!isNaN(d)) totalMinutes += d;
        });
      });
    }
    return totalMinutes;
  };

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes`)
      .then(res => res.json())
      .then(data => {
        const sortedData = Array.isArray(data) ? data : [];
        setRecipes(sortedData);
        setFilteredRecipes(sortedData);
          setIsLoading(false);
      })
      .catch(err => {
        console.error("Ladefehler:", err);
        setIsLoading(false);
      });
  }, []);

  const toggleFavorite = async (id: number, status: boolean) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_favorite: status })
      });
      
      if (res.ok) {
        setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: status } : r));
      }
    } catch (err) {
      console.error("Favorit-Fehler:", err);
    }
  };

  useEffect(() => {
    let result = recipes;
    if (searchQuery) {
      result = result.filter(r => 
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        JSON.stringify(r).toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (activeFilter !== "Alle") {
      result = result.filter(recipe => {
        const content = JSON.stringify(recipe).toLowerCase();
        const duration = getRecipeDuration(recipe);
        
        switch (activeFilter) {
          case "Favoriten": return recipe.is_favorite;
          case "Sauerteig": return content.includes("sauerteig") || content.includes("anstellgut");
          case "Hefeteig": return content.includes("hefe") && !content.includes("sauerteig");
          case "Vollkorn": return content.includes("vollkorn");
          case "Heute fertig": 
            if (duration <= 0) return false;
            const jetzt = new Date();
            const aktuelleMinutenSeitMitternacht = jetzt.getHours() * 60 + jetzt.getMinutes();
            const minutenBisMitternacht = (24 * 60) - aktuelleMinutenSeitMitternacht;
            return duration <= minutenBisMitternacht;
        }
      });
    } 
    setFilteredRecipes(result);
  }, [searchQuery, activeFilter, recipes]);

  return (
    <div className="min-h-screen bg-[#F4F7F8] dark:bg-[#0F172A] px-6 text-gray-900 dark:text-gray-100 transition-colors duration-200">
      <div className="max-w-6xl mx-auto pt-8 pb-20">
        
        {/* Header-Bereich: Suche & Filter */}
        <div className="space-y-6 mb-10">
          <div className="relative group">
            <Search className="absolute inset-y-0 left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#8B7355] dark:group-focus-within:text-[#C4A484] transition-colors" size={20} />
            <input
              type="text"
              placeholder="Brot, Mehl oder Zutat suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 py-4 pl-14 pr-8 rounded-2xl shadow-sm outline-none focus:border-[#8B7355]/40 dark:focus:border-[#8B7355]/60 transition-all text-gray-800 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-2 px-2">
            {["Alle", "Sauerteig", "Hefeteig", "Vollkorn", "Heute fertig", "Favoriten"].map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm border-2 transition-all whitespace-nowrap ${
                  activeFilter === filter 
                    ? 'bg-[#8B7355] text-white border-[#8B7355] shadow-md scale-105' 
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 shadow-sm hover:shadow-md'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {/* Rezepte-Grid */}
        {isLoading ? (
          <div className="py-40 text-center uppercase tracking-widest text-gray-400 dark:text-gray-500 animate-pulse font-bold">Ofen wird vorgeheizt...</div>
        ) : filteredRecipes.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-[3rem] p-20 text-center border border-gray-100 dark:border-gray-700 shadow-sm">
            <BookOpen className="text-gray-200 dark:text-gray-700 mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Kein passendes Brot gefunden</h2>
            <p className="text-gray-400 dark:text-gray-500 mt-2">Versuch es mit einem anderen Filter oder Suchbegriff.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredRecipes.map((recipe) => (
              <RecipeCard 
                key={recipe.id} 
                recipe={recipe} 
                onToggleFavorite={toggleFavorite}
                onPlan={(r) => { setSelectedRecipe(r); setShowPlanModal(true); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating Action Button */}
      <Link href="/new" className="fixed bottom-10 right-10 z-50 bg-[#8B7355] text-white p-5 rounded-2xl shadow-2xl hover:scale-110 active:scale-95 transition-all group">
        <Plus size={24} strokeWidth={3} />
      </Link>

      {/* Planungs-Modal */}
      <PlanModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        recipe={selectedRecipe}
        onConfirm={async (plannedAt) => {
          if (!selectedRecipe) return;
          try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${selectedRecipe.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ planned_at: plannedAt }),
            });
            if (res.ok) {
              setRecipes(prev => prev.map(r => 
                r.id === selectedRecipe.id ? { ...r, planned_at: plannedAt } : r
              ));
              setShowPlanModal(false);
            }
          } catch (err) { console.error("Planungs-Fehler:", err); }
        }}
      />
    </div>
  );
}
