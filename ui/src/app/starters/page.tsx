"use client";

import { useEffect, useState } from 'react';
import { Plus, Sprout, RefreshCw } from 'lucide-react';
import StarterCard from '@/components/StarterCard';
import NewStarterModal from '@/components/NewStarterModal';
import { apiFetch } from '@/lib/api';

export default function StartersPage() {
  const [starters, setStarters] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);

  const load = () => {
    setIsLoading(true);
    setLoadError(false);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters`)
      .then(res => res.json())
      .then(data => { setStarters(Array.isArray(data) ? data : []); setIsLoading(false); })
      .catch(() => { setLoadError(true); setIsLoading(false); });
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] px-6 text-[#2C1A0E] dark:text-white transition-colors duration-200">
      <div className="max-w-6xl mx-auto pt-8 pb-20">
        <h1 className="text-2xl font-black mb-6">Meine Starter</h1>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => <div key={i} className="h-48 rounded-2xl bg-white/50 dark:bg-gray-800/50 animate-pulse" />)}
          </div>
        ) : loadError ? (
          <div className="bg-white dark:bg-gray-800 rounded-[3rem] p-20 text-center border border-[#D6C9B4] dark:border-gray-700">
            <RefreshCw className="text-[#D6C9B4] dark:text-gray-600 mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-[#2C1A0E] dark:text-gray-100">Laden fehlgeschlagen</h2>
            <p className="text-[#A68B6A] dark:text-gray-500 mt-2 mb-6">Prüfe deine Verbindung und versuch es nochmal.</p>
            <button onClick={load} className="inline-flex items-center gap-2 bg-[#8B7355] text-white px-6 py-3 rounded-2xl font-bold text-sm hover:bg-[#766248] transition-colors">
              <RefreshCw size={16} /> Nochmal versuchen
            </button>
          </div>
        ) : starters.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-[3rem] p-20 text-center border border-[#D6C9B4] dark:border-gray-700">
            <Sprout className="text-[#D6C9B4] dark:text-gray-700 mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-[#2C1A0E] dark:text-gray-100">Noch kein Starter angelegt</h2>
            <p className="text-[#A68B6A] dark:text-gray-500 mt-2">Leg deinen ersten Sauerteig-Starter an, um sein Fütterungsprotokoll zu verfolgen.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {starters.map(s => <StarterCard key={s.id} starter={s} />)}
          </div>
        )}
      </div>

      <button
        onClick={() => setShowNewModal(true)}
        className="fixed bottom-24 right-6 md:bottom-10 md:right-10 z-40 bg-[#8B7355] text-white p-5 rounded-2xl shadow-2xl hover:scale-110 active:scale-95 transition-all"
      >
        <Plus size={24} strokeWidth={3} />
      </button>

      <NewStarterModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={() => load()}
      />
    </div>
  );
}
