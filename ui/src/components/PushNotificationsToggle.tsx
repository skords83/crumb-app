// src/components/PushNotificationsToggle.tsx
"use client";

import React, { useEffect, useState } from 'react';
import { Bell, BellRing, BellOff } from 'lucide-react';
import {
  getPushState,
  subscribeToPush,
  unsubscribeFromPush,
  isPushSupported,
  type PushState,
} from '@/lib/push';

export default function PushNotificationsToggle() {
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setState('unsupported');
      return;
    }
    getPushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  const handleToggle = async () => {
    if (busy) return;
    if (state === 'denied' || state === 'unsupported' || state === 'loading') return;

    setBusy(true);
    try {
      if (state === 'subscribed') {
        await unsubscribeFromPush();
        setState('granted');
      } else {
        await subscribeToPush();
        setState('subscribed');
      }
    } catch (err) {
      console.error('Push toggle error:', err);
      // State anhand der echten Browser-Permission neu ermitteln
      const next = await getPushState();
      setState(next);
    } finally {
      setBusy(false);
    }
  };

  // Wenn der Browser kein Push kann oder noch geladen wird: gar nichts rendern.
  if (state === 'unsupported' || state === 'loading') return null;

  const isOn = state === 'subscribed';
  const isBlocked = state === 'denied';

  return (
    <button
      onClick={handleToggle}
      disabled={isBlocked || busy}
      className="flex items-center justify-between w-full px-4 py-2.5 text-sm text-[#5C3D1E] dark:text-white/70 hover:bg-[#F5F0E8] dark:hover:bg-white/5 transition-colors border-b border-[#EDE5D6] dark:border-white/10 disabled:cursor-default disabled:hover:bg-transparent"
    >
      <div className="flex items-center gap-3">
        {isBlocked ? (
          <BellOff size={15} className="text-[#C4A484] dark:text-white/30" />
        ) : isOn ? (
          <BellRing size={15} className="text-[#8B7355]" />
        ) : (
          <Bell size={15} className="text-[#C4A484] dark:text-white/30" />
        )}
        <div className="text-left">
          {isBlocked ? (
            <>
              <div>Benachrichtigungen blockiert</div>
              <div className="text-[10px] text-[#A68B6A] dark:text-white/30 mt-0.5 font-normal">
                In den Browser-Einstellungen erlauben
              </div>
            </>
          ) : (
            <span>{isOn ? 'Push-Benachrichtigungen' : 'Benachrichtigungen aktivieren'}</span>
          )}
        </div>
      </div>
      {!isBlocked && (
        <div
          className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${
            isOn ? 'bg-[#8B7355]' : 'bg-[#D6C9B4] dark:bg-white/10'
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              isOn ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </div>
      )}
    </button>
  );
}