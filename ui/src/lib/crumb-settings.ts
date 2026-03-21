// src/lib/crumb-settings.ts
// Zentrale Settings-Verwaltung für Crumb User-Präferenzen.
// Alle Werte haben sinnvolle Defaults und werden in localStorage persistiert.

export const SETTINGS_KEY = "crumb_settings";

export interface CrumbSettings {
  // Bäckerprozente (bestehend)
  showBakersPercent: boolean;

  // Backplan-Planung
  sleepFrom: number;        // Nachtruhe Beginn in Minuten ab Mitternacht (default: 22:00 = 1320)
  sleepTo: number;          // Nachtruhe Ende in Minuten ab Mitternacht (default: 06:30 = 390)
  abendZiel: number;        // Zielzeit "Abend" in Minuten ab Mitternacht (default: 19:00 = 1140)
  morgenZiel: number;       // Zielzeit "Morgen früh" in Minuten ab Mitternacht (default: 07:30 = 450)
  snapMin: number;          // Snap-Granularität in Minuten: 0=aus, 5, 15, 30 (default: 15)

  // Freizeit-Liste
  showFreieZeit: boolean;   // Freizeit-Liste im Backplan-Modal anzeigen (default: true)
  minFreieZeit: number;     // Mindestdauer freie Zeit in Minuten: 15, 30, 60 (default: 30)
}

export const SETTINGS_DEFAULTS: CrumbSettings = {
  showBakersPercent: false,
  sleepFrom: 22 * 60,       // 22:00
  sleepTo: 6 * 60 + 30,     // 06:30
  abendZiel: 19 * 60,       // 19:00
  morgenZiel: 7 * 60 + 30,  // 07:30
  snapMin: 15,
  showFreieZeit: true,
  minFreieZeit: 30,
};

export function loadSettings(): CrumbSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...SETTINGS_DEFAULTS };
    const parsed = JSON.parse(raw);
    // Merge with defaults so new keys always have a value
    return { ...SETTINGS_DEFAULTS, ...parsed };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function saveSettings(updates: Partial<CrumbSettings>): CrumbSettings {
  const current = loadSettings();
  const next = { ...current, ...updates };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  // Notify other components (e.g. Navigation listens for this)
  window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS_KEY }));
  return next;
}

// Convenience: read a single value with its default
export function getSetting<K extends keyof CrumbSettings>(key: K): CrumbSettings[K] {
  return loadSettings()[key];
}

// Helpers for time display
export function minToHHMM(m: number): string {
  const n = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
}

export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}