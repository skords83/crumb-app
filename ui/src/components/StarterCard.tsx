"use client";

import Link from 'next/link';
import { Wheat, Clock } from 'lucide-react';
import { healthColor, timeSinceFeeding } from '@/lib/starter-health';

interface Starter {
  id: number;
  name: string;
  flour_type: string;
  target_profile_label: string;
  health: number;
  status: string;
  last_fed_at: string | null;
}

const FLOUR_LABELS: Record<string, string> = {
  weizen: 'Weizen',
  roggen: 'Roggen',
  dinkel: 'Dinkel',
  vollkorn: 'Vollkorn',
};

export default function StarterCard({ starter }: { starter: Starter }) {
  const color = healthColor(starter.health);
  return (
    <Link
      href={`/starters/${starter.id}`}
      className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden flex flex-col relative border border-[#D6C9B4] dark:border-gray-700 p-5 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-8px_rgba(92,61,30,0.2)] dark:hover:shadow-[0_10px_30px_-6px_rgba(0,0,0,0.5)] hover:border-[#8B7355]/40 dark:hover:border-gray-600 active:scale-[0.98]"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-lg font-black text-[#2C1A0E] dark:text-gray-100 truncate">{starter.name}</h3>
        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border bg-[#EDE5D6] dark:bg-gray-700 text-[#8B7355] dark:text-[#C4A484] border-[#D6C9B4] dark:border-gray-600 whitespace-nowrap flex-shrink-0">
          {FLOUR_LABELS[starter.flour_type] || starter.flour_type}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-[#A68B6A] dark:text-gray-500 mb-3">
        <Wheat size={12} />
        <span>{starter.target_profile_label}</span>
      </div>

      <div className="mb-2">
        <div className="h-2 rounded-full bg-[#EDE5D6] dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(4, starter.health)}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-[12px] font-bold mb-3">
        <span className="text-[#5C3D1E] dark:text-gray-300">{starter.status}</span>
        <span className="text-[#A68B6A] dark:text-gray-500">{starter.health}%</span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-[#A68B6A] dark:text-gray-500 mt-auto pt-2 border-t border-[#EDE5D6] dark:border-gray-700">
        <Clock size={12} />
        <span>{timeSinceFeeding(starter.last_fed_at)}</span>
      </div>
    </Link>
  );
}
