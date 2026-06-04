'use client';

// app/profile/notifications/page.tsx
// ============================================================
// NOTIFICATION SETTINGS — Variante A (Karten-Layout)
//
// Verwaltet User-Präferenzen für Push-Benachrichtigungen:
//   - Master-Toggle (Push an/aus)
//   - 4 Trigger-Toggles (Schritt fällig, Vorheizen, Backen fertig, Backplan fertig)
//   - 2 Vorlauf-Slider (Heads-Up, Vorheiz-Vorlauf)
//   - Stille-Stunden mit Zeitbereich
//   - Test-Push-Button
//   - Subscription-Status für dieses Gerät
//
// Backend-Endpoints:
//   GET  /api/notification-settings
//   PUT  /api/notification-settings
//   GET  /api/push/status
//   POST /api/push/test
//   GET  /api/push/vapid-key
//   POST /api/push/subscribe
//   DELETE /api/push/unsubscribe
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Bell, Hand, Flame, CheckCircle2, PartyPopper, Moon,
  Send, Loader2, Smartphone, AlertCircle,
} from 'lucide-react';

// ── Typen ────────────────────────────────────────────────────
interface Settings {
  master_enabled: boolean;
  step_ready_enabled: boolean;
  step_ready_vorlauf_min: number;
  preheat_enabled: boolean;
  preheat_vorlauf_min: number;
  bake_done_enabled: boolean;
  plan_done_enabled: boolean;
  quiet_enabled: boolean;
  quiet_start: string; // "HH:MM"
  quiet_end: string;
}

const DEFAULT_SETTINGS: Settings = {
  master_enabled: true,
  step_ready_enabled: true,
  step_ready_vorlauf_min: 5,
  preheat_enabled: true,
  preheat_vorlauf_min: 45,
  bake_done_enabled: true,
  plan_done_enabled: true,
  quiet_enabled: false,
  quiet_start: '22:00',
  quiet_end: '07:00',
};

