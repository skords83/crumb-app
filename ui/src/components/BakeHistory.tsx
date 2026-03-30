// ui/src/components/BakeHistory.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Clock, ThermometerSun, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { type BakeHistoryEntry, type RecipeStats, formatDuration } from '@/lib/backplan-utils';

const API = process.env.NEXT_PUBLIC_API_URL;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

interface BakeHistoryProps {
  recipeId: number;
}

export default function BakeHistory({ recipeId }: BakeHistoryProps) {
  const [stats, setStats] = useState<RecipeStats | null>(null);
  const [history, setHistory] = useState<BakeHistoryEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const headers = { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` };

    // Stats laden
    fetch(`${API}/bake-sessions/recipe-stats/${recipeId}`, { headers })
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});

    // History laden
    fetch(`${API}/bake-sessions/history?recipe_id=${recipeId}`, { headers })
      .then(r => r.json())
      .then(data => { setHistory(Array.isArray(data) ? data : []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, [recipeId]);

  if (isLoading || !stats || stats.bake_count === 0) return null;

  return (
    <div className="mt-6">
      {/* Stats Summary */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-[#F5F0E8] dark:bg-gray-800 border border-[#E8E2D8] dark:border-gray-700 transition-colors hover:bg-[#EDE5D8] dark:hover:bg-gray-700"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#8B7355]/10 flex items-center justify-center">
            <Clock size={14} className="text-[#8B7355]" />
          </div>
          <div className="text-left">
            <p className="text-[13px] font-bold text-gray-800 dark:text-gray-100">
              {stats.bake_count}× gebacken
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {stats.last_baked && `Zuletzt ${formatDate(stats.last_baked)}`}
              {stats.avg_duration_minutes && ` · Ø ${formatDuration(stats.avg_duration_minutes)}`}
            </p>
          </div>
        </div>
        {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {/* History List */}
      {isExpanded && history.length > 0 && (
        <div className="mt-2 space-y-2">
          {history.map(entry => {
            const temps = (entry.temperature_log || []).filter((t: any) => t.temp_c);
            const avgTemp = temps.length > 0
              ? (temps.reduce((s: number, t: any) => s + t.temp_c, 0) / temps.length).toFixed(1)
              : null;

            return (
              <div key={entry.id} className="px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-[#F0EBE3] dark:border-gray-700">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <span className="text-[12px] font-bold text-gray-800 dark:text-gray-100">
                      {formatDateShort(entry.finished_at)}
                    </span>
                    {entry.multiplier !== 1 && (
                      <span className="ml-2 text-[10px] font-bold text-[#8B7355] bg-[#8B7355]/10 px-1.5 py-0.5 rounded">
                        {entry.multiplier}×
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-400">
                    {entry.total_actual_duration > 0 && formatDuration(Math.round(entry.total_actual_duration / 60))}
                  </span>
                </div>

                {/* Temperature */}
                {avgTemp && (
                  <div className="flex items-center gap-1 mb-1">
                    <ThermometerSun size={11} className="text-blue-500" />
                    <span className="text-[11px] text-blue-500 font-bold">Ø {avgTemp}°C</span>
                  </div>
                )}

                {/* Notes */}
                {entry.notes && (
                  <div className="flex items-start gap-1.5 mt-1">
                    <FileText size={11} className="text-gray-400 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{entry.notes}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
