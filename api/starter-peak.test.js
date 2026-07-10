const test = require('node:test');
const assert = require('node:assert/strict');
const { predictNextPeak } = require('./starter-peak');

test('no feedings -> null', () => {
  const result = predictNextPeak([], 'ausgeglichen');
  assert.equal(result, null);
});

test('null feedings -> null', () => {
  const result = predictNextPeak(null, 'ausgeglichen');
  assert.equal(result, null);
});

test('no currentProfileKey -> null', () => {
  const feedings = [
    { fed_at: new Date().toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, null);
  assert.equal(result, null);
});

test('no profile match (all feedings have different profile) -> profile_rule fallback anchored to last feeding overall', () => {
  // lastFedAt is now derived from the full chronological history (not
  // profile-filtered), so a starter whose feedings never matched the
  // current profile still gets an anchored profile_rule window - it just
  // has zero qualifying high-activity gaps.
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'powerkur' },
    { fed_at: new Date(now - 10 * 3600000).toISOString(), activity_rating: 7, target_profile_at_feeding: 'powerkur' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.ok(result !== null);
  assert.equal(result.source, 'profile_rule');
  assert.ok(result.windowStart instanceof Date);
  assert.ok(result.windowEnd instanceof Date);
  assert.equal(result.windowStart.getTime(), now + 12 * 3600000);
  assert.equal(result.windowEnd.getTime(), now + 24 * 3600000);
  assert.equal(result.median, null);
});

test('fewer than 3 high-activity feedings in current profile -> profile_rule fallback anchored to lastFedAt', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 10 * 3600000).toISOString(), activity_rating: 6, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.ok(result !== null);
  assert.equal(result.source, 'profile_rule');
  assert.equal(result.windowStart.getTime(), now + 12 * 3600000);
  assert.equal(result.windowEnd.getTime(), now + 24 * 3600000);
  assert.equal(result.median, null);
});

test('3 or more high-activity gaps -> historical percentile approach with interpolated window anchored to lastFedAt', () => {
  const now = Date.now();
  // Chronological (oldest -> newest) gaps: 16h, 14h, 12h - all "curr" feedings
  // are high-activity (>=7) and in the current profile, so all 3 gaps qualify.
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 12 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 26 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 42 * 3600000).toISOString(), activity_rating: 7, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.ok(result !== null);
  assert.equal(result.source, 'historical');
  // sorted gaps = [12, 14, 16]; idx = (p/100) * (n - 1), n = 3
  // p25: idx=0.5 -> 12 + (14-12)*0.5 = 13
  // p50: idx=1.0 -> 14
  // p75: idx=1.5 -> 14 + (16-14)*0.5 = 15
  assert.equal(result.windowStart.getTime(), now + 13 * 3600000);
  assert.equal(result.median.getTime(), now + 14 * 3600000);
  assert.equal(result.windowEnd.getTime(), now + 15 * 3600000);
});

test('profile switch: old-profile feedings do not count toward new profile gap stats, but lastFedAt uses full history', () => {
  const now = Date.now();
  // Mixed profiles: some feedings from 'ausgeglichen', some from 'powerkur'.
  // Only gaps whose *later* (curr) feeding is in the current profile and
  // high-activity should count - the powerkur-only gaps must not leak in.
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 12 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 24 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'powerkur' },
    { fed_at: new Date(now - 36 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'powerkur' },
    { fed_at: new Date(now - 48 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'powerkur' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.ok(result !== null);
  // Only 2 qualifying gaps (powerkur->powerkur transitions don't count, and
  // powerkur->ausgeglichen transition's curr is ausgeglichen so it counts;
  // ausgeglichen->ausgeglichen counts too) -> still fewer than 3 -> fallback.
  assert.equal(result.source, 'profile_rule');
  assert.equal(result.windowStart.getTime(), now + 12 * 3600000);
  assert.equal(result.windowEnd.getTime(), now + 24 * 3600000);
  assert.equal(result.median, null);
});

test('3 high-activity-rated feedings but only 2 qualifying gaps -> profile_rule fallback', () => {
  // With only 3 feedings there are only 2 possible consecutive gaps, so even
  // though all 3 feedings are individually high-activity, we can never reach
  // MIN_CYCLES_FOR_DATA_BASED (3) qualifying gaps here.
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 15 * 3600000).toISOString(), activity_rating: 7, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 25 * 3600000).toISOString(), activity_rating: 7, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.ok(result !== null);
  assert.equal(result.source, 'profile_rule');
  assert.equal(result.windowStart.getTime(), now + 12 * 3600000);
  assert.equal(result.windowEnd.getTime(), now + 24 * 3600000);
  assert.equal(result.median, null);
});

