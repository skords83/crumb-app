"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, BookOpen } from 'lucide-react';
import RecipeCard from '@/components/RecipeCard';
import { RecipeGridSkeleton } from '@/components/LoadingSkeletons';
import PlanModal from '@/components/PlanModal';

// ── FILTER DEFINITIONEN ──────────────────────────────────────
const FILTER_GROUPS = [
  {
    id: 'kategorie',
    label: 'Kategorie',
    filters: [
      { id: 'cat_brot',      label: 'Brot',             type: 'category', value: 'brot' },
      { id: 'cat_broetchen', label: 'Brötchen',         type: 'category', value: 'broetchen' },
      { id: 'cat_pizza',     label: 'Pizza & Fladen',   type: 'category', value: 'pizza' },
      { id: 'cat_suesses',   label: 'Süßes Gebäck',     type: 'category', value: 'suesses' },
      { id: 'cat_cracker',   label: 'Knäcke & Cracker', type: 'category', value: 'cracker' },
    ],
  },
  {
    id: 'triebmittel',
    label: 'Triebmittel',
    filters: [
      { id: 'f_sauerteig', label: 'Sauerteig',         type: 'filter', value: 'Sauerteig' },
      { id: 'f_hefe',      label: 'Nur Hefe',           type: 'filter', value: 'Hefe' },
      { id: 'f_hybrid',    label: 'Sauerteig + Hefe',   type: 'filter', value: 'Hybrid' },
      { id: 'f_lm',        label: 'Lievito Madre',      type: 'filter', value: 'LM' },
    ],
  },
  {
    id: 'getreide',
    label: 'Getreide',
    filters: [
      { id: 'f_weizen',  label: 'Weizen',   type: 'filter', value: 'Weizen' },
      { id: 'f_roggen',  label: 'Roggen',   type: 'filter', value: 'Roggen' },
      { id: 'f_dinkel',  label: 'Dinkel',   type: 'filter', value: 'Dinkel' },
      { id: 'f_hafer',   label: 'Hafer',    type: 'filter', value: 'Hafer' },
      { id: 'f_urkorn',  label: 'Urkorn',   type: 'filter', value: 'Urkorn' },
    ],
  },
  {
    id: 'eigenschaften',
    label: 'Eigenschaften',
    filters: [
      { id: 'f_vollkorn',   label: 'Vollkorn',    type: 'filter', value: 'Vollkorn' },
      { id: 'f_uebernacht', label: 'Übernacht',   type: 'filter', value: 'Uebernacht' },
      { id: 'f_schnell',    label: 'Unter 4h',    type: 'filter', value: 'Schnell' },
    ],
  },
  {
    id: 'sonstiges',
    label: 'Sonstiges',
    filters: [
      { id: 'f_favoriten', label: 'Favoriten', type: 'filter', value: 'Favoriten' },
    ],
  },
];

