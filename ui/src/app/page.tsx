"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, BookOpen, Search, ArrowUpDown, X, RefreshCw } from 'lucide-react';
import PlanModal from "@/components/PlanModal";
import RecipeCard from "@/components/RecipeCard";
import { RecipeGridSkeleton } from "@/components/LoadingSkeletons";

const PAGE_SIZE = 12;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Neueste zuerst' },
  { value: 'oldest', label: 'Älteste zuerst' },
  { value: 'shortest', label: 'Kürzeste Dauer' },
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
  { value: 'random', label: 'Zufällig' },
];

// Primärkategorien — exklusiv, direkte DB-Spalte
const PRIMARY_CATEGORIES = [
  { id: 'alle',      label: 'Alle' },
  { id: 'brot',      label: 'Brot' },
  { id: 'broetchen', label: 'Brötchen' },
  { id: 'pizza',     label: 'Pizza & Fladen' },
  { id: 'suesses',   label: 'Süßes Gebäck' },
  { id: 'cracker',   label: 'Knäcke & Cracker' },
];

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [recipes, setRecipes] = useState<any[]>([]);
  const [allRecipes, setAllRecipes] = useState<any[]>([]); // Ungefilterte Kopie für Counts
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<any>(null);
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Interner Input-State für Debounce (Eingabe sofort, URL nach 250ms)
  const [inputValue, setInputValue] = useState(searchParams.get('q') ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL-Parameter als Source of Truth
  const searchQuery = searchParams.get('q') ?? '';
  const activeCategory = searchParams.get('category') ?? 'alle';
  const activeSort = searchParams.get('sort') ?? 'newest';

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
      updateParams({ q: value || null });
    }, 250);
  };

  const setCategory = (id: string) => {
    updateParams({ category: id === 'alle' ? null : id });
  };

  const clearAllFilters = () => {
    updateParams({ category: null });
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

  // Prüfen ob gerade ungefiltert geladen wird (= Daten auch für Counts nutzbar)
  const isUnfiltered = !searchQuery && activeCategory === 'alle' && (activeSort === 'newest' || activeSort === 'random');

  // Rezepte vom Backend laden wenn URL-Parameter sich ändern
  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (activeCategory && activeCategory !== 'alle') params.set('category', activeCategory);
    if (activeSort && activeSort !== 'newest' && activeSort !== 'random') params.set('sort', activeSort);

    const url = `${process.env.NEXT_PUBLIC_API_URL}/recipes${params.toString() ? '?' + params.toString() : ''}`;

    fetch(url, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
    })
      .then(res => res.json())
      .then(data => {
        let list = Array.isArray(data) ? data : [];
        if (activeSort === 'random') list = [...list].sort(() => Math.random() - 0.5);
        setRecipes(list);
        // Wenn ungefiltert: gleich als Counts-Basis übernehmen (spart zweiten Request)
        if (isUnfiltered) setAllRecipes(list);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Ladefehler:", err);
        setLoadError(true);
        setIsLoading(false);
      });
  }, [searchQuery, activeCategory, activeSort]);

  // Counts: nur einmalig nachladen wenn der erste Request gefiltert war
  useEffect(() => {
    if (allRecipes.length > 0) return; // schon vorhanden
    if (isUnfiltered) return; // wird vom Haupt-Request befüllt
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
    })
      .then(res => res.json())
      .then(data => setAllRecipes(Array.isArray(data) ? data : []))
      .catch(() => {}); // Counts sind nice-to-have, kein Fehler nötig
  }, [allRecipes.length, isUnfiltered]);

  // Optimistisches Favoriten-Toggle mit Rollback
  const toggleFavorite = async (id: number, status: boolean) => {
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: status } : r));
    setAllRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: status } : r));
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
        setAllRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r));
      }
    } catch (err) {
      setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r));
      setAllRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r));
      console.error("Favorit-Fehler:", err);
    }
  };

  // Alle Backend-Rezepte werden bereits gefiltert zurückgegeben
  const filteredRecipes = recipes;

  // visibleCount zurücksetzen bei Filter/Suche/Sort-Wechsel
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, activeCategory, activeSort]);

  // Counts aus allRecipes berechnen (clientseitig, kein Extra-Request)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { alle: allRecipes.length };
    for (const cat of PRIMARY_CATEGORIES) {
      if (cat.id === 'alle') continue;
      counts[cat.id] = allRecipes.filter(r => r.category === cat.id).length;
    }
    return counts;
  }, [allRecipes]);

  // IntersectionObserver für Infinite Scroll – callback ref
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisibleCount(prev => prev + PAGE_SIZE); },
      { root: null, rootMargin: '200px', threshold: 0 }
    );
    observerRef.current.observe(node);
  }, []);

  const visibleRecipes = filteredRecipes.slice(0, visibleCount);
  const hasMore = visibleCount < filteredRecipes.length;
  const activeSortLabel = SORT_OPTIONS.find(o => o.value === activeSort)?.label ?? 'Sortierung';
  const hasActiveFilters = activeCategory !== 'alle';

  return (
    <div className="min-h-screen bg-[#F4F7F8] dark:bg-[#0F172A] px-6 text-gray-900 dark:text-gray-100 transition-colors duration-200">
      <div className="max-w-6xl mx-auto pt-8 pb-20">

        {/* Header: Suche, Sort & Filter */}
        <div className="space-y-3 mb-10">

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
                <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-xl z-50 overflow-hidden">
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

          {/* Primärkategorien — exklusiv */}
          <div className="flex flex-wrap gap-2">
            {PRIMARY_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all whitespace-nowrap ${
                  activeCategory === cat.id
                    ? 'bg-[#8B7355] text-white border-[#8B7355] shadow-md'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 shadow-sm'
                }`}
              >
                {cat.label}
                {allRecipes.length > 0 && (
                  <span className={`text-xs font-normal px-1.5 py-0.5 rounded-full ${
                    activeCategory === cat.id
                      ? 'bg-white/20 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                  }`}>
                    {categoryCounts[cat.id] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Aktive Filter als entfernbare Tags */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {activeCategory !== 'alle' && (
                <span
                  onClick={() => setCategory('alle')}
                  className="flex items-center gap-1.5 px-3 py-1 bg-[#8B7355] text-white text-xs font-bold rounded-full cursor-pointer hover:bg-[#7a6248] transition-colors"
                >
                  {PRIMARY_CATEGORIES.find(c => c.id === activeCategory)?.label}
                  <X size={11} />
                </span>
              )}
              {(activeCategory !== 'alle') && (
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline transition-colors"
                >
                  Alle zurücksetzen
                </button>
              )}
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                {filteredRecipes.length} Rezepte
              </span>
            </div>
          )}
        </div>

        {/* Rezepte-Grid */}
        {isLoading ? (
          <RecipeGridSkeleton count={6} />
        ) : loadError ? (
          <div className="bg-white dark:bg-gray-800 rounded-[3rem] p-20 text-center border border-gray-100 dark:border-gray-700 shadow-sm">
            <RefreshCw className="text-gray-300 dark:text-gray-600 mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Laden fehlgeschlagen</h2>
            <p className="text-gray-400 dark:text-gray-500 mt-2 mb-6">Prüfe deine Verbindung und versuch es nochmal.</p>
            <button
              onClick={() => updateParams({})}
              className="inline-flex items-center gap-2 bg-[#8B7355] text-white px-6 py-3 rounded-2xl font-bold text-sm hover:bg-[#766248] transition-colors"
            >
              <RefreshCw size={16} /> Nochmal versuchen
            </button>
          </div>
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