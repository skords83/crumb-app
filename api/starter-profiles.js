// api/starter-profiles.js
const TARGET_PROFILES = [
  { profile_key: 'powerkur', label_de: 'Powerkur', feeding_interval_hours_min: 8, feeding_interval_hours_max: 12, ratio_starter_flour_water: '1:5:5', target_temp_min: 24, target_temp_max: 26,
    description_de: 'Für schnelle Reaktivierung: alle 8–12h füttern, warm stellen. Starter wird nach jedem Peak sofort wieder gefüttert.' },
  { profile_key: 'max_aktivitaet', label_de: 'Maximale Aktivität', feeding_interval_hours_min: 8, feeding_interval_hours_max: 10, ratio_starter_flour_water: '1:3:3', target_temp_min: 26, target_temp_max: 28,
    description_de: 'Etwas stabiler als Powerkur, ideal wenn täglich gebacken wird. Zimmerwarm reicht.' },
  { profile_key: 'ausgeglichen', label_de: 'Ausgeglichen', feeding_interval_hours_min: 12, feeding_interval_hours_max: 24, ratio_starter_flour_water: '1:5:5', target_temp_min: 22, target_temp_max: 24,
    description_de: 'Das Standardverhältnis. Zuverlässig, einfach, normale Zimmertemperatur, kein Stress.' },
  { profile_key: 'minimal', label_de: 'Minimaler Aufwand', feeding_interval_hours_min: 24, feeding_interval_hours_max: 48, ratio_starter_flour_water: '1:1:1', target_temp_min: 18, target_temp_max: 20,
    description_de: 'Wenig Starter, viel Futter, längere Ruhephasen. Kühler Raum verlangsamt die Aktivität zusätzlich.' },
  { profile_key: 'urlaub', label_de: 'Urlaubsmodus', feeding_interval_hours_min: 120, feeding_interval_hours_max: 168, ratio_starter_flour_water: '1:1:1 (Kühlschrank)', target_temp_min: 4, target_temp_max: 6,
    description_de: 'Im Kühlschrank kommt die Fermentation fast zum Stillstand. Vor dem Backen 1× mit 1:5:5 auffrischen.' },
];
const TARGET_PROFILE_KEYS = TARGET_PROFILES.map(p => p.profile_key);
module.exports = { TARGET_PROFILES, TARGET_PROFILE_KEYS };
