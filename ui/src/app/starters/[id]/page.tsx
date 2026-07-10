"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Droplets, Trash2, TrendingUp, Moon, Zap } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { healthColor, timeSinceFeeding } from '@/lib/starter-health';

type NextPeakPrediction = {
  source: 'historical' | 'profile_rule';
  window_start: string;
  window_end: string;
  median: string | null;
};

function formatPeakWindow(prediction: NextPeakPrediction): string {
  const start = new Date(prediction.window_start);
  const end = new Date(prediction.window_end);
  const now = new Date();

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(start) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  const dayLabel = diffDays === 0 ? 'heute' : diffDays === 1 ? 'morgen'
    : start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

  const timeLabel = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  const refPoint = prediction.median ? new Date(prediction.median) : start;
  const hoursUntil = Math.round((refPoint.getTime() - now.getTime()) / (60 * 60 * 1000));
  const relative = hoursUntil > 0 ? `in ~${hoursUntil}h` : hoursUntil === 0 ? 'jetzt' : 'überfällig';

  return `${dayLabel}, ${timeLabel(start)}–${timeLabel(end)} Uhr (${relative})`;
}

function StarterDeleteConfirmModal({
  isDeleting,
  error,
  onConfirm,
  onCancel,
}: {
  isDeleting: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6 max-w-sm w-full shadow-xl">
        <h3 className="font-black text-lg text-[#2C1A0E] dark:text-gray-100 mb-2">
          Starter wirklich löschen?
        </h3>
        <p className="text-sm text-[#A68B6A] dark:text-gray-400 mb-6">
          Diese Aktion kann nicht rückgängig gemacht werden.
        </p>
        {error && (
          <div className="text-xs text-red-600 dark:text-red-400 mb-4">{error}</div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 py-2.5 rounded-xl border border-[#D6C9B4] dark:border-gray-600 text-sm font-bold text-[#5C3D1E] dark:text-gray-300 hover:bg-[#F5F0E8] dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm font-bold text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
          >
            {isDeleting ? 'Wird gelöscht…' : 'Löschen'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StarterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [starter, setStarter] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [isChangingProfile, setIsChangingProfile] = useState(false);

  const [flourGrams, setFlourGrams] = useState(50);
  const [waterGrams, setWaterGrams] = useState(50);
  const [temperature, setTemperature] = useState<number | ''>('');
  const [activityRating, setActivityRating] = useState(7);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = () => {
    setIsLoading(true);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/${id}`)
      .then(res => { if (!res.ok) throw new Error('nicht gefunden'); return res.json(); })
      .then(data => { setStarter(data); setIsLoading(false); })
      .catch(() => { setIsLoading(false); setStarter(null); });
  };

  useEffect(() => { if (id) load(); }, [id]);

  useEffect(() => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/profiles`)
      .then(res => res.json())
      .then(data => setProfiles(Array.isArray(data) ? data : []))
      .catch(() => setProfiles([]));
  }, []);

  const handleProfileChange = async (newProfileKey: string) => {
    setIsChangingProfile(true);
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ target_profile: newProfileKey }),
      });
      if (res.ok) load();
    } finally {
      setIsChangingProfile(false);
    }
  };

  const handleFeed = async () => {
    setIsSubmitting(true);
    setError('');
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/${id}/feedings`, {
        method: 'POST',
        body: JSON.stringify({
          flour_grams: flourGrams,
          water_grams: waterGrams,
          temperature_celsius: temperature === '' ? undefined : temperature,
          activity_rating: activityRating,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Fehler beim Speichern');
        setIsSubmitting(false);
        return;
      }
      setTemperature(''); setNotes('');
      setIsSubmitting(false);
      load();
    } catch (err: any) {
      setError(err.message || 'Netzwerkfehler');
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError('');
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        setDeleteError(err.error || 'Fehler beim Löschen');
        setIsDeleting(false);
        return;
      }
      router.push('/starters');
    } catch (err: any) {
      setDeleteError(err.message || 'Netzwerkfehler');
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A]" />;
  }
  if (!starter) {
    return (
      <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] flex items-center justify-center text-[#2C1A0E] dark:text-white">
        <p>Starter nicht gefunden.</p>
      </div>
    );
  }

  const color = healthColor(starter.health);

  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] px-6 text-[#2C1A0E] dark:text-white transition-colors duration-200 pb-24">
      <div className="max-w-3xl min-[860px]:max-w-[1040px] mx-auto pt-8">
        <Link href="/starters" className="inline-flex items-center gap-2 text-sm text-[#A68B6A] dark:text-gray-400 hover:text-[#5C3D1E] dark:hover:text-gray-200 mb-6">
          <ArrowLeft size={16} /> Zurück
        </Link>

        <div className="grid grid-cols-1 min-[860px]:grid-cols-[380px_1fr] gap-6 min-[860px]:items-start">
        <div className="flex flex-col gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-black">{starter.name}</h1>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="Starter löschen"
              className="p-2 rounded-xl text-[#A68B6A] dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
          <div className="h-3 rounded-full bg-[#EDE5D6] dark:bg-gray-700 overflow-hidden mb-2">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, starter.health)}%`, backgroundColor: color }} />
          </div>
          <div className="flex items-center justify-between text-sm font-bold mb-1">
            <span className="text-[#5C3D1E] dark:text-gray-300">{starter.status}</span>
            <span className="text-[#A68B6A] dark:text-gray-500">{starter.health}%</span>
          </div>
          <p className="text-xs text-[#A68B6A] dark:text-gray-500">{timeSinceFeeding(starter.feedings?.[0]?.fed_at || null)}</p>
          <p className="text-xs text-[#A68B6A] dark:text-gray-500 mt-2">
            {starter.plan_adherence != null ? `Plantreue: ${starter.plan_adherence}%` : 'Plantreue: Noch nicht genug Daten'}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-black">Zielprofil</h2>
            <select
              value={starter.target_profile}
              disabled={isChangingProfile}
              onChange={(e) => handleProfileChange(e.target.value)}
              className="bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-1.5 text-sm font-bold"
            >
              {profiles.map((p) => (
                <option key={p.profile_key} value={p.profile_key}>{p.label_de}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#A68B6A] dark:text-gray-500">Intervall</div>
              <div className="text-sm font-bold text-[#5C3D1E] dark:text-gray-300">
                alle {starter.feeding_interval_hours_min}–{starter.feeding_interval_hours_max}h
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#A68B6A] dark:text-gray-500">Verhältnis</div>
              <div className="text-sm font-bold text-[#5C3D1E] dark:text-gray-300">{starter.ratio_starter_flour_water}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#A68B6A] dark:text-gray-500">Temperatur</div>
              <div className="text-sm font-bold text-[#5C3D1E] dark:text-gray-300">
                {starter.target_temp_min}–{starter.target_temp_max}°C
              </div>
            </div>
          </div>
          {starter.next_peak_prediction && (
            <div className="mb-3 rounded-xl bg-[#F5F0E8] dark:bg-gray-900 border border-[#D6C9B4] dark:border-gray-700 p-3">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp size={14} className="text-[#8B7355] dark:text-gray-400" />
                <span className="text-sm font-bold text-[#5C3D1E] dark:text-gray-300">
                  {formatPeakWindow(starter.next_peak_prediction)}
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-widest text-[#A68B6A] dark:text-gray-500">
                {starter.next_peak_prediction.source === 'historical'
                  ? 'Basierend auf deinen letzten Fütterungen'
                  : 'Richtwert laut Zielprofil'}
              </p>
            </div>
          )}
          <p className="text-xs text-[#A68B6A] dark:text-gray-500 border-t border-[#EDE5D6] dark:border-gray-700 pt-3">
            {profiles.find((p) => p.profile_key === starter.target_profile)?.description_de}
          </p>
        </div>
        </div>

        <div className="flex flex-col gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6">
          <h2 className="text-lg font-black mb-4">Fütterung protokollieren</h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Mehl (g)</label>
              <input type="number" value={flourGrams} onChange={e => setFlourGrams(Number(e.target.value) || 0)}
                className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Wasser (g)</label>
              <input type="number" value={waterGrams} onChange={e => setWaterGrams(Number(e.target.value) || 0)}
                className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400 flex items-center gap-1"><Droplets size={11} /> Temp. (°C)</label>
              <input type="number" value={temperature} onChange={e => setTemperature(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="mb-3">
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Aktivität ({activityRating}/10)</label>
            <input type="range" min={1} max={10} value={activityRating} onChange={e => setActivityRating(Number(e.target.value))}
              className="mt-1 w-full accent-[#8B7355]" />
            <div className="flex items-center justify-between mt-2 px-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-6 h-6 rounded-full bg-[#F5F0E8] dark:bg-gray-900 border border-[#D6C9B4] dark:border-gray-700 flex items-center justify-center">
                  <Moon size={12} className="text-[#8B7355] dark:text-gray-400" />
                </span>
                <span className="text-[10px] uppercase tracking-widest text-[#A68B6A] dark:text-gray-500">ruhig</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-[#A68B6A] dark:text-gray-500">aktiv</span>
                <span className="w-6 h-6 rounded-full bg-[#F5F0E8] dark:bg-gray-900 border border-[#D6C9B4] dark:border-gray-700 flex items-center justify-center">
                  <Zap size={12} className="text-[#8B7355] dark:text-gray-400" />
                </span>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Notizen (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
          </div>

          {error && <div className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</div>}

          <button onClick={handleFeed} disabled={isSubmitting}
            className="w-full py-3 rounded-xl text-sm font-bold bg-[#8B7355] text-white disabled:opacity-50">
            {isSubmitting ? 'Wird gespeichert…' : 'Fütterung speichern'}
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6">
          <h2 className="text-lg font-black mb-4">Fütterungshistorie</h2>
          {(!starter.feedings || starter.feedings.length === 0) ? (
            <p className="text-sm text-[#A68B6A] dark:text-gray-500">Noch keine Fütterungen protokolliert.</p>
          ) : (
            <div className="space-y-2">
              {starter.feedings.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between text-sm border-b border-[#EDE5D6] dark:border-gray-700 pb-2 last:border-0">
                  <span className="text-[#2C1A0E] dark:text-gray-200">{f.flour_grams}g Mehl / {f.water_grams}g Wasser</span>
                  <span className="text-[#A68B6A] dark:text-gray-500 text-xs">{new Date(f.fed_at).toLocaleString('de-DE')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
        </div>

        {showDeleteConfirm && (
          <StarterDeleteConfirmModal
            isDeleting={isDeleting}
            error={deleteError}
            onConfirm={handleDelete}
            onCancel={() => { setShowDeleteConfirm(false); setDeleteError(''); }}
          />
        )}
      </div>
    </div>
  );
}