const PAGE_SIZE = 12;

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [recipes, setRecipes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<any>(null);

  // URL-State
  const searchQuery = searchParams.get('q') ?? '';
  const activeCategory = searchParams.get('category') ?? '';
  const activeFilters = useMemo(() => {
    const f = searchParams.get('filter');
    return f ? f.split(',').filter(Boolean) : [];
  }, [searchParams]);

  const [inputValue, setInputValue] = useState(searchQuery);

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    });
    router.replace(`/search?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Checkbox toggle
  const toggleFilter = (type: string, value: string) => {
    if (type === 'category') {
      updateParams({ category: activeCategory === value ? null : value });
    } else {
      const next = activeFilters.includes(value)
        ? activeFilters.filter(f => f !== value)
        : [...activeFilters, value];
      updateParams({ filter: next.length > 0 ? next.join(',') : null });
    }
  };

  const isChecked = (type: string, value: string) => {
    if (type === 'category') return activeCategory === value;
    return activeFilters.includes(value);
  };

  const activeCount = (activeCategory ? 1 : 0) + activeFilters.length;

  const clearAll = () => updateParams({ category: null, filter: null, q: null });

  // Suche ausführen
  const fetchRecipes = useCallback(async () => {
    const hasAnyFilter = searchQuery || activeCategory || activeFilters.length > 0;
    if (!hasAnyFilter) { setRecipes([]); setHasSearched(false); return; }

    setIsLoading(true);
    setHasSearched(true);
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (activeCategory) params.set('category', activeCategory);
    if (activeFilters.length > 0) params.set('filter', activeFilters.join(','));

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/recipes?${params.toString()}`,
        { headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` } }
      );
      const data = await res.json();
      setRecipes(Array.isArray(data) ? data : []);
      setVisibleCount(PAGE_SIZE);
    } catch (err) {
      console.error('Suchfehler:', err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, activeCategory, activeFilters]);

  useEffect(() => { fetchRecipes(); }, [fetchRecipes]);

  // Debounced Suche bei Texteingabe
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchInput = (value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value || null });
    }, 250);
  };

  const toggleFavorite = async (id: number, status: boolean) => {
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: status } : r));
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ is_favorite: status })
      });
      if (!res.ok) setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r));
    } catch {
      setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r));
    }
  };

  const visibleRecipes = recipes.slice(0, visibleCount);
  const hasMore = visibleCount < recipes.length;

  return (
    <div className="min-h-screen bg-[#F4F7F8] dark:bg-[#0F172A] text-gray-900 dark:text-gray-100 transition-colors duration-200">
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-20">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* ── FILTER SIDEBAR ── */}
          <aside className="w-full lg:w-64 flex-shrink-0">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 sticky top-40">

              {/* Suche */}
              <div className="relative mb-6">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Suchbegriff..."
                  value={inputValue}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600 py-2.5 pl-9 pr-8 rounded-xl outline-none focus:border-[#8B7355]/40 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
                />
                {inputValue && (
                  <button onClick={() => { setInputValue(''); updateParams({ q: null }); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Filter-Gruppen */}
              <div className="space-y-6">
                {FILTER_GROUPS.map(group => (
                  <div key={group.id}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">
                      {group.label}
                    </p>
                    <div className="space-y-2">
                      {group.filters.map(f => (
                        <label
                          key={f.id}
                          className="flex items-center gap-3 cursor-pointer group"
                        >
                          <div
                            onClick={() => toggleFilter(f.type, f.value)}
                            className={`w-4 h-4 rounded flex items-center justify-center border-2 flex-shrink-0 transition-all ${
                              isChecked(f.type, f.value)
                                ? 'bg-[#8B7355] border-[#8B7355]'
                                : 'border-gray-300 dark:border-gray-600 group-hover:border-[#8B7355]/50'
                            }`}
                          >
                            {isChecked(f.type, f.value) && (
                              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <span
                            onClick={() => toggleFilter(f.type, f.value)}
                            className={`text-sm transition-colors ${
                              isChecked(f.type, f.value)
                                ? 'text-[#8B7355] dark:text-[#C4A484] font-bold'
                                : 'text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200'
                            }`}
                          >
                            {f.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Alles zurücksetzen */}
              {activeCount > 0 && (
                <button
                  onClick={clearAll}
                  className="mt-6 w-full py-2 text-xs font-bold text-gray-400 hover:text-red-500 dark:hover:text-red-400 border border-gray-200 dark:border-gray-600 rounded-xl transition-colors"
                >
                  Alle Filter zurücksetzen ({activeCount})
                </button>
              )}
            </div>
          </aside>

          {/* ── ERGEBNISSE ── */}
          <div className="flex-1 min-w-0">

            {/* Aktive Filter als Tags */}
            {activeCount > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {activeCategory && (
                  <span
                    onClick={() => updateParams({ category: null })}
                    className="flex items-center gap-1.5 px-3 py-1 bg-[#8B7355] text-white text-xs font-bold rounded-full cursor-pointer hover:bg-[#7a6248] transition-colors"
                  >
                    {FILTER_GROUPS[0].filters.find(f => f.value === activeCategory)?.label}
                    <X size={11} />
                  </span>
                )}
                {activeFilters.map(id => {
                  const label = FILTER_GROUPS.flatMap(g => g.filters).find(f => f.value === id)?.label;
                  return (
                    <span
                      key={id}
                      onClick={() => {
                        const next = activeFilters.filter(f => f !== id);
                        updateParams({ filter: next.length > 0 ? next.join(',') : null });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 bg-gray-700 dark:bg-gray-200 text-white dark:text-gray-900 text-xs font-bold rounded-full cursor-pointer hover:bg-gray-600 dark:hover:bg-gray-300 transition-colors"
                    >
                      {label ?? id}
                      <X size={11} />
                    </span>
                  );
                })}
              </div>
            )}

            {/* Ergebnisse */}
            {isLoading ? (
              <RecipeGridSkeleton count={6} />
            ) : !hasSearched ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-16 text-center border border-gray-100 dark:border-gray-700">
                <Search className="text-gray-200 dark:text-gray-700 mx-auto mb-4" size={40} />
                <p className="text-gray-400 dark:text-gray-500 font-medium">Filter wählen oder Suchbegriff eingeben</p>
              </div>
            ) : recipes.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-16 text-center border border-gray-100 dark:border-gray-700">
                <BookOpen className="text-gray-200 dark:text-gray-700 mx-auto mb-4" size={40} />
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Keine Rezepte gefunden</h2>
                <p className="text-gray-400 dark:text-gray-500 mt-2 text-sm">Versuch andere Filter oder einen anderen Suchbegriff.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-4 font-medium">
                  {recipes.length} {recipes.length === 1 ? 'Rezept' : 'Rezepte'} gefunden
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {visibleRecipes.map(recipe => (
                    <RecipeCard
                      key={recipe.id}
                      recipe={recipe}
                      onToggleFavorite={toggleFavorite}
                      onPlan={(r) => { setSelectedRecipe(r); setShowPlanModal(true); }}
                    />
                  ))}
                </div>
                {hasMore && (
                  <div className="py-8 flex justify-center">
                    <button
                      onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                      className="px-6 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-bold text-gray-500 dark:text-gray-400 hover:border-[#8B7355]/40 transition-colors"
                    >
                      Mehr laden
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <PlanModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        recipe={selectedRecipe}
        onConfirm={async (plannedAt) => {
          if (!selectedRecipe) return;
          try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${selectedRecipe.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
              body: JSON.stringify({ planned_at: plannedAt }),
            });
            setShowPlanModal(false);
          } catch (err) { console.error(err); }
        }}
      />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageContent />
    </Suspense>
  );
}