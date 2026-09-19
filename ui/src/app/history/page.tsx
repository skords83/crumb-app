'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { BakeHistoryEntry } from '@/lib/backplan-utils';

export default function HistoryPage() {
  const [history, setHistory] = useState<BakeHistoryEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/bake-sessions/history`);
      if (!res.ok) throw new Error('Die Backhistorie konnte nicht geladen werden.');
      setHistory(await res.json());
    } catch { setError('Die Backhistorie konnte nicht geladen werden.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <main className="max-w-3xl mx-auto px-5 py-8 pb-28">
    <Link href="/backplan" className="text-sm underline">Zum Backplan</Link>
    <h1 className="text-3xl font-bold mt-6 mb-2">Backhistorie</h1>
    <p className="text-sm mb-6">Die letzten 50 Backvorgänge – auch für entfernte Rezepte. Rezeptstände bleiben so erhalten, wie sie beim Start waren.</p>
    {loading && <p role="status">Wird geladen …</p>}
    {error && <p role="alert">{error} <button onClick={load} className="underline">Erneut versuchen</button></p>}
    {!loading && !error && !history.length && <p>Noch keine abgeschlossenen Backvorgänge.</p>}
    <div className="space-y-4">{history.map(entry => <article key={entry.id} className="rounded-2xl border border-[#D6C9B4] dark:border-white/15 p-5">
      <h2 className="font-bold text-lg">{entry.title}</h2>
      <p className="text-sm mt-1">{new Date(entry.finished_at).toLocaleString('de-DE')} · Menge × {entry.multiplier}</p>
      {entry.notes && <p className="mt-3 whitespace-pre-wrap">{entry.notes}</p>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer">Rezeptstand beim Start</summary>
        {(entry.dough_sections || []).map((section, i) => <div key={i} className="mt-3">
          <h3 className="font-bold">{section.name}</h3>
          <ul>{(section.ingredients || []).map((ing, j) => <li key={j}>{ing.amount} {ing.unit} {ing.name}</li>)}</ul>
          <ol className="list-decimal ml-5 mt-2">{(section.steps || []).map((step, j) => <li key={j}>{step.instruction}</li>)}</ol>
        </div>)}
      </details>
    </article>)}</div>
  </main>;
}
