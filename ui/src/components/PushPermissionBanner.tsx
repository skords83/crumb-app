// src/components/PushPermissionBanner.tsx
"use client";

import React, { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { getPushState, subscribeToPush, isPushSupported } from '@/lib/push';

const DISMISS_KEY = 'crumb_push_banner_dismissed';

export default function PushPermissionBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    if (typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY)) return;

    getPushState().then((s) => {
      // Nur wenn der User Push prinzipiell aktivieren *könnte* und noch nicht
      // subscribed ist. 'denied' und 'subscribed' zeigen wir explizit nicht.
      if (s === 'default' || s === 'granted') setVisible(true);
    });
  }, []);

  const dismissPermanent = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
    setVisible(false);
  };

  const handleActivate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await subscribeToPush();
      dismissPermanent();
    } catch (err) {
      console.error('Push subscribe error:', err);
      // Bei Fehler nur ausblenden, kein localStorage-Flag —
      // User kann's beim nächsten Reload nochmal über den Banner versuchen,
      // oder jederzeit über das User-Menu.
      setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="mb-4 bg-white dark:bg-white/5 rounded-2xl p-4 flex items-start gap-3 border border-[#EDE5D6] dark:border-white/10 shadow-sm">
      <div className="w-9 h-9 bg-[#F5F0E8] dark:bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
        <Bell size={18} className="text-[#8B7355]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-extrabold text-[#2C1A0E] dark:text-white/90">
          Verpasse keinen Schritt
        </div>
        <div className="text-[12px] text-[#6A5A48] dark:text-white/50 mt-1 mb-3 leading-relaxed">
          Push-Benachrichtigungen erinnern dich an Aktionen und Backstart — auch wenn die App nicht offen ist.
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleActivate}
            disabled={busy}
            className="px-4 py-1.5 bg-[#8B7355] hover:bg-[#7A6347] text-white rounded-lg text-[12px] font-bold transition-colors disabled:opacity-50"
          >
            {busy ? 'Aktiviere…' : 'Aktivieren'}
          </button>
          <button
            onClick={dismissPermanent}
            className="px-3 py-1.5 text-[#6A5A48] dark:text-white/50 hover:text-[#5C3D1E] dark:hover:text-white/70 text-[12px] font-bold transition-colors"
          >
            Später
          </button>
        </div>
      </div>
      <button
        onClick={dismissPermanent}
        aria-label="Schließen"
        className="text-[#C4A484] dark:text-white/30 hover:text-[#5C3D1E] dark:hover:text-white/60 p-1 flex-shrink-0 transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}