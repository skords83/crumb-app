// ui/src/components/BakeHistory.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Clock, FileText, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { type BakeHistoryEntry, type RecipeStats, formatDuration } from '@/lib/backplan-utils';

const API = process.env.NEXT_PUBLIC_API_URL;
const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('crumb_token')}`,
});

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
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const loadData = () => {
    const headers = { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` };

    fetch(`${API}/bake-sessions/recipe-stats/${recipeId}`, { headers })
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});

    fetch(`${API}/bake-sessions/history?recipe_id=${recipeId}`, { headers })
      .then(r => r.json())
      .then(data => { setHistory(Array.isArray(data) ? data : []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  };

  useEffect(() => { loadData(); }, [recipeId]);

  const deleteEntry = async (sessionId: number) => {
    try {
      const res = await fetch(`${API}/bake-sessions/${sessionId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        setHistory(prev => prev.filter(e => e.id !== sessionId));
        setStats(prev => prev ? { ...prev, bake_count: Math.max(0, prev.bake_count - 1) } : prev);
        setDeleteConfirmId(null);
      }
    } catch { /* silent */ }
  };

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
          {history.map(entry => (
            <div key={entry.id} className="px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-[#F0EBE3] dark:border-gray-700 group">
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-bold text-gray-800 dark:text-gray-100">
                    {formatDateShort(entry.finished_at)}
                  </span>
                  {entry.multiplier !== 1 && (
                    <span className="text-[10px] font-bold text-[#8B7355] bg-[#8B7355]/10 dark:bg-[#8B7355]/20 px-1.5 py-0.5 rounded">
                      {entry.multiplier}×
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {entry.total_actual_duration > 0 && formatDuration(Math.round(entry.total_actual_duration / 60))}
                  </span>
                  {/* Delete button */}
                  {deleteConfirmId === entry.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => deleteEntry(entry.id)}
                        className="text-[10px] font-bold text-red-500 hover:text-red-600 px-2 py-0.5 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 transition-colors">
                        Löschen
                      </button>
                      <button onClick={() => setDeleteConfirmId(null)}
                        className="text-[10px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1.5 py-0.5 transition-colors">
                        ×
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirmId(entry.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-300 dark:text-gray-600 hover:text-red-400">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Notes */}
              {entry.notes && (
                <div className="flex items-start gap-1.5 mt-1">
                  <FileText size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{entry.notes}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}