// src/components/Navigation.tsx
"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, FileDown, Clock, Sun, Moon, LogOut, ChevronDown, KeyRound, Download, Percent, Search, BedDouble, AlarmClock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { loadSettings, saveSettings, SETTINGS_DEFAULTS, minToHHMM, hhmmToMin } from '@/lib/crumb-settings';

export default function Navigation() {
  const pathname = usePathname();
  const isAuthPage = ['/login', '/register', '/forgot-password', '/reset-password'].includes(pathname);
  if (isAuthPage) return null;

  const { logout, user } = useAuth();
  const { canInstall, install } = usePWAInstall();
  const [hasActivePlan, setHasActivePlan] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showBakersPercent, setShowBakersPercent] = useState(false);
  const [showPlanSettings, setShowPlanSettings] = useState(false);

  // Backplan settings state
  const [sleepFromStr, setSleepFromStr] = useState(() => minToHHMM(SETTINGS_DEFAULTS.sleepFrom));
  const [sleepToStr, setSleepToStr] = useState(() => minToHHMM(SETTINGS_DEFAULTS.sleepTo));
  const [abendStr, setAbendStr] = useState(() => minToHHMM(SETTINGS_DEFAULTS.abendZiel));
  const [morgenStr, setMorgenStr] = useState(() => minToHHMM(SETTINGS_DEFAULTS.morgenZiel));
  const [snapMin, setSnapMin] = useState(SETTINGS_DEFAULTS.snapMin);
  const [showFreieZeit, setShowFreieZeit] = useState(SETTINGS_DEFAULTS.showFreieZeit);
  const [minFreieZeit, setMinFreieZeit] = useState(SETTINGS_DEFAULTS.minFreieZeit);

  useEffect(() => {
    setMounted(true);
    const isDark = document.documentElement.classList.contains('dark');
    setDarkMode(isDark);
    const s = loadSettings();
    setShowBakersPercent(!!s.showBakersPercent);
    setSleepFromStr(minToHHMM(s.sleepFrom));
    setSleepToStr(minToHHMM(s.sleepTo));
    setAbendStr(minToHHMM(s.abendZiel));
    setMorgenStr(minToHHMM(s.morgenZiel));
    setSnapMin(s.snapMin);
    setShowFreieZeit(s.showFreieZeit ?? true);
    setMinFreieZeit(s.minFreieZeit ?? 30);
  }, []);

  const toggleTheme = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', !darkMode ? 'dark' : 'light');
  };

  const toggleBakersPercent = () => {
    const next = !showBakersPercent;
    setShowBakersPercent(next);
    saveSettings({ showBakersPercent: next });
  };

  const savePlanSetting = (field: string, value: string | number) => {
    if (typeof value === 'string') {
      // time string HH:MM → minutes
      const min = hhmmToMin(value);
      saveSettings({ [field]: min });
    } else {
      saveSettings({ [field]: value });
    }
  };

  useEffect(() => {
    const checkActivePlans = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
        });
        const data = await res.json();
        setHasActivePlan(Array.isArray(data) && data.some((r: any) => r.planned_at !== null));
      } catch (err) { console.error("Nav-Check Fehler:", err); }
    };
    checkActivePlans();
    const interval = setInterval(checkActivePlans, 30000);
    return () => clearInterval(interval);
  }, [pathname]);

  const navItems = [
    { name: 'Rezepte', href: '/', icon: LayoutGrid },
    { name: 'Suche', href: '/search', icon: Search },
    { name: 'Import', href: '/new', icon: FileDown },
  ];
  const allNavItems = [...navItems];
  if (hasActivePlan) allNavItems.push({ name: 'Backplan', href: '/backplan', icon: Clock });

  return (
    <>
      {/* ── DESKTOP HEADER ── */}
      <header className="hidden md:block fixed top-0 left-0 right-0 z-50">
        <div className="bg-[#8B7355] text-white px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 border-2 border-white/30 rounded-full flex items-center justify-center bg-white/10 overflow-hidden">
              <img src="/logo.png" alt="Crumb Logo" className="w-11 h-11 object-contain" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-black tracking-[-0.05em] text-white leading-none uppercase">Crumb</h1>
              <div className="h-[2px] w-full bg-white/30 mt-1 rounded-full" />
              <p className="text-[10px] font-medium tracking-[0.3em] text-white/80 uppercase mt-1">Perfect Bread, Perfect Timing</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {hasActivePlan && (
              <div className="flex items-center gap-2 bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest animate-pulse border border-white/20">
                <div className="w-2 h-2 bg-orange-400 rounded-full" />
                Backvorgang läuft
              </div>
            )}
            {canInstall && (
              <button onClick={install} className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white text-xs font-bold">
                <Download size={14} /> App installieren
              </button>
            )}

            {/* User Menu */}
            <div className="relative">
              <button onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
                <div className="w-6 h-6 rounded-full bg-[#8B7355] flex items-center justify-center text-white text-xs font-bold">
                  {user?.username ? user.username.slice(0, 2).toUpperCase() : '?'}
                </div>
                <ChevronDown size={14} className="text-white" />
              </button>
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 mt-2 w-60 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 z-50">
                    <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{user?.username || 'Benutzer'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{user?.email}</p>
                    </div>
                    {/* Bäckerprozente Toggle */}
                    <button onClick={toggleBakersPercent}
                      className="flex items-center justify-between w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700">
                      <div className="flex items-center gap-3">
                        <Percent size={15} className={showBakersPercent ? 'text-[#8B7355]' : 'text-gray-400'} />
                        Bäckerprozente
                      </div>
                      <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${showBakersPercent ? 'bg-[#8B7355]' : 'bg-gray-200 dark:bg-gray-600'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showBakersPercent ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                    </button>
                    {/* Backplan-Einstellungen */}
                    <button
                      onClick={() => setShowPlanSettings(!showPlanSettings)}
                      className="flex items-center justify-between w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700"
                    >
                      <div className="flex items-center gap-3">
                        <BedDouble size={15} className="text-gray-400" />
                        Backplan-Einstellungen
                      </div>
                      <span className="text-xs text-gray-400">{showPlanSettings ? '▲' : '▼'}</span>
                    </button>

                    {showPlanSettings && (
                      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 space-y-3 bg-gray-50 dark:bg-gray-700/40">

                        {/* Nachtruhe */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Moon size={11} className="text-gray-400" />
                            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Nachtruhe</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              value={sleepFromStr}
                              onChange={(e) => {
                                setSleepFromStr(e.target.value);
                                savePlanSetting('sleepFrom', e.target.value);
                              }}
                              className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-[#8B7355]"
                            />
                            <span className="text-gray-300 dark:text-gray-500 text-sm">–</span>
                            <input
                              type="time"
                              value={sleepToStr}
                              onChange={(e) => {
                                setSleepToStr(e.target.value);
                                savePlanSetting('sleepTo', e.target.value);
                              }}
                              className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-[#8B7355]"
                            />
                          </div>
                        </div>

                        {/* Zielzeiten */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <AlarmClock size={11} className="text-gray-400" />
                            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Zielzeiten</span>
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 w-20 flex-shrink-0">Abend fertig</span>
                              <input
                                type="time"
                                value={abendStr}
                                onChange={(e) => {
                                  setAbendStr(e.target.value);
                                  savePlanSetting('abendZiel', e.target.value);
                                }}
                                className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-[#8B7355]"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 w-20 flex-shrink-0">Morgen fertig</span>
                              <input
                                type="time"
                                value={morgenStr}
                                onChange={(e) => {
                                  setMorgenStr(e.target.value);
                                  savePlanSetting('morgenZiel', e.target.value);
                                }}
                                className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-[#8B7355]"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Snap */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Clock size={11} className="text-gray-400" />
                            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Snap-Granularität</span>
                          </div>
                          <div className="flex gap-1.5">
                            {[0, 5, 15, 30].map((v) => (
                              <button
                                key={v}
                                onClick={() => {
                                  setSnapMin(v);
                                  saveSettings({ snapMin: v });
                                }}
                                className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                                  snapMin === v
                                    ? 'bg-[#8B7355] border-[#8B7355] text-white'
                                    : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400'
                                }`}
                              >
                                {v === 0 ? 'aus' : `${v} min`}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Freizeit-Liste */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <Clock size={11} className="text-gray-400" />
                              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Freizeit-Liste</span>
                            </div>
                            <div
                              onClick={() => {
                                const next = !showFreieZeit;
                                setShowFreieZeit(next);
                                saveSettings({ showFreieZeit: next });
                              }}
                              className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${showFreieZeit ? 'bg-[#8B7355]' : 'bg-gray-200 dark:bg-gray-600'}`}
                            >
                              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showFreieZeit ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </div>
                          </div>
                          {showFreieZeit && (
                            <div>
                              <span className="text-xs text-gray-400 block mb-1.5">Mindestdauer</span>
                              <div className="flex gap-1.5">
                                {[15, 30, 60].map((v) => (
                                  <button
                                    key={v}
                                    onClick={() => {
                                      setMinFreieZeit(v);
                                      saveSettings({ minFreieZeit: v });
                                    }}
                                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                                      minFreieZeit === v
                                        ? 'bg-[#8B7355] border-[#8B7355] text-white'
                                        : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400'
                                    }`}
                                  >
                                    {v < 60 ? `${v} min` : '1 h'}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Reset */}
                        <button
                          onClick={() => {
                            const d = SETTINGS_DEFAULTS;
                            saveSettings({
                              sleepFrom: d.sleepFrom, sleepTo: d.sleepTo,
                              abendZiel: d.abendZiel, morgenZiel: d.morgenZiel,
                              snapMin: d.snapMin,
                              showFreieZeit: d.showFreieZeit,
                              minFreieZeit: d.minFreieZeit,
                            });
                            setSleepFromStr(minToHHMM(d.sleepFrom));
                            setSleepToStr(minToHHMM(d.sleepTo));
                            setAbendStr(minToHHMM(d.abendZiel));
                            setMorgenStr(minToHHMM(d.morgenZiel));
                            setSnapMin(d.snapMin);
                            setShowFreieZeit(d.showFreieZeit);
                            setMinFreieZeit(d.minFreieZeit);
                          }}
                          className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline"
                        >
                          Auf Standardwerte zurücksetzen
                        </button>
                      </div>
                    )}

                    <Link href="/profile" onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      <KeyRound size={16} /> Passwort ändern
                    </Link>
                    <button onClick={() => { setShowUserMenu(false); logout(); }}
                      className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <LogOut size={16} /> Abmelden
                    </button>
                  </div>
                </>
              )}
            </div>

            <button onClick={toggleTheme} className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
              {mounted && darkMode ? <Sun size={20} className="text-white" /> : <Moon size={20} className="text-white" />}
            </button>
          </div>
        </div>

        <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 flex">
          {allNavItems.map((item) => {
            const isActive = pathname === item.href;
            const isSpecial = item.href === '/backplan';
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-6 py-4 text-sm font-medium transition-all relative group ${
                  isActive ? 'text-[#8B7355]' : isSpecial
                    ? 'text-orange-600 hover:text-orange-700 font-bold'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}>
                <div className="relative">
                  <item.icon size={20} strokeWidth={isActive ? 2.5 : 2}
                    className={isSpecial && !isActive ? 'drop-shadow-[0_0_8px_rgba(234,88,12,0.4)]' : ''} />
                  {isSpecial && !isActive && (
                    <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-600 border border-white" />
                    </span>
                  )}
                </div>
                {item.name}
                {isActive && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#8B7355]" />}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-around h-16 pb-safe">
          {allNavItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href}
                className={`flex flex-col items-center gap-1 transition-colors px-4 ${
                  isActive ? 'text-[#8B7355]' : item.href === '/backplan' ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'
                }`}>
                <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-bold uppercase tracking-tighter">{item.name}</span>
              </Link>
            );
          })}
          {canInstall && (
            <button onClick={install} className="flex flex-col items-center gap-1 text-[#8B7355] px-4">
              <Download size={22} strokeWidth={2} />
              <span className="text-[10px] font-bold uppercase tracking-tighter">Installieren</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}