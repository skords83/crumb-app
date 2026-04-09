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

const PRIMARY_CATEGORIES = [
  { id: 'alle',      label: 'Alle',            icon: '✦' },
  { id: 'brot',      label: 'Brot',            icon: '🍞' },
  { id: 'broetchen', label: 'Brötchen',        icon: '🥐' },
  { id: 'pizza',     label: 'Pizza & Fladen',  icon: '🍕' },
  { id: 'suesses',   label: 'Süßes Gebäck',   icon: '🧇' },
  { id: 'cracker',   label: 'Knäcke & Cracker', icon: '🫙' },
];

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [recipes, setRecipes] = useState<any[]>([]);
  const [allRecipes, setAllRecipes] = useState<any[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<any>(null);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [inputValue, setInputValue] = useState(searchParams.get('q') ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    debounceRef.current = setTimeout(() => { updateParams({ q: value || null }); }, 250);
  };

  const setCategory = (id: string) => { updateParams({ category: id === 'alle' ? null : id }); };
  const clearAllFilters = () => { updateParams({ category: null }); };

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setShowSortMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isUnfiltered = !searchQuery && activeCategory === 'alle' && (activeSort === 'newest' || activeSort === 'random');

  useEffect(() => {
    setIsLoading(true); setLoadError(false);
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (activeCategory && activeCategory !== 'alle') params.set('category', activeCategory);
    if (activeSort && activeSort !== 'newest' && activeSort !== 'random') params.set('sort', activeSort);
    const url = `${process.env.NEXT_PUBLIC_API_URL}/recipes${params.toString() ? '?' + params.toString() : ''}`;
    fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` } })
      .then(res => res.json())
      .then(data => {
        let list = Array.isArray(data) ? data : [];
        if (activeSort === 'random') list = [...list].sort(() => Math.random() - 0.5);
        setRecipes(list);
        if (isUnfiltered) setAllRecipes(list);
        setIsLoading(false);
      })
      .catch(() => { setLoadError(true); setIsLoading(false); });
  }, [searchQuery, activeCategory, activeSort]);

  useEffect(() => {
    if (allRecipes.length > 0 || isUnfiltered) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` } })
      .then(res => res.json()).then(data => setAllRecipes(Array.isArray(data) ? data : [])).catch(() => {});
  }, [allRecipes.length, isUnfiltered]);

  const toggleFavorite = async (id: number, status: boolean) => {
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: status } : r));
    setAllRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: status } : r));
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }, body: JSON.stringify({ is_favorite: status }) });
      if (!res.ok) { setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r)); setAllRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r)); }
    } catch { setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r)); setAllRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: !status } : r)); }
  };

  const filteredRecipes = recipes;
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [searchQuery, activeCategory, activeSort]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { alle: allRecipes.length };
    for (const cat of PRIMARY_CATEGORIES) { if (cat.id === 'alle') continue; counts[cat.id] = allRecipes.filter(r => r.category === cat.id).length; }
    return counts;
  }, [allRecipes]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(entries => { if (entries[0].isIntersecting) setVisibleCount(v => v + PAGE_SIZE); }, { threshold: 0.1 });
    observerRef.current.observe(node);
  }, []);

  const visibleRecipes = filteredRecipes.slice(0, visibleCount);
  const hasMore = visibleCount < filteredRecipes.length;
  const activeSortLabel = SORT_OPTIONS.find(o => o.value === activeSort)?.label ?? 'Sortierung';
  const hasActiveFilters = activeCategory !== 'alle';

  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] px-6 text-[#2C1A0E] dark:text-white transition-colors duration-200">
      <div className="max-w-6xl mx-auto pt-8 pb-20">

        <div className="space-y-3 mb-10">
          {/* Suche + Sort */}
          <div className="flex gap-3 items-center">
            <div className="relative group flex-1">
              <Search className="absolute inset-y-0 left-5 top-1/2 -translate-y-1/2 text-[#C4A484] group-focus-within:text-[#8B7355] dark:text-gray-400 dark:group-focus-within:text-[#C4A484] transition-colors" size={20} />
              <input
                type="text"
                placeholder="Brot, Mehl oder Zutat suchen..."
                value={inputValue}
                onChange={(e) => handleSearchInput(e.target.value)}
                className="w-full bg-white dark:bg-gray-800 border-2 border-[#D6C9B4] dark:border-[#C4A484]/20 py-4 pl-14 pr-8 rounded-2xl outline-none focus:border-[#8B7355]/50 dark:focus:border-[#C4A484]/40 transition-all text-[#2C1A0E] dark:text-gray-100 placeholder:text-[#C4A484] dark:placeholder:text-gray-500"
              />
            </div>

            {/* Sort-Dropdown */}
            <div className="relative" ref={sortMenuRef}>
              <button
                onClick={() => setShowSortMenu(v => !v)}
                className="flex items-center gap-2 px-4 py-4 bg-white dark:bg-gray-800 border-2 border-[#D6C9B4] dark:border-[#C4A484]/20 rounded-2xl text-sm font-bold text-[#A68B6A] dark:text-[#C4A484]/70 hover:border-[#8B7355]/30 dark:hover:border-[#C4A484]/40 transition-all whitespace-nowrap"
              >
                <ArrowUpDown size={16} />
                <span className="hidden sm:inline">{activeSortLabel}</span>
              </button>
              {showSortMenu && (
                <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-gray-800 border border-[#D6C9B4] dark:border-gray-700 rounded-2xl shadow-xl z-50 overflow-hidden">
                  {SORT_OPTIONS.map(opt => (
                    <button key={opt.value}
                      onClick={() => { updateParams({ sort: opt.value === 'newest' ? null : opt.value }); setShowSortMenu(false); }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors ${activeSort === opt.value ? 'bg-[#8B7355]/10 text-[#8B7355] dark:text-[#C4A484] font-bold' : 'text-[#5C3D1E] dark:text-gray-400 hover:bg-[#F5F0E8] dark:hover:bg-gray-700'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Kategorien */}
          <div className="flex flex-wrap gap-2">
            {PRIMARY_CATEGORIES.map((cat) => (
              <button key={cat.id} onClick={() => setCategory(cat.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all whitespace-nowrap ${
                  activeCategory === cat.id
                    ? 'bg-[#8B7355] text-white border-[#8B7355] shadow-md'
                    : 'bg-white dark:bg-gray-800 text-[#A68B6A] dark:text-gray-400 border-[#D6C9B4] dark:border-gray-700 hover:border-[#8B7355]/30 dark:hover:border-gray-600'
                }`}>
                <span className="text-sm leading-none">{cat.icon}</span>
                {cat.label}
                {allRecipes.length > 0 && (
                  <span className={`text-xs font-normal px-1.5 py-0.5 rounded-full ${activeCategory === cat.id ? 'bg-white/20 text-white' : 'bg-[#EDE5D6] dark:bg-gray-700 text-[#A68B6A] dark:text-gray-500'}`}>
                    {categoryCounts[cat.id] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Aktive Filter */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {activeCategory !== 'alle' && (
                <span onClick={() => setCategory('alle')} className="flex items-center gap-1.5 px-3 py-1 bg-[#8B7355] text-white text-xs font-bold rounded-full cursor-pointer hover:bg-[#7a6248] transition-colors">
                  {PRIMARY_CATEGORIES.find(c => c.id === activeCategory)?.label}<X size={11} />
                </span>
              )}
              <button onClick={clearAllFilters} className="text-xs text-[#A68B6A] dark:text-gray-500 hover:text-[#5C3D1E] dark:hover:text-gray-300 underline transition-colors">Alle zurücksetzen</button>
              <span className="text-xs text-[#A68B6A] dark:text-gray-500 ml-auto">{filteredRecipes.length} Rezepte</span>
            </div>
          )}
        </div>

        {/* Rezepte-Grid */}
        {isLoading ? (
          <RecipeGridSkeleton count={6} />
        ) : loadError ? (
          <div className="bg-white dark:bg-gray-800 rounded-[3rem] p-20 text-center border border-[#D6C9B4] dark:border-gray-700">
            <RefreshCw className="text-[#D6C9B4] dark:text-gray-600 mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-[#2C1A0E] dark:text-gray-100">Laden fehlgeschlagen</h2>
            <p className="text-[#A68B6A] dark:text-gray-500 mt-2 mb-6">Prüfe deine Verbindung und versuch es nochmal.</p>
            <button onClick={() => updateParams({})} className="inline-flex items-center gap-2 bg-[#8B7355] text-white px-6 py-3 rounded-2xl font-bold text-sm hover:bg-[#766248] transition-colors">
              <RefreshCw size={16} /> Nochmal versuchen
            </button>
          </div>
        ) : filteredRecipes.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-[3rem] p-20 text-center border border-[#D6C9B4] dark:border-gray-700">
            <BookOpen className="text-[#D6C9B4] dark:text-gray-700 mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-[#2C1A0E] dark:text-gray-100">Kein passendes Brot gefunden</h2>
            <p className="text-[#A68B6A] dark:text-gray-500 mt-2">Versuch es mit einem anderen Filter oder Suchbegriff.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {visibleRecipes.map((recipe) => (
                <RecipeCard key={recipe.id} recipe={recipe} onToggleFavorite={toggleFavorite} onPlan={(r) => { setSelectedRecipe(r); setShowPlanModal(true); }} />
              ))}
            </div>
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

      <Link href="/new" className="fixed bottom-24 right-6 md:bottom-10 md:right-10 z-50 bg-[#8B7355] text-white p-5 rounded-2xl shadow-2xl hover:scale-110 active:scale-95 transition-all">
        <Plus size={24} strokeWidth={3} />
      </Link>

      <PlanModal isOpen={showPlanModal} onClose={() => setShowPlanModal(false)} recipe={selectedRecipe} />
    </div>
  );
}

export default function HomePage() {
  return <Suspense><HomePageContent /></Suspense>;
}
