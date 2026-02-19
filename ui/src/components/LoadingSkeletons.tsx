'use client';

export function RecipeCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden flex flex-col relative border border-gray-100 dark:border-gray-700 shadow-sm animate-pulse">
      {/* Image placeholder */}
      <div className="relative aspect-[4/3] bg-gray-200 dark:bg-gray-700">
        <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-shimmer" />
      </div>
      
      {/* Content */}
      <div className="p-5 flex flex-col flex-grow">
        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>
        
        {/* Title */}
        <div className="h-7 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
        
        {/* Description */}
        <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded mb-1" />
        <div className="h-4 w-2/3 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        
        {/* Footer */}
        <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-700">
          <div className="flex gap-2">
            <div className="h-10 flex-1 bg-gray-200 dark:bg-gray-700 rounded-xl" />
            <div className="h-10 flex-1 bg-gray-200 dark:bg-gray-700 rounded-xl" />
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
    <div className="min-h-screen bg-[#F4F7F8] dark:bg-[#0F172A] px-6 text-gray-900 dark:text-gray-100 transition-colors duration-200">
      <div className="max-w-6xl mx-auto pt-8 pb-20">
        {/* Search bar skeleton */}
        <div className="space-y-6 mb-10">
          <div className="h-14 bg-white dark:bg-gray-800 rounded-2xl border-2 border-gray-100 dark:border-gray-700 animate-pulse" />
          
          {/* Filter buttons skeleton */}
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div 
                key={i} 
                className="h-10 w-24 bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-100 dark:border-gray-700 animate-pulse flex-shrink-0"
              />
            ))}
          </div>
        </div>
        
        {/* Grid skeleton */}
        <RecipeGridSkeleton count={6} />
      </div>
    </div>
  );
}

export function RecipeDetailSkeleton() {
  return (
    <div className="min-h-screen bg-[#F8F9FA] dark:bg-gray-900 py-8 px-4 animate-pulse">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-[2rem] shadow-xl overflow-hidden border border-gray-100 dark:border-gray-700">
        {/* Hero image */}
        <div className="relative h-64 md:h-96 bg-gray-200 dark:bg-gray-700">
          <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700" />
        </div>
        
        {/* Content */}
        <div className="p-8 md:p-12">
          {/* Title */}
          <div className="h-10 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
          
          {/* Tags */}
          <div className="flex flex-wrap gap-2 mb-6">
            <div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
            <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded-full" />
            <div className="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded-full" />
          </div>
          
          {/* Description */}
          <div className="space-y-2 mb-8">
            <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-4 w-2/3 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
          
          {/* Sections */}
          <div className="space-y-6">
            <div className="h-8 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="space-y-3">
              <div className="h-16 w-full bg-gray-100 dark:bg-gray-700 rounded-xl" />
              <div className="h-16 w-full bg-gray-100 dark:bg-gray-700 rounded-xl" />
              <div className="h-16 w-full bg-gray-100 dark:bg-gray-700 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BackplanSkeleton() {
  return (
    <div className="min-h-screen bg-[#FDFCFB] dark:bg-gray-900 pb-32 animate-pulse">
      <div className="max-w-6xl mx-auto px-4 pt-8">
        {/* Header */}
        <div className="mb-8">
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
          <div className="h-4 w-64 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        
        {/* Timeline */}
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="w-24 h-12 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="flex-1 h-24 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
