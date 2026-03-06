"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, BookOpen, Search, ArrowUpDown } from 'lucide-react';
import PlanModal from "@/components/PlanModal";
import RecipeCard from "@/components/RecipeCard";
import { RecipeGridSkeleton } from "@/components/LoadingSkeletons";

const PAGE_SIZE = 12;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Neueste zuerst' },
  { value: 'oldest', label: 'Älteste zuerst' },
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
];

const FILTERS = ["Alle", "Sauerteig", "Hefeteig", "Vollkorn", "Heute fertig", "Favoriten"];

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [recipes, setRecipes] = useState<any[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<any>(null);
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Interner Input-State für Debounce (Eingabe sofort, URL nach 250ms)
  const [inputValue, setInputValue] = useState(searchParams.get('q') ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL-Parameter als Source of Truth
  const searchQuery = searchParams.get('q') ?? '';
  const activeFilter = searchParams.get('filter') ?? 'Alle';
  const activeSort = searchParams.get('sort') ?? 'newest';

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  const updateParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    });
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const handleSearchInput = (value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value || null, filter: null });
    }, 250);
  };

  // Sort-Menü bei Klick außerhalb schließen
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
    })
      .then(res => res.json())
      .then(data => {
        setRecipes(Array.isArray(data) ? data : []);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Ladefehler:", err);
        setIsLoading(false);
      });
  }, []);

  // Optimistisches Favoriten-Toggle mit Rollback
  const toggleFavorite = async (id: number, status: boolean) => {
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: status } : r));
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('crumb_token')}`
        },
        body: JSON.stringify({ is_favorite: status })
      });
      if (!res.ok) {
        setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r));
      }
    } catch (err) {
      setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r));
      console.error("Favorit-Fehler:", err);
    }
  };

  const getRecipeDuration = (recipe: any) => {
    let totalMinutes = 0;
    recipe.dough_sections?.forEach((s: any) => {
      s.steps?.forEach((st: any) => {
        const d = parseInt(String(st.duration));
        if (!isNaN(d)) totalMinutes += d;
      });
    });
    return totalMinutes;
  };

  // Gezielte Suche – kein JSON.stringify mehr
  const matchesSearch = (recipe: any, query: string) => {
    const q = query.toLowerCase();
    if (recipe.title?.toLowerCase().includes(q)) return true;
    if (recipe.description?.toLowerCase().includes(q)) return true;
    if (recipe.dough_sections?.some((s: any) =>
      s.ingredients?.some((i: any) => i.name?.toLowerCase().includes(q)) ||
      s.steps?.some((st: any) => st.description?.toLowerCase().includes(q))
    )) return true;
    return false;
  };

  // Hilfsfunktion: Rezept-Inhaltsstring für Filterlogik
  const getRecipeContent = (recipe: any) => {
    const title = (recipe.title ?? '').toLowerCase();
    const desc = (recipe.description ?? '').toLowerCase();
    const ingredients = recipe.dough_sections?.flatMap((s: any) =>
      s.ingredients?.map((i: any) => i.name?.toLowerCase() ?? '') ?? []
    ).join(' ') ?? '';
    return `${title} ${desc} ${ingredients}`;
  };

  const matchesFilter = (recipe: any, filter: string) => {
    const combined = getRecipeContent(recipe);
    const duration = getRecipeDuration(recipe);
    switch (filter) {
      case 'Alle': return true;
      case 'Favoriten': return recipe.is_favorite;
      case 'Sauerteig': return combined.includes('sauerteig') || combined.includes('anstellgut');
      case 'Hefeteig': return combined.includes('hefe') && !combined.includes('sauerteig');
      case 'Vollkorn': return combined.includes('vollkorn');
      case 'Heute fertig': {
        if (duration <= 0) return false;
        const now = new Date();
        const minutesLeft = (24 * 60) - (now.getHours() * 60 + now.getMinutes());
        return duration <= minutesLeft;
      }
      default: return true;
    }
  };

  // Gefilterte + sortierte Rezepte als memo
  const filteredRecipes = useMemo(() => {
    let result = recipes.filter(r =>
      (!searchQuery || matchesSearch(r, searchQuery)) &&
      matchesFilter(r, activeFilter)
    );
    result.sort((a, b) => {
      switch (activeSort) {
        case 'oldest': return (a.id ?? 0) - (b.id ?? 0);
        case 'az': return (a.title ?? '').localeCompare(b.title ?? '', 'de');
        case 'za': return (b.title ?? '').localeCompare(a.title ?? '', 'de');
        default: return (b.id ?? 0) - (a.id ?? 0); // newest
      }
    });
    return result;
  }, [recipes, searchQuery, activeFilter, activeSort]);

  // visibleCount zurücksetzen bei Filter/Suche/Sort-Wechsel
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, activeFilter, activeSort]);

  // Filter-Anzahl-Badges
  const filterCounts = useMemo(() =>
    Object.fromEntries(FILTERS.map(f => [f, recipes.filter(r => matchesFilter(r, f)).length])),
    [recipes]
  );

  // IntersectionObserver für Infinite Scroll
  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    if (entries[0].isIntersecting) setVisibleCount(prev => prev + PAGE_SIZE);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(handleObserver, { root: null, rootMargin: '200px', threshold: 0 });
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [handleObserver]);

  const visibleRecipes = filteredRecipes.slice(0, visibleCount);
  const hasMore = visibleCount < filteredRecipes.length;
  const activeSortLabel = SORT_OPTIONS.find(o => o.value === activeSort)?.label ?? 'Sortierung';

  return (
    <div className="min-h-screen bg-[#F4F7F8] dark:bg-[#0F172A] px-6 text-gray-900 dark:text-gray-100 transition-colors duration-200">
      <div className="max-w-6xl mx-auto pt-8 pb-20">

        {/* Header: Suche, Sort & Filter */}
        <div className="space-y-4 mb-10">

          {/* Suche + Sort */}
          <div className="flex gap-3 items-center">
            <div className="relative group flex-1">
              <Search className="absolute inset-y-0 left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#8B7355] dark:group-focus-within:text-[#C4A484] transition-colors" size={20} />
              <input
                type="text"
                placeholder="Brot, Mehl oder Zutat suchen..."
                value={inputValue}
                onChange={(e) => handleSearchInput(e.target.value)}
                className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 py-4 pl-14 pr-8 rounded-2xl shadow-sm outline-none focus:border-[#8B7355]/40 dark:focus:border-[#8B7355]/60 transition-all text-gray-800 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
            </div>

            {/* Sort-Dropdown */}
            <div className="relative" ref={sortMenuRef}>
              <button
                onClick={() => setShowSortMenu(v => !v)}
                className="flex items-center gap-2 px-4 py-4 bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm text-sm font-bold text-gray-500 dark:text-gray-400 hover:border-gray-200 dark:hover:border-gray-600 transition-all whitespace-nowrap"
              >
                <ArrowUpDown size={16} />
                <span className="hidden sm:inline">{activeSortLabel}</span>
              </button>
              {showSortMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-xl z-20 overflow-hidden">
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { updateParams({ sort: opt.value === 'newest' ? null : opt.value }); setShowSortMenu(false); }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                        activeSort === opt.value
                          ? 'bg-[#8B7355]/10 text-[#8B7355] dark:text-[#C4A484] font-bold'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Filter-Chips mit Anzahl */}
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-2 px-2">
            {FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => updateParams({ filter: filter === 'Alle' ? null : filter })}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all whitespace-nowrap ${
                  activeFilter === filter
                    ? 'bg-[#8B7355] text-white border-[#8B7355] shadow-md scale-105'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 shadow-sm hover:shadow-md'
                }`}
              >
                {filter}
                {!isLoading && (
                  <span className={`text-xs font-normal px-1.5 py-0.5 rounded-full ${
                    activeFilter === filter
                      ? 'bg-white/20 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                  }`}>
                    {filterCounts[filter] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Rezepte-Grid */}
        {isLoading ? (
          <RecipeGridSkeleton count={6} />
        ) : filteredRecipes.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-[3rem] p-20 text-center border border-gray-100 dark:border-gray-700 shadow-sm">
            <BookOpen className="text-gray-200 dark:text-gray-700 mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Kein passendes Brot gefunden</h2>
            <p className="text-gray-400 dark:text-gray-500 mt-2">Versuch es mit einem anderen Filter oder Suchbegriff.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {visibleRecipes.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  onToggleFavorite={toggleFavorite}
                  onPlan={(r) => { setSelectedRecipe(r); setShowPlanModal(true); }}
                />
              ))}
            </div>

            {/* Sentinel + Lade-Indikator */}
            <div ref={sentinelRef} className="py-8 flex justify-center">
              {hasMore && (
                <div className="flex gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#8B7355]/40 animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 rounded-full bg-[#8B7355]/40 animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 rounded-full bg-[#8B7355]/40 animate-bounce [animation-delay:300ms]" />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Floating Action Button */}
      <Link href="/new" className="fixed bottom-24 right-6 md:bottom-10 md:right-10 z-50 bg-[#8B7355] text-white p-5 rounded-2xl shadow-2xl hover:scale-110 active:scale-95 transition-all">
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
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('crumb_token')}`
              },
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

export default function HomePage() {
  return (
    <Suspense>
      <HomePageContent />
    </Suspense>
  );
}