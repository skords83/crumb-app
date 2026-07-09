// api/starter-health.js
const { TARGET_PROFILES } = require('./starter-profiles');
const PROFILE_BY_KEY = Object.fromEntries(TARGET_PROFILES.map(p => [p.profile_key, p]));

function calculateHealth(feedings, targetProfile) {
  const lastFeeding = feedings[0]; // sortiert nach fed_at DESC
  if (!lastFeeding) return { health: 0, status: 'Unbekannt' };

  const hoursSinceLastFeeding = (Date.now() - new Date(lastFeeding.fed_at)) / 3600000;
  const { feeding_interval_hours_max } = targetProfile;

  let health;
  if (hoursSinceLastFeeding <= feeding_interval_hours_max) {
    health = 100;
  } else {
    const overdueHours = hoursSinceLastFeeding - feeding_interval_hours_max;
    health = Math.max(0, 100 - (overdueHours / feeding_interval_hours_max) * 100);
  }

  const streak = calculateFeedingStreak(feedings, targetProfile);
  health = Math.min(100, health + Math.min(streak * 2, 10));

  if (lastFeeding.activity_rating && lastFeeding.activity_rating <= 3) {
    health -= 15;
  }

  health = Math.max(0, Math.round(health));
  return { health, status: statusLabel(health) };
}

function statusLabel(health) {
  if (health >= 90) return 'Topfit 🌟';
  if (health >= 60) return 'Gut';
  if (health >= 30) return 'Schwächelt';
  return 'Kritisch';
}

function calculateFeedingStreak(feedings, targetProfile) {
  let streak = 0;
  for (let i = 0; i < feedings.length - 1; i++) {
    const gapHours = (new Date(feedings[i].fed_at) - new Date(feedings[i + 1].fed_at)) / 3600000;
    if (gapHours <= targetProfile.feeding_interval_hours_max) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// Misst, wie konsequent die letzten Fütterungen dem jeweils zum
// Fütterungszeitpunkt aktiven Zielprofil entsprachen (0-100%, null bei < 2 Fütterungen).
function calculatePlanAdherence(feedings, starter) {
  // Nur Zeilen mit Snapshot berücksichtigen; ältere Bestandsdaten ohne
  // target_profile_at_feeding (vor der Migration) werden übersprungen,
  // nicht mit dem aktuellen Profil geraten.
  // feedings kommt sortiert nach fed_at DESC (neueste zuerst) - für den
  // Intervall-Vergleich brauchen wir chronologische Reihenfolge (aufsteigend).
  const recent = feedings
    .filter(f => f.target_profile_at_feeding)
    .slice()
    .sort((a, b) => new Date(a.fed_at) - new Date(b.fed_at))
    .slice(-10);
  if (recent.length < 2) return null; // zu wenig Daten für eine Aussage

  let totalScore = 0;
  let scored = 0;

  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const profile = PROFILE_BY_KEY[curr.target_profile_at_feeding];
    if (!profile) continue; // unbekannter/gelöschter Profil-Key, überspringen

    let feedingScore = 100;

    // 1. Intervall-Abweichung vom Soll-Fenster des zum Fütterungszeitpunkt
    //    aktiven Profils (nicht des aktuellen!)
    const hoursSince = (new Date(curr.fed_at) - new Date(prev.fed_at)) / 36e5;
    const { feeding_interval_hours_min: min, feeding_interval_hours_max: max } = profile;
    if (hoursSince < min) {
      feedingScore -= Math.min(30, ((min - hoursSince) / min) * 30);
    } else if (hoursSince > max) {
      feedingScore -= Math.min(40, ((hoursSince - max) / max) * 40);
    }

    // 2. Hydration-Abweichung (nur wenn Mengenangaben vorhanden)
    if (curr.flour_grams > 0 && curr.water_grams != null) {
      const actualHydration = (curr.water_grams / curr.flour_grams) * 100;
      const targetHydration = parseRatioHydration(profile.ratio_starter_flour_water);
      const dev = Math.abs(actualHydration - targetHydration) / targetHydration;
      feedingScore -= Math.min(30, dev * 100);
    }

    // 3. Mehlsorten-Abweichung: Vergleich gegen die Mehlsorte, mit der der
    //    Starter angelegt wurde (starter.flour_type) - NICHT gegen das
    //    Zielprofil, das keine Mehlsorte kennt. Nur wenn pro Fütterung
    //    erfasst, sonst neutral (kein Abzug bei fehlendem Wert).
    if (curr.flour_type && curr.flour_type !== starter.flour_type) {
      feedingScore -= 15;
    }

    totalScore += Math.max(0, feedingScore);
    scored++;
  }

  return scored > 0 ? Math.round(totalScore / scored) : null;
}

function parseRatioHydration(ratioStr) {
  // '1:5:5' → Mehl-Anteil 5, Wasser-Anteil 5 → 100% Hydration
  const parts = ratioStr.match(/\d+/g)?.map(Number);
  if (!parts || parts.length < 3) return 100;
  const [, flourPart, waterPart] = parts;
  return (waterPart / flourPart) * 100;
}

module.exports = { calculateHealth, statusLabel, calculateFeedingStreak, calculatePlanAdherence };
