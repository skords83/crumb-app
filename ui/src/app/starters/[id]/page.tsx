"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Droplets } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { healthColor, timeSinceFeeding } from '@/lib/starter-health';

export default function StarterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [starter, setStarter] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [flourGrams, setFlourGrams] = useState(50);
  const [waterGrams, setWaterGrams] = useState(50);
  const [discardGrams, setDiscardGrams] = useState<number | ''>('');
  const [temperature, setTemperature] = useState<number | ''>('');
  const [activityRating, setActivityRating] = useState(7);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setIsLoading(true);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/${id}`)
      .then(res => { if (!res.ok) throw new Error('nicht gefunden'); return res.json(); })
      .then(data => { setStarter(data); setIsLoading(false); })
      .catch(() => { setIsLoading(false); setStarter(null); });
  };

  useEffect(() => { if (id) load(); }, [id]);

  const handleFeed = async () => {
    setIsSubmitting(true);
    setError('');
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/${id}/feedings`, {
        method: 'POST',
        body: JSON.stringify({
          flour_grams: flourGrams,
          water_grams: waterGrams,
          discard_grams: discardGrams === '' ? undefined : discardGrams,
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
      setDiscardGrams(''); setTemperature(''); setNotes('');
      setIsSubmitting(false);
      load();
    } catch (err: any) {
      setError(err.message || 'Netzwerkfehler');
      setIsSubmitting(false);
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
      <div className="max-w-3xl mx-auto pt-8">
        <Link href="/starters" className="inline-flex items-center gap-2 text-sm text-[#A68B6A] dark:text-gray-400 hover:text-[#5C3D1E] dark:hover:text-gray-200 mb-6">
          <ArrowLeft size={16} /> Zurück
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6 mb-6">
          <h1 className="text-2xl font-black mb-4">{starter.name}</h1>
          <div className="h-3 rounded-full bg-[#EDE5D6] dark:bg-gray-700 overflow-hidden mb-2">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, starter.health)}%`, backgroundColor: color }} />
          </div>
          <div className="flex items-center justify-between text-sm font-bold mb-1">
            <span className="text-[#5C3D1E] dark:text-gray-300">{starter.status}</span>
            <span className="text-[#A68B6A] dark:text-gray-500">{starter.health}%</span>
          </div>
          <p className="text-xs text-[#A68B6A] dark:text-gray-500">{timeSinceFeeding(starter.feedings?.[0]?.fed_at || null)}</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-black mb-4">Fütterung protokollieren</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
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
              <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Verworfen (g, optional)</label>
              <input type="number" value={discardGrams} onChange={e => setDiscardGrams(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400 flex items-center gap-1"><Droplets size={11} /> Temperatur (°C, optional)</label>
              <input type="number" value={temperature} onChange={e => setTemperature(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="mb-3">
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Aktivität ({activityRating}/10)</label>
            <input type="range" min={1} max={10} value={activityRating} onChange={e => setActivityRating(Number(e.target.value))}
              className="mt-1 w-full accent-[#8B7355]" />
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
  );
}