test('activity_rating must be >= 7 to count as high-activity', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 7, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 12 * 3600000).toISOString(), activity_rating: 6, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 24 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  // Only 1 qualifying gap (now-12h -> now, curr activity 7); the other gap's
  // curr has activity 6 < 7 so it's excluded -> profile_rule fallback.
  assert.equal(result.source, 'profile_rule');
  assert.equal(result.windowStart.getTime(), now + 12 * 3600000);
  assert.equal(result.windowEnd.getTime(), now + 24 * 3600000);
  assert.equal(result.median, null);
});

test('null activity_rating should not count as high-activity', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 12 * 3600000).toISOString(), activity_rating: null, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 24 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  // Only 1 qualifying gap (now-12h -> now); the gap ending in the
  // null-activity feeding is excluded -> profile_rule fallback.
  assert.equal(result.source, 'profile_rule');
  assert.equal(result.windowStart.getTime(), now + 12 * 3600000);
  assert.equal(result.windowEnd.getTime(), now + 24 * 3600000);
  assert.equal(result.median, null);
});

test('powerkur profile returns correct min/max intervals anchored to lastFedAt', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 6, target_profile_at_feeding: 'powerkur' },
    { fed_at: new Date(now - 10 * 3600000).toISOString(), activity_rating: 6, target_profile_at_feeding: 'powerkur' },
  ];
  const result = predictNextPeak(feedings, 'powerkur');
  assert.equal(result.source, 'profile_rule');
  assert.equal(result.windowStart.getTime(), now + 8 * 3600000);
  assert.equal(result.windowEnd.getTime(), now + 12 * 3600000);
  assert.equal(result.median, null);
});

test('percentile calculation with many gaps produces exact interpolated window anchored to lastFedAt', () => {
  const now = Date.now();
  // 10 feedings, all high-activity and in-profile, fed_at offsets (hours
  // ago) = i * (10 + i) for i = 0..9: 0, 11, 24, 39, 56, 75, 96, 119, 144, 171.
  // Chronological (ascending) consecutive gaps are therefore, in order:
  // 27, 25, 23, 21, 19, 17, 15, 13, 11 hours (9 gaps total).
  const feedings = [];
  for (let i = 0; i < 10; i++) {
    feedings.push({
      fed_at: new Date(now - i * (10 + i) * 3600000).toISOString(),
      activity_rating: 8,
      target_profile_at_feeding: 'ausgeglichen',
    });
  }
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.equal(result.source, 'historical');
  // sorted gaps = [11, 13, 15, 17, 19, 21, 23, 25, 27], n = 9, n-1 = 8
  // p25: idx = 0.25*8 = 2 -> 15
  // p50: idx = 0.5*8 = 4 -> 19
  // p75: idx = 0.75*8 = 6 -> 23
  // lastFedAt = most recent feeding = now (i = 0, offset 0)
  assert.equal(result.windowStart.getTime(), now + 15 * 3600000);
  assert.equal(result.median.getTime(), now + 19 * 3600000);
  assert.equal(result.windowEnd.getTime(), now + 23 * 3600000);
});
