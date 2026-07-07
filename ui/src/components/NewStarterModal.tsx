"use client";

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface Profile {
  profile_key: string;
  label_de: string;
}

interface NewStarterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (starter: any) => void;
}

const FLOUR_OPTIONS = [
  { value: 'weizen', label: 'Weizen' },
  { value: 'roggen', label: 'Roggen' },
  { value: 'dinkel', label: 'Dinkel' },
  { value: 'vollkorn', label: 'Vollkorn' },
];

export default function NewStarterModal({ isOpen, onClose, onCreated }: NewStarterModalProps) {
  const [name, setName] = useState('');
  const [flourType, setFlourType] = useState('weizen');
  const [hydration, setHydration] = useState(100);
  const [targetProfile, setTargetProfile] = useState('ausgeglichen');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(''); setFlourType('weizen'); setHydration(100); setTargetProfile('ausgeglichen'); setError('');
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/profiles`)
      .then(res => res.json())
      .then(data => setProfiles(Array.isArray(data) ? data : []))
      .catch(() => setProfiles([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name erforderlich'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters`, {
        method: 'POST',
        body: JSON.stringify({ name, flour_type: flourType, hydration_percent: hydration, target_profile: targetProfile }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Fehler beim Anlegen');
        setIsSubmitting(false);
        return;
      }
      const created = await res.json();
      onCreated(created);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Netzwerkfehler');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-[#2C1A0E] dark:text-gray-100">Neuer Starter</h2>
          <button onClick={onClose} className="text-[#A68B6A] dark:text-gray-500 hover:text-[#5C3D1E] dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="z.B. Anton"
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-[#2C1A0E] dark:text-gray-100 outline-none focus:border-[#8B7355]/50"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Mehlsorte</label>
            <select
              value={flourType}
              onChange={e => setFlourType(e.target.value)}
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-[#2C1A0E] dark:text-gray-100"
            >
              {FLOUR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Hydration (%)</label>
            <input
              type="number"
              value={hydration}
              onChange={e => setHydration(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-[#2C1A0E] dark:text-gray-100"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Zielprofil</label>
            <select
              value={targetProfile}
              onChange={e => setTargetProfile(e.target.value)}
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-[#2C1A0E] dark:text-gray-100"
            >
              {profiles.map(p => <option key={p.profile_key} value={p.profile_key}>{p.label_de}</option>)}
            </select>
          </div>

          {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#8B7355] dark:text-gray-400 border-2 border-[#D6C9B4] dark:border-gray-700">
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[#8B7355] text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Wird angelegt…' : 'Anlegen'}
          </button>
        </div>
      </div>
    </div>
  );
}