// ── Helpers ──────────────────────────────────────────────────
const API = process.env.NEXT_PUBLIC_API_URL || '';
const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('crumb_token') || '' : ''}`,
});

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof window !== 'undefined' ? window.atob(base64) : '';
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// ── Toggle Component ─────────────────────────────────────────
function Toggle({ on, onChange, disabled = false }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={`relative w-[42px] h-[24px] rounded-full flex-shrink-0 transition-colors ${
        on ? 'bg-[#8B7355]' : 'bg-gray-300 dark:bg-gray-600'
      } ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-[3px] w-[18px] h-[18px] bg-white rounded-full shadow transition-transform ${
          on ? 'translate-x-[21px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

// ── Slider Component ─────────────────────────────────────────
function Slider({
  label, value, min, max, step = 1, suffix, onChange, disabled = false,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  suffix?: string; onChange: (v: number) => void; disabled?: boolean;
}) {
  const percent = max > min ? Math.round(((value - min) / (max - min)) * 100) : 0;
  return (
    <div className={`mt-3 pt-3 border-t border-[#F0EBE3] dark:border-gray-700 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-[#8B7355] dark:text-[#C4A484] font-medium min-w-[60px]">{label}</span>
        <div className="flex-1 relative h-[18px] flex items-center">
          <div className="absolute inset-x-0 h-1 bg-[#F0EBE3] dark:bg-gray-700 rounded-full" />
          <div
            className="absolute h-1 bg-[#8B7355] rounded-full"
            style={{ width: `${percent}%` }}
          />
          <input
            type="range"
            min={min} max={max} step={step} value={value}
            onChange={(e) => onChange(parseInt(e.target.value, 10))}
            disabled={disabled}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
          <div
            className="absolute w-[14px] h-[14px] bg-[#8B7355] rounded-full pointer-events-none"
            style={{ left: `calc(${percent}% - 7px)` }}
          />
        </div>
        <span className="text-[12px] font-bold text-[#2C1A0E] dark:text-gray-100 tabular-nums min-w-[48px] text-right">
          {value} {suffix}
        </span>
      </div>
    </div>
  );
}

// ── Trigger Card ─────────────────────────────────────────────
function TriggerCard({
  icon: Icon, title, description, enabled, onToggle, disabled = false, children,
}: {
  icon: React.ElementType; title: string; description: string;
  enabled: boolean; onToggle: (v: boolean) => void;
  disabled?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-2xl border border-[#E5DCC5] dark:border-gray-700 p-4 transition-opacity ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#F5F0E8] dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
          <Icon size={18} className="text-[#8B7355]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[#2C1A0E] dark:text-gray-100 leading-tight">{title}</p>
          <p className="text-[11px] text-[#8B7355] dark:text-[#C4A484] mt-0.5">{description}</p>
        </div>
        <Toggle on={enabled} onChange={onToggle} disabled={disabled} />
      </div>
      {children && enabled && !disabled && children}
    </div>
  );
}

// ── Section Label ────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-widest text-[#8B7355] dark:text-[#C4A484] mt-6 mb-2 px-1">
      {children}
    </p>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function NotificationsSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  const [pushStatus, setPushStatus] = useState<{ subscribed: boolean; vapidConfigured: boolean } | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');

  // Debounce-Save Ref
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial Load ──
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [sRes, pRes] = await Promise.all([
          fetch(`${API}/notification-settings`, { headers: authHeaders() }),
          fetch(`${API}/push/status`, { headers: authHeaders() }),
        ]);
        if (!mounted) return;
        if (sRes.ok) setSettings(await sRes.json());
        if (pRes.ok) setPushStatus(await pRes.json());
      } catch (err) {
        if (mounted) setError('Einstellungen konnten nicht geladen werden');
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ── Save mit Debounce ──
  const persist = useCallback((next: Settings) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      setError('');
      try {
        const res = await fetch(`${API}/notification-settings`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify(next),
        });
        if (!res.ok) throw new Error('Speichern fehlgeschlagen');
        const fresh = await res.json();
        setSettings(fresh);
        setSavedAt(Date.now());
      } catch (err: any) {
        setError(err.message || 'Speichern fehlgeschlagen');
      } finally {
        setSaving(false);
      }
    }, 350);
  }, []);

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  };

  // ── Push: Subscribe ──
  const enablePush = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Dieser Browser unterstützt keine Push-Benachrichtigungen');
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        throw new Error('Permission nicht erteilt');
      }
      const vapidRes = await fetch(`${API}/push/vapid-key`, { headers: authHeaders() });
      const { publicKey } = await vapidRes.json();
      if (!publicKey) throw new Error('VAPID-Key fehlt am Server');

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const subJson = sub.toJSON();
      const res = await fetch(`${API}/push/subscribe`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error('Subscription konnte nicht gespeichert werden');
      const statusRes = await fetch(`${API}/push/status`, { headers: authHeaders() });
      setPushStatus(await statusRes.json());
      setPushMessage('Push auf diesem Gerät aktiviert');
    } catch (err: any) {
      setPushMessage(err.message || 'Fehler beim Aktivieren');
    } finally {
      setPushBusy(false);
    }
  };

  // ── Push: Test ──
  const sendTest = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      const res = await fetch(`${API}/push/test`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) throw new Error('Test fehlgeschlagen');
      setPushMessage('Test-Push wurde gesendet');
    } catch (err: any) {
      setPushMessage(err.message || 'Fehler');
    } finally {
      setPushBusy(false);
    }
  };

  // ── Cleanup ──
  useEffect(() => {
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);

  // ── Render ──
  const allDisabled = !settings.master_enabled;

  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] px-4 md:px-8 pb-16 pt-6 transition-colors duration-200">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <button
          onClick={() => router.push('/profile')}
          className="inline-flex items-center gap-2 text-[#8B7355] dark:text-[#C4A484] hover:text-[#2C1A0E] dark:hover:text-white mb-6 font-medium text-sm transition-colors"
        >
          <ArrowLeft size={18} /> Zurück zum Profil
        </button>

        <h1
          className="text-[28px] md:text-[32px] text-[#2C1A0E] dark:text-white mb-1"
          style={{ fontFamily: 'var(--font-serif, "DM Serif Display"), serif', fontWeight: 400 }}
        >
          Benachrichtigungen
        </h1>
        <p className="text-[13px] text-[#8B7355] dark:text-[#C4A484] mb-6">
          Wann Crumb dich beim Backen anstupst
        </p>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-300 text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {!loaded ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-[#8B7355]" />
          </div>
        ) : (
          <>
            {/* ── Master Card ── */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#E5DCC5] dark:border-gray-700 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#8B7355] flex items-center justify-center flex-shrink-0">
                <Bell size={20} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-[#2C1A0E] dark:text-gray-100 leading-tight">
                  Push-Benachrichtigungen
                </p>
                <p className="text-[11px] text-[#8B7355] dark:text-[#C4A484] mt-0.5">
                  {settings.master_enabled ? 'Aktiv' : 'Deaktiviert'}
                  {saving && ' · speichert…'}
                  {!saving && savedAt && Date.now() - savedAt < 2000 && ' · gespeichert'}
                </p>
              </div>
              <Toggle
                on={settings.master_enabled}
                onChange={(v) => update({ master_enabled: v })}
              />
            </div>

            {/* ── Push-Status für dieses Gerät ── */}
            {pushStatus && (
              <div className="mt-3 bg-white/60 dark:bg-gray-800/60 rounded-xl border border-[#E5DCC5]/60 dark:border-gray-700/60 p-3 flex items-center gap-3">
                <Smartphone size={16} className="text-[#8B7355] flex-shrink-0" />
                <p className="text-[12px] text-[#8B7355] dark:text-[#C4A484] flex-1">
                  {pushStatus.subscribed
                    ? 'Dieses Gerät empfängt Push'
                    : pushStatus.vapidConfigured
                      ? 'Dieses Gerät ist noch nicht angemeldet'
                      : 'Push-Server ist nicht konfiguriert'}
                </p>
                {!pushStatus.subscribed && pushStatus.vapidConfigured && (
                  <button
                    onClick={enablePush}
                    disabled={pushBusy}
                    className="text-[12px] font-semibold text-[#8B7355] hover:text-[#2C1A0E] transition-colors disabled:opacity-50"
                  >
                    Aktivieren
                  </button>
                )}
              </div>
            )}

            {/* ── Trigger ── */}
            <SectionLabel>Trigger</SectionLabel>

            <div className="space-y-2">
              {/* Schritt fällig */}
              <TriggerCard
                icon={Hand}
                title="Schritt fällig"
                description="Wenn eine Aktion oder Phase an der Reihe ist"
                enabled={settings.step_ready_enabled}
                onToggle={(v) => update({ step_ready_enabled: v })}
                disabled={allDisabled}
              >
                <Slider
                  label="Heads-Up"
                  value={settings.step_ready_vorlauf_min}
                  min={0} max={15}
                  suffix="Min"
                  onChange={(v) => update({ step_ready_vorlauf_min: v })}
                />
              </TriggerCard>

              {/* Ofen vorheizen */}
              <TriggerCard
                icon={Flame}
                title="Ofen vorheizen"
                description="Erinnerung vor jedem Backstep"
                enabled={settings.preheat_enabled}
                onToggle={(v) => update({ preheat_enabled: v })}
                disabled={allDisabled}
              >
                <Slider
                  label="Vorlauf"
                  value={settings.preheat_vorlauf_min}
                  min={15} max={60} step={5}
                  suffix="Min"
                  onChange={(v) => update({ preheat_vorlauf_min: v })}
                />
              </TriggerCard>

              {/* Backen fertig */}
              <TriggerCard
                icon={CheckCircle2}
                title="Backen fertig"
                description="Sobald der Backtimer abläuft"
                enabled={settings.bake_done_enabled}
                onToggle={(v) => update({ bake_done_enabled: v })}
                disabled={allDisabled}
              />

              {/* Backplan abgeschlossen */}
              <TriggerCard
                icon={PartyPopper}
                title="Backplan abgeschlossen"
                description="Wenn alle Schritte erledigt sind"
                enabled={settings.plan_done_enabled}
                onToggle={(v) => update({ plan_done_enabled: v })}
                disabled={allDisabled}
              />
            </div>

            {/* ── Stille Stunden ── */}
            <SectionLabel>Stille Stunden</SectionLabel>

            <div className={`bg-white dark:bg-gray-800 rounded-2xl border border-[#E5DCC5] dark:border-gray-700 p-4 transition-opacity ${allDisabled ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#F5F0E8] dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <Moon size={18} className="text-[#8B7355]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-[#2C1A0E] dark:text-gray-100 leading-tight">
                    Nachtruhe
                  </p>
                  <p className="text-[11px] text-[#8B7355] dark:text-[#C4A484] mt-0.5">
                    Keine Push in Ruhezeiten
                  </p>
                </div>
                <Toggle
                  on={settings.quiet_enabled}
                  onChange={(v) => update({ quiet_enabled: v })}
                  disabled={allDisabled}
                />
              </div>
              {settings.quiet_enabled && !allDisabled && (
                <div className="mt-3 pt-3 border-t border-[#F0EBE3] dark:border-gray-700 flex items-center gap-3">
                  <span className="text-[11px] text-[#8B7355] dark:text-[#C4A484] font-medium">Von</span>
                  <input
                    type="time"
                    value={settings.quiet_start}
                    onChange={(e) => update({ quiet_start: e.target.value })}
                    className="px-3 py-1.5 rounded-lg bg-[#F5F0E8] dark:bg-gray-700 text-[#2C1A0E] dark:text-gray-100 text-[13px] font-semibold border-0 focus:outline-none focus:ring-2 focus:ring-[#8B7355]/40"
                  />
                  <span className="text-[11px] text-[#8B7355] dark:text-[#C4A484] font-medium">bis</span>
                  <input
                    type="time"
                    value={settings.quiet_end}
                    onChange={(e) => update({ quiet_end: e.target.value })}
                    className="px-3 py-1.5 rounded-lg bg-[#F5F0E8] dark:bg-gray-700 text-[#2C1A0E] dark:text-gray-100 text-[13px] font-semibold border-0 focus:outline-none focus:ring-2 focus:ring-[#8B7355]/40"
                  />
                </div>
              )}
            </div>

            {/* ── Test-Push ── */}
            <button
              onClick={sendTest}
              disabled={pushBusy || !pushStatus?.subscribed}
              className="w-full mt-6 py-3 rounded-2xl border border-dashed border-[#8B7355] text-[#8B7355] text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-[#F5F0E8] dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pushBusy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Test-Push senden
            </button>

            {pushMessage && (
              <p className="mt-3 text-center text-[12px] text-[#8B7355] dark:text-[#C4A484]">
                {pushMessage}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
