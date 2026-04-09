'use client';

export function RecipeCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden flex flex-col relative border border-[#D6C9B4] dark:border-gray-700 shadow-sm animate-pulse">
      <div className="relative aspect-[4/3] bg-[#EDE5D6] dark:bg-gray-700">
        <div className="absolute inset-0 bg-gradient-to-r from-[#EDE5D6] via-[#E5DAC8] to-[#EDE5D6] dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-shimmer" />
      </div>
      <div className="p-5 flex flex-col flex-grow">
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="h-6 w-16 bg-[#EDE5D6] dark:bg-gray-700 rounded-full" />
          <div className="h-6 w-20 bg-[#EDE5D6] dark:bg-gray-700 rounded-full" />
        </div>
        <div className="h-7 w-3/4 bg-[#EDE5D6] dark:bg-gray-700 rounded mb-2" />
        <div className="h-4 w-full bg-[#EDE5D6] dark:bg-gray-700 rounded mb-1" />
        <div className="h-4 w-2/3 bg-[#EDE5D6] dark:bg-gray-700 rounded mb-4" />
        <div className="mt-auto pt-4 border-t border-[#EDE5D6] dark:border-gray-700">
          <div className="flex gap-2">
            <div className="h-10 flex-1 bg-[#EDE5D6] dark:bg-gray-700 rounded-xl" />
            <div className="h-10 flex-1 bg-[#EDE5D6] dark:bg-gray-700 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function RecipeGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {Array.from({ length: count }).map((_, i) => (
        <RecipeCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] px-6 text-[#2C1A0E] dark:text-gray-100 transition-colors duration-200">
      <div className="max-w-6xl mx-auto pt-8 pb-20">
        <div className="space-y-6 mb-10">
          <div className="h-14 bg-white dark:bg-gray-800 rounded-2xl border-2 border-[#D6C9B4] dark:border-gray-700 animate-pulse" />
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-24 bg-white dark:bg-gray-800 rounded-xl border-2 border-[#D6C9B4] dark:border-gray-700 animate-pulse flex-shrink-0"
              />
            ))}
          </div>
        </div>
        <RecipeGridSkeleton count={6} />
      </div>
    </div>
  );
}

export function RecipeDetailSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] py-8 px-4 animate-pulse">
      <div className="max-w-4xl mx-auto">
        {/* Hero image — passend zur neuen Rezeptdetail-Seite ohne Card-Wrapper */}
        <div className="relative h-64 md:h-96 bg-[#EDE5D6] dark:bg-gray-700 rounded-[2rem] overflow-hidden mb-8">
          <div className="absolute inset-0 bg-gradient-to-r from-[#EDE5D6] via-[#E5DAC8] to-[#EDE5D6] dark:from-gray-700 dark:via-gray-600 dark:to-gray-700" />
        </div>

        <div className="space-y-6">
          {/* Beschreibung */}
          <div className="h-24 w-full bg-white dark:bg-white/[0.04] rounded-2xl border border-[#D6C9B4] dark:border-white/[0.07]" />

          {/* Info Bar */}
          <div className="h-20 w-full bg-white dark:bg-white/[0.04] rounded-2xl border border-[#D6C9B4] dark:border-white/[0.07]" />

          {/* Phasen */}
          <div className="space-y-3">
            <div className="h-8 w-48 bg-[#EDE5D6] dark:bg-white/[0.06] rounded" />
            <div className="h-48 w-full bg-white dark:bg-white/[0.04] rounded-2xl border border-[#D6C9B4] dark:border-white/[0.07]" />
            <div className="h-48 w-full bg-white dark:bg-white/[0.04] rounded-2xl border border-[#D6C9B4] dark:border-white/[0.07]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function BackplanSkeleton() {
  return (
    <div className="min-h-screen bg-[#0F172A] pb-32 animate-pulse">
      <div className="max-w-3xl mx-auto px-4 pt-4">
        {/* Sticky Header Skeleton */}
        <div className="bg-[#0F172A] border-b border-white/[0.07] px-4 py-4 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.06]" />
            <div className="flex-1">
              <div className="h-5 w-48 bg-white/[0.06] rounded mb-1.5" />
              <div className="h-3 w-32 bg-white/[0.04] rounded" />
            </div>
            <div className="h-8 w-16 bg-white/[0.06] rounded-xl" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-16 h-2 bg-white/[0.04] rounded" />
              <div className="flex-1 h-[3px] bg-white/[0.06] rounded" />
            </div>
            <div className="flex items-center gap-2">
              <div className="w-16 h-2 bg-white/[0.04] rounded" />
              <div className="flex-1 h-[3px] bg-white/[0.06] rounded" />
            </div>
          </div>
        </div>

        {/* Active Card Skeleton */}
        <div className="h-36 bg-white/[0.04] rounded-2xl border border-white/[0.07] mb-4" />

        {/* Phase Skeletons */}
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-7 h-7 rounded-full bg-white/[0.06]" />
                <div className="h-4 w-32 bg-white/[0.06] rounded" />
                <div className="h-3 w-8 bg-white/[0.04] rounded ml-auto" />
              </div>
              <div className="space-y-2 pl-10">
                <div className="h-10 bg-white/[0.03] rounded-xl border border-white/[0.05]" />
                <div className="h-10 bg-white/[0.03] rounded-xl border border-white/[0.05]" />
                <div className="h-10 bg-white/[0.03] rounded-xl border border-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}