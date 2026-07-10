// api/starter-peak.js
const { TARGET_PROFILES } = require('./starter-profiles');
const PROFILE_BY_KEY = Object.fromEntries(TARGET_PROFILES.map(p => [p.profile_key, p]));

const MIN_CYCLES_FOR_DATA_BASED = 3;
const HIGH_ACTIVITY_THRESHOLD = 7;

function predictNextPeak(feedings, currentProfileKey) {
  if (!feedings || feedings.length === 0 || !currentProfileKey) {
    return null;
  }

  const profile = PROFILE_BY_KEY[currentProfileKey];
  if (!profile) return null;

  // feedings kommt sortiert nach fed_at DESC (neueste zuerst) - für den
  // Intervall-Vergleich brauchen wir chronologische Reihenfolge
  // (aufsteigend), gleiches Muster wie calculatePlanAdherence.
  const chronological = feedings
    .slice()
    .sort((a, b) => new Date(a.fed_at) - new Date(b.fed_at));

  const lastFeeding = chronological[chronological.length - 1];
  if (!lastFeeding) return null;
  const lastFedAt = new Date(lastFeeding.fed_at);

  // Nur Zeilen mit Snapshot + hohem Aktivitäts-Rating: Näherung für
  // "Fütterung erfolgte nahe am Peak". Kein Beweis, nur Heuristik.
  const highActivityGaps = [];
  for (let i = 1; i < chronological.length; i++) {
    const prev = chronological[i - 1];
    const curr = chronological[i];
    if (
      curr.target_profile_at_feeding === currentProfileKey &&
      curr.activity_rating != null &&
      curr.activity_rating >= HIGH_ACTIVITY_THRESHOLD
    ) {
      const hours = (new Date(curr.fed_at) - new Date(prev.fed_at)) / 36e5;
      if (hours > 0) highActivityGaps.push(hours);
    }
  }

  if (highActivityGaps.length >= MIN_CYCLES_FOR_DATA_BASED) {
    highActivityGaps.sort((a, b) => a - b);
    const median = percentile(highActivityGaps, 50);
    const p25 = percentile(highActivityGaps, 25);
    const p75 = percentile(highActivityGaps, 75);
    return {
      source: 'historical',
      windowStart: addHours(lastFedAt, p25),
      windowEnd: addHours(lastFedAt, p75),
      median: addHours(lastFedAt, median),
    };
  }

  // Fallback: feste Profil-Regel, Fenster = Soll-Intervall des Profils.
  const { feeding_interval_hours_min: min, feeding_interval_hours_max: max } = profile;
  return {
    source: 'profile_rule',
    windowStart: addHours(lastFedAt, min),
    windowEnd: addHours(lastFedAt, max),
    median: null,
  };
}

function percentile(sortedArr, p) {
  const idx = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedArr[lower];
  return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (idx - lower);
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 36e5);
}

module.exports = { predictNextPeak };
