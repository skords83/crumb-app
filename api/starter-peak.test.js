const test = require('node:test');
const assert = require('node:assert/strict');
const { predictNextPeak } = require('./starter-peak');

test('no feedings -> null', () => {
  const result = predictNextPeak([], 'ausgeglichen');
  assert.equal(result, null);
});

test('empty feedings array -> null', () => {
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

test('no profile match (all feedings have different profile) -> null', () => {
  const feedings = [
    { fed_at: new Date().toISOString(), activity_rating: 8, target_profile_at_feeding: 'powerkur' },
    { fed_at: new Date(Date.now() - 10 * 3600000).toISOString(), activity_rating: 7, target_profile_at_feeding: 'powerkur' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.equal(result, null);
});

test('fewer than 3 high-activity feedings in current profile -> profile_rule fallback', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 10 * 3600000).toISOString(), activity_rating: 6, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.ok(result !== null);
  assert.equal(result.source, 'profile_rule');
  assert.equal(result.windowStart, 12);
  assert.equal(result.windowEnd, 24);
  assert.equal(result.median, 18);
});

test('3 or more high-activity feedings -> historical percentile approach', () => {
  const now = Date.now();
  // Feedings with gaps: 12h, 14h, 16h (in hours)
  // Sorted chronologically (oldest to newest), but fed_at in reverse order (newest first)
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 12 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 26 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 42 * 3600000).toISOString(), activity_rating: 7, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.ok(result !== null);
  assert.equal(result.source, 'historical');
  assert.ok(result.windowStart >= 0);
  assert.ok(result.windowEnd >= result.windowStart);
  assert.ok(result.median >= result.windowStart && result.median <= result.windowEnd);
});

test('profile switch: old-profile feedings do not count toward new profile stats', () => {
  const now = Date.now();
  // Mixed profiles: some feedings from 'ausgeglichen', some from 'powerkur'
  // The function should only consider feedings with target_profile_at_feeding === currentProfileKey
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 12 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 24 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'powerkur' },
    { fed_at: new Date(now - 36 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'powerkur' },
    { fed_at: new Date(now - 48 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'powerkur' },
  ];
  // When asking for 'ausgeglichen' predictions, we should have only 2 feedings
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.ok(result !== null);
  // Only 2 feedings with 'ausgeglichen' profile, so should use profile_rule fallback
  assert.equal(result.source, 'profile_rule');
});

test('historical prediction with exactly 3 high-activity feedings', () => {
  const now = Date.now();
  // Exactly 3 high-activity feedings with gaps: 15h, 10h
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 15 * 3600000).toISOString(), activity_rating: 7, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 25 * 3600000).toISOString(), activity_rating: 7, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  assert.ok(result !== null);
  assert.equal(result.source, 'historical');
});

test('activity_rating must be >= 7 to count as high-activity', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 7, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 12 * 3600000).toISOString(), activity_rating: 6, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 24 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  // Only 2 feedings have activity >= 7, so profile_rule fallback
  assert.equal(result.source, 'profile_rule');
});

test('null activity_rating should not count as high-activity', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 12 * 3600000).toISOString(), activity_rating: null, target_profile_at_feeding: 'ausgeglichen' },
    { fed_at: new Date(now - 24 * 3600000).toISOString(), activity_rating: 8, target_profile_at_feeding: 'ausgeglichen' },
  ];
  const result = predictNextPeak(feedings, 'ausgeglichen');
  // Only 2 feedings have activity >= 7, so profile_rule fallback
  assert.equal(result.source, 'profile_rule');
});

test('powerkur profile returns correct min/max intervals', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), activity_rating: 6, target_profile_at_feeding: 'powerkur' },
    { fed_at: new Date(now - 10 * 3600000).toISOString(), activity_rating: 6, target_profile_at_feeding: 'powerkur' },
  ];
  const result = predictNextPeak(feedings, 'powerkur');
  assert.equal(result.source, 'profile_rule');
  assert.equal(result.windowStart, 8);
  assert.equal(result.windowEnd, 12);
  assert.equal(result.median, 10);
});

test('percentile calculation with many gaps produces reasonable window', () => {
  const now = Date.now();
  // Create many feedings with varying gaps
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
  assert.ok(result.windowStart > 0);
  assert.ok(result.windowEnd >= result.windowStart);
  assert.ok(result.median > 0);
});
