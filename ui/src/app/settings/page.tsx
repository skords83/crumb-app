'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Clock, Bell, Percent, KeyRound, Moon, AlarmClock, ChevronRight, Loader2, CheckCircle, Eye, EyeOff, Send, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { loadSettings, saveSettings, SETTINGS_DEFAULTS, minToHHMM, hhmmToMin } from '@/lib/crumb-settings';
import { apiFetch } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'planung' | 'notifications' | 'anzeige' | 'security';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'planung',       label: 'Zeiten',             icon: <Clock size={16}/> },
  { id: 'notifications', label: 'Benachrichtigungen', icon: <Bell size={16}/> },
  { id: 'anzeige',       label: 'Anzeige',            icon: <Percent size={16}/> },
  { id: 'security',      label: 'Sicherheit',         icon: <KeyRound size={16}/> },
];

const API = process.env.NEXT_PUBLIC_API_URL;

// ─── Toggle component ────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled = false }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`w-10 h-[22px] rounded-full transition-colors relative flex-shrink-0 ${value ? 'bg-[#8B7355]' : 'bg-[#D6C9B4] dark:bg-white/15'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <div className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-[3px]'}`}/>
    </button>
  );
}

// ─── Slider component ────────────────────────────────────────────────────────

function SliderRow({ label, sub, value, min, max, step, format, onChange, disabled = false }: {
  label: string; sub?: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 py-3.5 border-b border-[#EDE5D6] dark:border-white/[0.07] last:border-0 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#2C1A0E] dark:text-white/85">{label}</p>
        {sub && <p className="text-xs text-[#A68B6A] dark:text-white/40 mt-0.5">{sub}</p>}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <input
          type="range"
          min={min} max={max} step={step} value={value}
          disabled={disabled}
          onChange={e => onChange(Number(e.target.value))}
          className="w-28 h-1 appearance-none rounded-full outline-none cursor-pointer disabled:cursor-not-allowed"
          style={{
            background: `linear-gradient(to right, #8B7355 ${((value - min) / (max - min)) * 100}%, #D6C9B4 ${((value - min) / (max - min)) * 100}%)`
          }}
        />
        <span className="text-sm font-medium text-[#2C1A0E] dark:text-white/85 min-w-[44px] text-right tabular-nums">{format(value)}</span>
      </div>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-[#A68B6A] dark:text-white/35 uppercase tracking-[0.08em] mb-1 mt-5 first:mt-0">{children}</p>
  );
}

// ─── Row with toggle ─────────────────────────────────────────────────────────

function ToggleRow({ label, sub, value, onChange, disabled = false }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-3.5 border-b border-[#EDE5D6] dark:border-white/[0.07] last:border-0 ${disabled ? 'opacity-40' : ''}`}>
      <div>
        <p className="text-sm text-[#2C1A0E] dark:text-white/85">{label}</p>
        {sub && <p className="text-xs text-[#A68B6A] dark:text-white/40 mt-0.5">{sub}</p>}
      </div>
      <Toggle value={value} onChange={onChange} disabled={disabled}/>
    </div>
  );
}

// ─── Tab: Planung ─────────────────────────────────────────────────────────────

function TabPlanung() {
  const s = loadSettings();
  const [sleepFromStr, setSleepFromStr] = useState(minToHHMM(s.sleepFrom));
  const [sleepToStr,   setSleepToStr]   = useState(minToHHMM(s.sleepTo));
  const [abendStr,     setAbendStr]     = useState(minToHHMM(s.abendZiel));
  const [morgenStr,    setMorgenStr]    = useState(minToHHMM(s.morgenZiel));
  const [snapMin,      setSnapMin]      = useState(s.snapMin);
  const [showFreieZeit, setShowFreieZeit] = useState(s.showFreieZeit ?? true);
  const [minFreieZeit,  setMinFreieZeit]  = useState(s.minFreieZeit ?? 30);

  const save = (updates: Parameters<typeof saveSettings>[0]) => saveSettings(updates);

  const inputCls = "px-3 py-2 text-sm rounded-xl border border-[#D6C9B4] dark:border-white/10 bg-white dark:bg-white/5 text-[#2C1A0E] dark:text-white/80 outline-none focus:border-[#8B7355] transition-colors w-full tabular-nums";

  return (
    <div>
      <SectionTitle>Nachtruhe</SectionTitle>
      <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-4">
        <div className="flex items-center gap-3 py-1">
          <Moon size={15} className="text-[#C4A484] dark:text-white/30 flex-shrink-0"/>
          <div className="flex items-center gap-2 flex-1">
            <input type="time" value={sleepFromStr}
              onChange={e=>{setSleepFromStr(e.target.value);save({sleepFrom:hhmmToMin(e.target.value)});}}
              className={inputCls}/>
            <span className="text-[#D6C9B4] text-sm flex-shrink-0">–</span>
            <input type="time" value={sleepToStr}
              onChange={e=>{setSleepToStr(e.target.value);save({sleepTo:hhmmToMin(e.target.value)});}}
              className={inputCls}/>
          </div>
        </div>
      </div>

      <SectionTitle>Zielzeiten</SectionTitle>
      <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-4 space-y-3">
        <div className="flex items-center gap-3">
          <AlarmClock size={15} className="text-[#C4A484] dark:text-white/30 flex-shrink-0"/>
          <span className="text-sm text-[#A68B6A] dark:text-white/40 w-28 flex-shrink-0">Abend fertig</span>
          <input type="time" value={abendStr}
            onChange={e=>{setAbendStr(e.target.value);save({abendZiel:hhmmToMin(e.target.value)});}}
            className={inputCls}/>
        </div>
        <div className="flex items-center gap-3">
          <AlarmClock size={15} className="text-[#C4A484] dark:text-white/30 flex-shrink-0"/>
          <span className="text-sm text-[#A68B6A] dark:text-white/40 w-28 flex-shrink-0">Morgen fertig</span>
          <input type="time" value={morgenStr}
            onChange={e=>{setMorgenStr(e.target.value);save({morgenZiel:hhmmToMin(e.target.value)});}}
            className={inputCls}/>
        </div>
      </div>

      <SectionTitle>Snap-Granularität</SectionTitle>
      <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-4">
        <div className="flex gap-2">
          {[0,5,15,30].map(v=>(
            <button key={v} onClick={()=>{setSnapMin(v);save({snapMin:v});}}
              className={`flex-1 py-2 text-xs rounded-xl border transition-colors ${snapMin===v?'bg-[#8B7355] border-[#8B7355] text-white':'border-[#D6C9B4] dark:border-white/10 text-[#A68B6A] dark:text-white/40 bg-white dark:bg-transparent hover:border-[#8B7355]/40'}`}>
              {v===0?'aus':`${v} min`}
            </button>
          ))}
        </div>
      </div>

      <SectionTitle>Freizeit-Liste</SectionTitle>
      <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[#2C1A0E] dark:text-white/85">Im Backplan anzeigen</span>
          <Toggle value={showFreieZeit} onChange={v=>{setShowFreieZeit(v);save({showFreieZeit:v});}}/>
        </div>
        {showFreieZeit && (
          <div>
            <p className="text-xs text-[#A68B6A] dark:text-white/40 mb-2">Mindestdauer</p>
            <div className="flex gap-2">
              {[15,30,60].map(v=>(
                <button key={v} onClick={()=>{setMinFreieZeit(v);save({minFreieZeit:v});}}
                  className={`flex-1 py-2 text-xs rounded-xl border transition-colors ${minFreieZeit===v?'bg-[#8B7355] border-[#8B7355] text-white':'border-[#D6C9B4] dark:border-white/10 text-[#A68B6A] dark:text-white/40 bg-white dark:bg-transparent hover:border-[#8B7355]/40'}`}>
                  {v<60?`${v} min`:'1 h'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={()=>{
          const d=SETTINGS_DEFAULTS;
          save({sleepFrom:d.sleepFrom,sleepTo:d.sleepTo,abendZiel:d.abendZiel,morgenZiel:d.morgenZiel,snapMin:d.snapMin,showFreieZeit:d.showFreieZeit,minFreieZeit:d.minFreieZeit});
          setSleepFromStr(minToHHMM(d.sleepFrom)); setSleepToStr(minToHHMM(d.sleepTo));
          setAbendStr(minToHHMM(d.abendZiel)); setMorgenStr(minToHHMM(d.morgenZiel));
          setSnapMin(d.snapMin); setShowFreieZeit(d.showFreieZeit); setMinFreieZeit(d.minFreieZeit);
        }}
        className="mt-4 text-xs text-[#A68B6A] dark:text-white/30 hover:text-[#5C3D1E] dark:hover:text-white/60 underline"
      >
        Auf Standardwerte zurücksetzen
      </button>
    </div>
  );
}

// ─── Tab: Notifications ───────────────────────────────────────────────────────

// Settings shape from backend (api/notification-settings.js)
type NotifSettings = {
  master_enabled: boolean;
  step_ready_enabled: boolean;
  step_ready_vorlauf_min: number;
  preheat_enabled: boolean;
  preheat_vorlauf_min: number;
  bake_done_enabled: boolean;
  plan_done_enabled: boolean;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
};

const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
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

// Convert URL-safe base64 to Uint8Array for VAPID applicationServerKey
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function TabNotifications() {
  // Browser subscription state
  const [pushSupported,  setPushSupported]  = useState<boolean | null>(null);
  const [permission,     setPermission]     = useState<NotificationPermission>('default');
  const [subscribed,     setSubscribed]     = useState(false);
  const [busy,           setBusy]           = useState(false);
  const [busyMsg,        setBusyMsg]        = useState<string>('');

  // Backend settings (mirrored in local state for fast UI)
  const [settings, setSettings] = useState<NotifSettings>(DEFAULT_NOTIF_SETTINGS);
  const [loaded,   setLoaded]   = useState(false);

  // Test push state
  const [testSending, setTestSending] = useState(false);
  const [testResult,  setTestResult]  = useState<'ok'|'err'|null>(null);
  const [testError,   setTestError]   = useState<string>('');

  // Debounce timer for settings save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load: check browser support + sync state ──────────────────────
  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setPushSupported(supported);
    if (supported) setPermission(Notification.permission);

    // Check current subscription
    if (supported) {
      navigator.serviceWorker.ready
        .then(reg => reg.pushManager.getSubscription())
        .then(sub => setSubscribed(!!sub))
        .catch(() => setSubscribed(false));
    }

    // Load settings from backend
    (async () => {
      try {
        const res = await apiFetch(`${API}/notification-settings`);
        if (res.ok) {
          const data = await res.json();
          setSettings({ ...DEFAULT_NOTIF_SETTINGS, ...data });
        }
      } catch (e) {
        console.error('Settings konnten nicht geladen werden', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // ── Save settings (debounced) ──────────────────────────────────────────────
  const saveSettingsToBackend = (next: NotifSettings) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await apiFetch(`${API}/notification-settings`, {
          method: 'PUT',
          body: JSON.stringify(next),
        });
      } catch (e) {
        console.error('Settings speichern fehlgeschlagen', e);
      }
    }, 400);
  };

  const updateSettings = (patch: Partial<NotifSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettingsToBackend(next);
      return next;
    });
  };

  // ── Subscribe (browser → backend) ──────────────────────────────────────────
  const subscribe = async () => {
    setBusy(true);
    setBusyMsg('Berechtigung anfordern…');
    try {
      // 1. Permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        throw new Error('Berechtigung wurde nicht erteilt');
      }

      // 2. VAPID public key
      setBusyMsg('VAPID-Key abrufen…');
      const vapidRes = await apiFetch(`${API}/push/vapid-key`);
      const { publicKey } = await vapidRes.json();
      if (!publicKey) throw new Error('Server hat keinen VAPID-Key (Konfiguration prüfen)');

      // 3. SW registration
      setBusyMsg('Service Worker bereitstellen…');
      const reg = await navigator.serviceWorker.ready;

      // 4. Subscribe via PushManager (re-use existing sub if compatible)
      setBusyMsg('Push-Subscription erstellen…');
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Make sure it matches our VAPID key; otherwise re-subscribe.
        const currentKey = sub.options?.applicationServerKey;
        if (!currentKey) {
          await sub.unsubscribe();
          sub = null;
        }
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      // 5. Push to backend
      setBusyMsg('Beim Server registrieren…');
      const subJson = sub.toJSON();
      const subRes = await apiFetch(`${API}/push/subscribe`, {
        method: 'POST',
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!subRes.ok) throw new Error('Server hat Subscription abgelehnt');

      // 6. Sync master_enabled to true
      setSubscribed(true);
      updateSettings({ master_enabled: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
      console.error('Subscribe Fehler:', msg);
      setTestError(msg);
      setTestResult('err');
      setTimeout(() => { setTestResult(null); setTestError(''); }, 4000);
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  // ── Unsubscribe (browser + backend) ────────────────────────────────────────
  const unsubscribe = async () => {
    setBusy(true);
    setBusyMsg('Subscription entfernen…');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await apiFetch(`${API}/push/unsubscribe`, {
          method: 'DELETE',
          body: JSON.stringify({ endpoint }),
        });
      }
      setSubscribed(false);
    } catch (err) {
      console.error('Unsubscribe Fehler:', err);
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  const togglePush = (v: boolean) => {
    if (busy) return;
    if (v) subscribe(); else unsubscribe();
  };

  // ── Test push ──────────────────────────────────────────────────────────────
  const sendTest = async () => {
    setTestSending(true);
    setTestResult(null);
    setTestError('');
    try {
      const res = await apiFetch(`${API}/push/test`, { method: 'POST' });
      if (res.ok) {
        setTestResult('ok');
      } else {
        const data = await res.json().catch(() => ({}));
        setTestError(data.error || `HTTP ${res.status}`);
        setTestResult('err');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verbindungsfehler';
      setTestError(msg);
      setTestResult('err');
    } finally {
      setTestSending(false);
      setTimeout(() => { setTestResult(null); setTestError(''); }, 4000);
    }
  };

  const card = "bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-4";

  // The master toggle should reflect "subscribed AND master_enabled".
  // We control browser subscription primarily; master_enabled tracks alongside.
  const pushOn = subscribed && settings.master_enabled;
  const triggersDisabled = !pushOn || !loaded;

  return (
    <div>
      {pushSupported === false && (
        <div className="mb-4 p-3 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0"/>
          <div>Dieser Browser unterstützt keine Push-Benachrichtigungen. Auf iOS muss Crumb dafür über &quot;Zum Home-Bildschirm&quot; installiert werden.</div>
        </div>
      )}
      {pushSupported && permission === 'denied' && (
        <div className="mb-4 p-3 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0"/>
          <div>Benachrichtigungen sind in den Browser-Einstellungen blockiert. Bitte dort erlauben und die Seite neu laden.</div>
        </div>
      )}

      <SectionTitle>Push</SectionTitle>
      <div className={card}>
        <ToggleRow
          label="Push-Benachrichtigungen"
          sub={
            busy
              ? busyMsg || 'Wird verarbeitet…'
              : subscribed
              ? 'Auf diesem Gerät aktiv'
              : 'Nicht aktiv auf diesem Gerät'
          }
          value={pushOn}
          onChange={togglePush}
          disabled={busy || pushSupported !== true || permission === 'denied'}
        />
      </div>

      <SectionTitle>Trigger</SectionTitle>
      <div className={card}>
        <div className="border-b border-[#EDE5D6] dark:border-white/[0.07] pb-1 mb-1">
          <ToggleRow
            label="Schritt fällig"
            sub="Wenn eine Aktion oder Phase an der Reihe ist"
            value={settings.step_ready_enabled}
            onChange={v => updateSettings({ step_ready_enabled: v })}
            disabled={triggersDisabled}
          />
          {settings.step_ready_enabled && (
            <SliderRow
              label="Heads-Up"
              sub="Vorlauf bis zur Benachrichtigung"
              value={settings.step_ready_vorlauf_min}
              min={0} max={30} step={1}
              format={v => v === 0 ? 'sofort' : `${v} Min`}
              onChange={v => updateSettings({ step_ready_vorlauf_min: v })}
              disabled={triggersDisabled}
            />
          )}
        </div>

        <div className="border-b border-[#EDE5D6] dark:border-white/[0.07] pb-1 mb-1">
          <ToggleRow
            label="Ofen vorheizen"
            sub="Erinnerung vor jedem Backstep"
            value={settings.preheat_enabled}
            onChange={v => updateSettings({ preheat_enabled: v })}
            disabled={triggersDisabled}
          />
          {settings.preheat_enabled && (
            <SliderRow
              label="Vorlauf"
              value={settings.preheat_vorlauf_min}
              min={5} max={120} step={5}
              format={v => `${v} Min`}
              onChange={v => updateSettings({ preheat_vorlauf_min: v })}
              disabled={triggersDisabled}
            />
          )}
        </div>

        <ToggleRow
          label="Backen fertig"
          sub="Sobald der Backtimer abläuft"
          value={settings.bake_done_enabled}
          onChange={v => updateSettings({ bake_done_enabled: v })}
          disabled={triggersDisabled}
        />
        <ToggleRow
          label="Backplan abgeschlossen"
          sub="Wenn alle Schritte erledigt sind"
          value={settings.plan_done_enabled}
          onChange={v => updateSettings({ plan_done_enabled: v })}
          disabled={triggersDisabled}
        />
      </div>

      <SectionTitle>Stille Stunden</SectionTitle>
      <div className={card}>
        <ToggleRow
          label="Nachtruhe"
          sub={settings.quiet_enabled ? `Keine Push zwischen ${settings.quiet_start} und ${settings.quiet_end}` : 'Keine Push in Ruhezeiten'}
          value={settings.quiet_enabled}
          onChange={v => updateSettings({ quiet_enabled: v })}
          disabled={triggersDisabled}
        />
        {settings.quiet_enabled && (
          <div className="flex items-center gap-3 py-3.5">
            <Moon size={15} className="text-[#C4A484] dark:text-white/30 flex-shrink-0"/>
            <div className="flex items-center gap-2 flex-1">
              <input
                type="time"
                value={settings.quiet_start}
                onChange={e => updateSettings({ quiet_start: e.target.value })}
                disabled={triggersDisabled}
                className="px-3 py-2 text-sm rounded-xl border border-[#D6C9B4] dark:border-white/10 bg-white dark:bg-white/5 text-[#2C1A0E] dark:text-white/80 outline-none focus:border-[#8B7355] transition-colors w-full tabular-nums disabled:opacity-40"
              />
              <span className="text-[#D6C9B4] text-sm flex-shrink-0">–</span>
              <input
                type="time"
                value={settings.quiet_end}
                onChange={e => updateSettings({ quiet_end: e.target.value })}
                disabled={triggersDisabled}
                className="px-3 py-2 text-sm rounded-xl border border-[#D6C9B4] dark:border-white/10 bg-white dark:bg-white/5 text-[#2C1A0E] dark:text-white/80 outline-none focus:border-[#8B7355] transition-colors w-full tabular-nums disabled:opacity-40"
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-5">
        <button
          onClick={sendTest}
          disabled={testSending || !pushOn}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl border text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            testResult==='ok'
              ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400'
              : testResult==='err'
              ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400'
              : 'bg-white dark:bg-white/[0.03] border-[#D6C9B4] dark:border-white/10 text-[#5C3D1E] dark:text-white/60 hover:bg-[#F5F0E8] dark:hover:bg-white/5'
          }`}
        >
          {testSending ? (
            <><Loader2 size={15} className="animate-spin"/>Wird gesendet…</>
          ) : testResult==='ok' ? (
            <><CheckCircle size={15}/>Test-Push gesendet</>
          ) : testResult==='err' ? (
            <>Fehler{testError ? `: ${testError}` : ' beim Senden'}</>
          ) : (
            <><Send size={15}/>Test-Push senden</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Tab: Anzeige ─────────────────────────────────────────────────────────────

function TabAnzeige() {
  const [showBakersPercent, setShowBakersPercent] = useState(false);

  useEffect(() => {
    const s = loadSettings();
    setShowBakersPercent(!!s.showBakersPercent);
  }, []);

  return (
    <div>
      <SectionTitle>Rezeptansicht</SectionTitle>
      <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-4">
        <ToggleRow
          label="Bäckerprozente"
          sub="Zutatenmengen relativ zum Mehlgewicht anzeigen"
          value={showBakersPercent}
          onChange={v=>{setShowBakersPercent(v);saveSettings({showBakersPercent:v});window.dispatchEvent(new StorageEvent('storage',{key:'crumb_settings'}));}}
        />
      </div>
    </div>
  );
}

// ─── Tab: Security ────────────────────────────────────────────────────────────

function TabSecurity() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword]   = useState('');
  const [newPassword,     setNewPassword]        = useState('');
  const [confirmPassword, setConfirmPassword]    = useState('');
  const [isLoading,       setIsLoading]          = useState(false);
  const [message,         setMessage]            = useState('');
  const [error,           setError]              = useState('');
  const [showCurrent,     setShowCurrent]        = useState(false);
  const [showNew,         setShowNew]            = useState(false);
  const [showConfirm,     setShowConfirm]        = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setMessage('');
    if (newPassword !== confirmPassword) { setError('Die neuen Passwörter stimmen nicht überein'); return; }
    if (newPassword.length < 6) { setError('Das Passwort muss mindestens 6 Zeichen haben'); return; }
    setIsLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Fehler beim Ändern des Passworts'); return; }
      setMessage('Passwort wurde erfolgreich geändert');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch { setError('Verbindungsfehler. Bitte versuche es später erneut.'); }
    finally { setIsLoading(false); }
  };

  const inputCls = "w-full px-4 py-3 pr-12 rounded-xl border border-[#D6C9B4] dark:border-white/10 bg-white dark:bg-white/5 text-[#2C1A0E] dark:text-white/85 focus:border-[#8B7355] focus:outline-none transition-colors";

  const PwInput = ({ value, onChange, show, onToggle, label, required=false }: { value:string; onChange:(e:React.ChangeEvent<HTMLInputElement>)=>void; show:boolean; onToggle:()=>void; label:string; required?:boolean }) => (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-[#A68B6A] dark:text-white/40 uppercase tracking-wider mb-2">{label}</label>
      <div className="relative">
        <input type={show?'text':'password'} value={value} onChange={onChange} className={inputCls} placeholder="••••••••" required={required} minLength={6}/>
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#C4A484] hover:text-[#8B7355] transition-colors" tabIndex={-1}>
          {show?<EyeOff size={17}/>:<Eye size={17}/>}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <SectionTitle>Konto</SectionTitle>
      <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#8B7355] rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
            {user?.username?user.username.slice(0,2).toUpperCase():'?'}
          </div>
          <div>
            <p className="text-sm font-medium text-[#2C1A0E] dark:text-white/85">{user?.username}</p>
            <p className="text-xs text-[#A68B6A] dark:text-white/40">{user?.email}</p>
          </div>
        </div>
      </div>

      <SectionTitle>Passwort ändern</SectionTitle>
      <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-5">
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm">{error}</div>
        )}
        {message && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl text-green-700 dark:text-green-400 text-sm flex items-center gap-2"><CheckCircle size={15}/>{message}</div>
        )}
        <form onSubmit={handleSubmit}>
          <PwInput label="Aktuelles Passwort" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} show={showCurrent} onToggle={()=>setShowCurrent(v=>!v)} required/>
          <PwInput label="Neues Passwort" value={newPassword} onChange={e=>setNewPassword(e.target.value)} show={showNew} onToggle={()=>setShowNew(v=>!v)} required/>
          <PwInput label="Neues Passwort bestätigen" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} show={showConfirm} onToggle={()=>setShowConfirm(v=>!v)} required/>
          <button type="submit" disabled={isLoading}
            className="w-full py-3 px-4 bg-[#8B7355] hover:bg-[#766248] text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1">
            {isLoading?<><Loader2 size={16} className="animate-spin"/>Passwort ändern…</>:'Passwort ändern'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function SettingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>('planung');

  // Read tab from URL query param
  useEffect(() => {
    const t = searchParams.get('tab') as Tab | null;
    if (t && TABS.some(tab => tab.id === t)) setActiveTab(t);
  }, [searchParams]);

  const updateTab = (tab: Tab) => {
    setActiveTab(tab);
    const url = tab === 'planung' ? '/settings' : `/settings?tab=${tab}`;
    window.history.replaceState(null, '', url);
  };

  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] pb-24 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">

        {/* Back button */}
        <button
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 text-[#A68B6A] dark:text-white/40 hover:text-[#5C3D1E] dark:hover:text-white/70 mb-6 text-sm transition-colors"
        >
          <ArrowLeft size={16}/> Zurück
        </button>

        <h1 className="text-2xl font-bold text-[#2C1A0E] dark:text-white mb-6" style={{fontFamily:'var(--font-dm-serif),serif'}}>
          Einstellungen
        </h1>

        <div className="flex gap-6 items-start">

          {/* ── Sidebar ── */}
          <aside className="hidden md:block w-52 flex-shrink-0">
            <nav className="bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07]">
              {TABS.map((tab, i) => (
                <button
                  key={tab.id}
                  onClick={() => updateTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left ${
                    i === 0 ? 'rounded-t-2xl' : ''
                  } ${
                    i === TABS.length - 1 ? 'rounded-b-2xl' : 'border-b border-[#EDE5D6] dark:border-white/[0.07]'
                  } ${
                    activeTab === tab.id
                      ? 'bg-[#F5F0E8] dark:bg-[#8B7355]/15 text-[#8B7355] dark:text-[#C4A484] font-medium'
                      : 'text-[#5C3D1E] dark:text-white/60 hover:bg-[#FAF7F3] dark:hover:bg-white/5'
                  }`}
                >
                  <span className={activeTab === tab.id ? 'text-[#8B7355]' : 'text-[#C4A484] dark:text-white/30'}>
                    {tab.icon}
                  </span>
                  {tab.label}
                  {activeTab === tab.id && <ChevronRight size={13} className="ml-auto text-[#8B7355]/50"/>}
                </button>
              ))}
            </nav>
          </aside>

          {/* ── Mobile tab bar ── */}
          <div className="md:hidden w-full mb-5 flex gap-1.5 bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-1.5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => updateTab(tab.id)}
                className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[#8B7355] text-white'
                    : 'text-[#A68B6A] dark:text-white/40 hover:bg-[#F5F0E8] dark:hover:bg-white/5'
                }`}
              >
                <span className="[&>svg]:w-4 [&>svg]:h-4">{tab.icon}</span>
                {tab.label === 'Benachrichtigungen' ? 'Push' : tab.label}
              </button>
            ))}
          </div>

          {/* ── Content ── */}
          <main className="flex-1 min-w-0">
            {activeTab === 'planung'       && <TabPlanung/>}
            {activeTab === 'notifications' && <TabNotifications/>}
            {activeTab === 'anzeige'       && <TabAnzeige/>}
            {activeTab === 'security'      && <TabSecurity/>}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageContent/>
    </Suspense>
  );
}