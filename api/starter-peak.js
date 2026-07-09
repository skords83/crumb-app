// api/starter-peak.js
const { TARGET_PROFILES } = require('./starter-profiles');

function predictNextPeak(feedings, currentProfileKey) {
  if (!feedings || feedings.length === 0 || !currentProfileKey) {
    return null;
  }

  // Find the profile for the current profile key
  const profile = TARGET_PROFILES.find(p => p.profile_key === currentProfileKey);
  if (!profile) {
    return null;
  }

  // Filter feedings by the current profile
  const profileFeedings = feedings.filter(f => f.target_profile_at_feeding === currentProfileKey);

  if (profileFeedings.length === 0) {
    return null;
  }

  // Count high-activity feedings (activity_rating >= 7)
  const highActivityFeedings = profileFeedings.filter(f => f.activity_rating >= 7);

  if (highActivityFeedings.length >= 3) {
    // Historical approach: use percentiles of feeding gaps
    // Sort feedings chronologically (ascending by fed_at)
    const chronological = profileFeedings.slice().sort((a, b) => new Date(a.fed_at) - new Date(b.fed_at));

    // Calculate gaps between consecutive feedings (in hours)
    const gaps = [];
    for (let i = 1; i < chronological.length; i++) {
      const prevTime = new Date(chronological[i - 1].fed_at);
      const currTime = new Date(chronological[i].fed_at);
      const gapHours = (currTime - prevTime) / 3600000; // Convert ms to hours
      gaps.push(gapHours);
    }

    // If we have gaps, calculate percentiles
    if (gaps.length > 0) {
      const sortedGaps = gaps.slice().sort((a, b) => a - b);
      const p25Index = Math.ceil(sortedGaps.length * 0.25) - 1;
      const p75Index = Math.ceil(sortedGaps.length * 0.75) - 1;
      const windowStart = sortedGaps[Math.max(0, p25Index)];
      const windowEnd = sortedGaps[Math.min(sortedGaps.length - 1, p75Index)];
      const median = sortedGaps[Math.floor(sortedGaps.length / 2)];

      return {
        source: 'historical',
        windowStart: Math.round(windowStart * 100) / 100,
        windowEnd: Math.round(windowEnd * 100) / 100,
        median: Math.round(median * 100) / 100,
      };
    }
  }

  // Profile rule fallback
  const windowStart = profile.feeding_interval_hours_min;
  const windowEnd = profile.feeding_interval_hours_max;
  const median = (windowStart + windowEnd) / 2;

  return {
    source: 'profile_rule',
    windowStart,
    windowEnd,
    median: Math.round(median * 100) / 100,
  };
}

module.exports = { predictNextPeak };
