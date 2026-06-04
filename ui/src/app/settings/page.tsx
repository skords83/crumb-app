'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Clock, Bell, Percent, KeyRound, Moon, AlarmClock, ChevronRight, Loader2, CheckCircle, Eye, EyeOff, Send } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { loadSettings, saveSettings, SETTINGS_DEFAULTS, minToHHMM, hhmmToMin } from '@/lib/crumb-settings';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'planung' | 'notifications' | 'anzeige' | 'security';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'planung',       label: 'Zeiten',             icon: <Clock size={16}/> },
  { id: 'notifications', label: 'Benachrichtigungen', icon: <Bell size={16}/> },
  { id: 'anzeige',       label: 'Anzeige',            icon: <Percent size={16}/> },
  { id: 'security',      label: 'Sicherheit',         icon: <KeyRound size={16}/> },
];

// ─── Toggle component ────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-10 h-[22px] rounded-full transition-colors relative flex-shrink-0 ${value ? 'bg-[#8B7355]' : 'bg-[#D6C9B4] dark:bg-white/15'}`}
    >
      <div className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-[3px]'}`}/>
    </button>
  );
}

// ─── Slider component ────────────────────────────────────────────────────────

function SliderRow({ label, sub, value, min, max, step, format, onChange }: {
  label: string; sub?: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-4 py-3.5 border-b border-[#EDE5D6] dark:border-white/[0.07] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#2C1A0E] dark:text-white/85">{label}</p>
        {sub && <p className="text-xs text-[#A68B6A] dark:text-white/40 mt-0.5">{sub}</p>}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <input
          type="range"
          min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-28 h-1 appearance-none rounded-full outline-none cursor-pointer"
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

function ToggleRow({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-[#EDE5D6] dark:border-white/[0.07] last:border-0">
      <div>
        <p className="text-sm text-[#2C1A0E] dark:text-white/85">{label}</p>
        {sub && <p className="text-xs text-[#A68B6A] dark:text-white/40 mt-0.5">{sub}</p>}
      </div>
      <Toggle value={value} onChange={onChange}/>
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

function TabNotifications() {
  const [pushEnabled,    setPushEnabled]    = useState(false);
  const [stepEnabled,    setStepEnabled]    = useState(true);
  const [stepVorlauf,    setStepVorlauf]    = useState(5);
  const [ofenEnabled,    setOfenEnabled]    = useState(true);
  const [ofenVorlauf,    setOfenVorlauf]    = useState(45);
  const [fertigEnabled,  setFertigEnabled]  = useState(true);
  const [planEnabled,    setPlanEnabled]    = useState(true);
  const [nachtruheOn,    setNachtruheOn]    = useState(true);
  const [testSending,    setTestSending]    = useState(false);
  const [testResult,     setTestResult]     = useState<'ok'|'err'|null>(null);

  // Load notification settings from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('crumb_notif_settings');
      if (raw) {
        const n = JSON.parse(raw);
        if (n.pushEnabled   !== undefined) setPushEnabled(n.pushEnabled);
        if (n.stepEnabled   !== undefined) setStepEnabled(n.stepEnabled);
        if (n.stepVorlauf   !== undefined) setStepVorlauf(n.stepVorlauf);
        if (n.ofenEnabled   !== undefined) setOfenEnabled(n.ofenEnabled);
        if (n.ofenVorlauf   !== undefined) setOfenVorlauf(n.ofenVorlauf);
        if (n.fertigEnabled !== undefined) setFertigEnabled(n.fertigEnabled);
        if (n.planEnabled   !== undefined) setPlanEnabled(n.planEnabled);
        if (n.nachtruheOn   !== undefined) setNachtruheOn(n.nachtruheOn);
      }
    } catch {}
  }, []);

  const saveNotif = (updates: Record<string, unknown>) => {
    try {
      const raw = localStorage.getItem('crumb_notif_settings');
      const current = raw ? JSON.parse(raw) : {};
      localStorage.setItem('crumb_notif_settings', JSON.stringify({ ...current, ...updates }));
    } catch {}
  };

  const sendTest = async () => {
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/push/test`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
      });
      setTestResult(res.ok ? 'ok' : 'err');
    } catch {
      setTestResult('err');
    } finally {
      setTestSending(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  const card = "bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] p-4";

  return (
    <div>
      <SectionTitle>Push</SectionTitle>
      <div className={card}>
        <ToggleRow
          label="Push-Benachrichtigungen"
          sub="Über ntfy auf diesem Gerät"
          value={pushEnabled}
          onChange={v=>{setPushEnabled(v);saveNotif({pushEnabled:v});}}
        />
      </div>

      <SectionTitle>Trigger</SectionTitle>
      <div className={card}>
        <div className="border-b border-[#EDE5D6] dark:border-white/[0.07] pb-1 mb-1">
          <ToggleRow
            label="Schritt fällig"
            sub="Wenn eine Aktion oder Phase an der Reihe ist"
            value={stepEnabled}
            onChange={v=>{setStepEnabled(v);saveNotif({stepEnabled:v});}}
          />
          {stepEnabled && (
            <SliderRow
              label="Heads-Up"
              sub="Vorlauf bis zur Benachrichtigung"
              value={stepVorlauf}
              min={1} max={30} step={1}
              format={v=>`${v} Min`}
              onChange={v=>{setStepVorlauf(v);saveNotif({stepVorlauf:v});}}
            />
          )}
        </div>

        <div className="border-b border-[#EDE5D6] dark:border-white/[0.07] pb-1 mb-1">
          <ToggleRow
            label="Ofen vorheizen"
            sub="Erinnerung vor jedem Backstep"
            value={ofenEnabled}
            onChange={v=>{setOfenEnabled(v);saveNotif({ofenEnabled:v});}}
          />
          {ofenEnabled && (
            <SliderRow
              label="Vorlauf"
              value={ofenVorlauf}
              min={10} max={90} step={5}
              format={v=>`${v} Min`}
              onChange={v=>{setOfenVorlauf(v);saveNotif({ofenVorlauf:v});}}
            />
          )}
        </div>

        <ToggleRow
          label="Backen fertig"
          sub="Sobald der Backtimer abläuft"
          value={fertigEnabled}
          onChange={v=>{setFertigEnabled(v);saveNotif({fertigEnabled:v});}}
        />
        <ToggleRow
          label="Backplan abgeschlossen"
          sub="Wenn alle Schritte erledigt sind"
          value={planEnabled}
          onChange={v=>{setPlanEnabled(v);saveNotif({planEnabled:v});}}
        />
      </div>

      <SectionTitle>Stille Stunden</SectionTitle>
      <div className={card}>
        <ToggleRow
          label="Nachtruhe"
          sub="Keine Push in Ruhezeiten"
          value={nachtruheOn}
          onChange={v=>{setNachtruheOn(v);saveNotif({nachtruheOn:v});}}
        />
      </div>

      <div className="mt-5">
        <button
          onClick={sendTest}
          disabled={testSending}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl border text-sm font-medium transition-all ${
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
            <>Fehler beim Senden</>
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/change-password`, {
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
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] pt-[73px] md:pt-[73px] pb-24 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 py-8">

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
          <aside className="hidden md:block w-44 flex-shrink-0">
            <nav className="bg-white dark:bg-white/[0.03] rounded-2xl border border-[#EDE5D6] dark:border-white/[0.07] overflow-hidden">
              {TABS.map((tab, i) => (
                <button
                  key={tab.id}
                  onClick={() => updateTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left ${
                    i < TABS.length - 1 ? 'border-b border-[#EDE5D6] dark:border-white/[0.07]' : ''
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
