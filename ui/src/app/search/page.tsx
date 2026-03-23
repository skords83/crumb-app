"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, BookOpen, RefreshCw } from 'lucide-react';
import RecipeCard from '@/components/RecipeCard';
import { RecipeGridSkeleton } from '@/components/LoadingSkeletons';
import PlanModal from '@/components/PlanModal';

// ── ARBEITSTAUGLICH-CHECK ─────────────────────────────────────
// Prüft ob ein Rezept eine aktionsfreie Lücke >= minGapMinutes hat.
// Nutzt die gleiche Dependency-Graph-Logik wie backplan-utils/PlanModal.

function hasLongActionFreeGap(sections: any[], minGapMinutes: number): boolean {
  if (!sections?.length) return false;

  const phaseNames = sections.map((s: any) => s.name as string);
  const normalize = (name: string): string =>
    name.toLowerCase()
      .replace(/^\d+\.\s*/, '').replace(/\bstufe\s+\d+\b/g, '')
      .replace(/\breifer?\b/g, '').replace(/\bfrischer?\b/g, '')
      .replace(/\bfertig[a-z]*\b/g, '').replace(/\s+/g, ' ').trim();

  const deps: Record<string, string[]> = {};
  sections.forEach((section: any) => {
    deps[section.name] = [];
    (section.ingredients || []).forEach((ing: any) => {
      [ing.name || '', ing.temperature || ''].forEach(candidate => {
        const ingName = normalize(candidate);
        phaseNames.forEach(otherName => {
          if (otherName === section.name) return;
          const normOther = normalize(otherName);
          if (normOther.length < 4) return;
          const wb = new RegExp('(?:^|\\s)' + normOther.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)');
          if ((wb.test(ingName) || ingName === normOther) && !deps[section.name].includes(otherName))
            deps[section.name].push(otherName);
        });
      });
    });
  });

  const sectionMap = Object.fromEntries(sections.map((s: any) => [s.name, s]));
  const endO: Record<string, number> = {};
  const startO: Record<string, number> = {};
  const stepDur = (st: any): number => {
    const min = parseInt(st.duration_min), max = parseInt(st.duration_max);
    return (!isNaN(min) && !isNaN(max)) ? Math.round((min + max) / 2) : (parseInt(st.duration) || 0);
  };
  function calcEnd(name: string, vis = new Set<string>()): number {
    if (name in endO) return endO[name];
    if (vis.has(name)) return 0;
    vis.add(name);
    const dependents = phaseNames.filter(n => deps[n]?.includes(name));
    endO[name] = dependents.length === 0 ? 0 : Math.min(...dependents.map(d => calcStart(d, new Set(vis))));
    return endO[name];
  }
  function calcStart(name: string, vis = new Set<string>()): number {
    if (name in startO) return startO[name];
    const dur = (sectionMap[name]?.steps || []).reduce((s: number, st: any) => s + stepDur(st), 0);
    startO[name] = calcEnd(name, vis) + dur;
    return startO[name];
  }
  phaseNames.forEach(n => calcStart(n));
  const totalDur = Math.max(...phaseNames.map(n => startO[n] || 0));

  // Aktionszeitpunkte sammeln (relativ zum Planstart)
  const actions: { start: number; end: number }[] = [];
  sections.forEach((section: any) => {
    const sectionRelStart = totalDur - (startO[section.name] || 0);
    let t = sectionRelStart;
    (section.steps || []).forEach((step: any) => {
      const dur = stepDur(step);
      const isRest = step.type === 'Warten' || step.type === 'Kühl' || step.type === 'Ruhen';
      if (!isRest) actions.push({ start: t, end: t + dur });
      t += dur;
    });
  });

  if (actions.length === 0) return true;
  actions.sort((a, b) => a.start - b.start);

  // Größte Lücke zwischen aufeinanderfolgenden Aktionen
  let maxGap = actions[0].start;
  for (let i = 1; i < actions.length; i++) {
    const gap = actions[i].start - actions[i - 1].end;
    if (gap > maxGap) maxGap = gap;
  }
  const lastGap = totalDur - actions[actions.length - 1].end;
  if (lastGap > maxGap) maxGap = lastGap;

  return maxGap >= minGapMinutes;
}

