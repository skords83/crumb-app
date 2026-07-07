// api/starter-health.js
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

module.exports = { calculateHealth, statusLabel, calculateFeedingStreak };