// ── FILTER DEFINITIONEN ──────────────────────────────────────
const FILTER_GROUPS = [
  {
    id: 'kategorie',
    label: 'Kategorie',
    exclusive: true,
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
      { id: 'f_vollkorn',        label: 'Vollkorn',        type: 'filter', value: 'Vollkorn' },
      { id: 'f_uebernacht',      label: 'Übernacht',       type: 'filter', value: 'Uebernacht' },
      { id: 'f_schnell',         label: 'Unter 4h',        type: 'filter', value: 'Schnell' },
      { id: 'f_arbeitstauglich', label: 'Arbeitstauglich', type: 'client', value: 'Arbeitstauglich' },
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
const WORK_GAP_MINUTES = 8 * 60; // 8h aktionsfreie Lücke

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [recipes, setRecipes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
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
  const activeClientFilters = useMemo(() => {
    const f = searchParams.get('client');
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

  const toggleFilter = (type: string, value: string) => {
    if (type === 'category') {
      updateParams({ category: activeCategory === value ? null : value });
    } else if (type === 'client') {
      const next = activeClientFilters.includes(value)
        ? activeClientFilters.filter(f => f !== value)
        : [...activeClientFilters, value];
      updateParams({ client: next.length > 0 ? next.join(',') : null });
    } else {
      const next = activeFilters.includes(value)
        ? activeFilters.filter(f => f !== value)
        : [...activeFilters, value];
      updateParams({ filter: next.length > 0 ? next.join(',') : null });
    }
  };

  const isChecked = (type: string, value: string) => {
    if (type === 'category') return activeCategory === value;
    if (type === 'client') return activeClientFilters.includes(value);
    return activeFilters.includes(value);
  };

  const activeCount = (activeCategory ? 1 : 0) + activeFilters.length + activeClientFilters.length;
  const clearAll = () => updateParams({ category: null, filter: null, client: null, q: null });

  // Suche ausführen (Server-Filter)
  const fetchRecipes = useCallback(async () => {
    const hasAnyFilter = searchQuery || activeCategory || activeFilters.length > 0 || activeClientFilters.length > 0;
    if (!hasAnyFilter) { setRecipes([]); setHasSearched(false); return; }

    setIsLoading(true);
    setLoadError(false);
    setHasSearched(true);
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (activeCategory) params.set('category', activeCategory);
    if (activeFilters.length > 0) params.set('filter', activeFilters.join(','));
    // Client-Filter allein (z.B. nur "Arbeitstauglich" ohne andere Filter)
    // → alle Rezepte laden, dann clientseitig filtern
    if (!searchQuery && !activeCategory && activeFilters.length === 0 && activeClientFilters.length > 0) {
      // Kein Server-Filter → alle laden
    }

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
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, activeCategory, activeFilters, activeClientFilters]);

  useEffect(() => { fetchRecipes(); }, [fetchRecipes]);

  // Client-seitiger Filter: Arbeitstauglich
  const filteredRecipes = useMemo(() => {
    let result = recipes;
    if (activeClientFilters.includes('Arbeitstauglich')) {
      result = result.filter(r => hasLongActionFreeGap(r.dough_sections || [], WORK_GAP_MINUTES));
    }
    return result;
  }, [recipes, activeClientFilters]);

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

  const visibleRecipes = filteredRecipes.slice(0, visibleCount);
  const hasMore = visibleCount < filteredRecipes.length;

  return (
    <div className="min-h-screen bg-[#F4F7F8] dark:bg-[#0F172A] text-gray-900 dark:text-gray-100 transition-colors duration-200">
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-20">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* ── FILTER SIDEBAR ── */}
          <aside className="w-full lg:w-64 flex-shrink-0">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 sticky top-40">

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

              <div className="space-y-6">
                {FILTER_GROUPS.map(group => (
                  <div key={group.id}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">
                      {group.label}
                      {'exclusive' in group && group.exclusive && (
                        <span className="text-[9px] font-normal normal-case tracking-normal text-gray-300 dark:text-gray-600 ml-1">(eine)</span>
                      )}
                    </p>
                    <div className="space-y-2">
                      {group.filters.map(f => (
                        <label key={f.id} className="flex items-center gap-3 cursor-pointer group">
                          <div
                            onClick={() => toggleFilter(f.type, f.value)}
                            className={`w-4 h-4 rounded flex items-center justify-center border-2 flex-shrink-0 transition-all ${
                              isChecked(f.type, f.value)
                                ? f.type === 'client' ? 'bg-emerald-600 border-emerald-600' : 'bg-[#8B7355] border-[#8B7355]'
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
                                ? f.type === 'client' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-[#8B7355] dark:text-[#C4A484] font-bold'
                                : 'text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200'
                            }`}
                          >
                            {f.label}
                            {f.value === 'Arbeitstauglich' && (
                              <span className="block text-[10px] font-normal text-gray-400 dark:text-gray-500 leading-tight">mind. 8h ohne Aktion</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

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
                {activeClientFilters.map(id => {
                  const label = FILTER_GROUPS.flatMap(g => g.filters).find(f => f.value === id)?.label;
                  return (
                    <span
                      key={id}
                      onClick={() => {
                        const next = activeClientFilters.filter(f => f !== id);
                        updateParams({ client: next.length > 0 ? next.join(',') : null });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 text-white text-xs font-bold rounded-full cursor-pointer hover:bg-emerald-700 transition-colors"
                    >
                      {label ?? id}
                      <X size={11} />
                    </span>
                  );
                })}
              </div>
            )}

            {isLoading ? (
              <RecipeGridSkeleton count={6} />
            ) : loadError ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-16 text-center border border-gray-100 dark:border-gray-700">
                <RefreshCw className="text-gray-300 dark:text-gray-600 mx-auto mb-4" size={40} />
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Laden fehlgeschlagen</h2>
                <p className="text-gray-400 dark:text-gray-500 mt-2 mb-6 text-sm">Prüfe deine Verbindung und versuch es nochmal.</p>
                <button
                  onClick={fetchRecipes}
                  className="inline-flex items-center gap-2 bg-[#8B7355] text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-[#766248] transition-colors"
                >
                  <RefreshCw size={14} /> Nochmal versuchen
                </button>
              </div>
            ) : !hasSearched ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-16 text-center border border-gray-100 dark:border-gray-700">
                <Search className="text-gray-200 dark:text-gray-700 mx-auto mb-4" size={40} />
                <p className="text-gray-400 dark:text-gray-500 font-medium">Filter wählen oder Suchbegriff eingeben</p>
              </div>
            ) : filteredRecipes.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-16 text-center border border-gray-100 dark:border-gray-700">
                <BookOpen className="text-gray-200 dark:text-gray-700 mx-auto mb-4" size={40} />
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Keine Rezepte gefunden</h2>
                <p className="text-gray-400 dark:text-gray-500 mt-2 text-sm">
                  {activeClientFilters.includes('Arbeitstauglich') && recipes.length > 0
                    ? `${recipes.length} Rezepte passen auf die Server-Filter, aber keines hat eine 8h+ aktionsfreie Lücke.`
                    : 'Versuch andere Filter oder einen anderen Suchbegriff.'
                  }
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-4 font-medium">
                  {filteredRecipes.length} {filteredRecipes.length === 1 ? 'Rezept' : 'Rezepte'} gefunden
                  {activeClientFilters.includes('Arbeitstauglich') && filteredRecipes.length !== recipes.length && (
                    <span className="text-emerald-500"> (von {recipes.length} gefiltert)</span>
                  )}
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