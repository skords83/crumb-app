const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateHealth, calculatePlanAdherence } = require('./starter-health');

const PROFILE = { feeding_interval_hours_max: 24 };

test('no feedings -> health 0, status Unbekannt', () => {
  const result = calculateHealth([], PROFILE);
  assert.equal(result.health, 0);
  assert.equal(result.status, 'Unbekannt');
});

test('fed just now -> health 100, status Topfit', () => {
  const feedings = [{ fed_at: new Date().toISOString() }];
  const result = calculateHealth(feedings, PROFILE);
  assert.equal(result.health, 100);
  assert.equal(result.status, 'Topfit 🌟');
});

test('overdue by more than the interval -> health decays below 60', () => {
  const overdue = new Date(Date.now() - 48 * 3600000).toISOString(); // 24h over on a 24h-max profile
  const feedings = [{ fed_at: overdue }];
  const result = calculateHealth(feedings, PROFILE);
  assert.ok(result.health < 60, `expected < 60, got ${result.health}`);
});

test('very overdue -> health floors at 0, status Kritisch', () => {
  const veryOverdue = new Date(Date.now() - 24 * 30 * 3600000).toISOString();
  const feedings = [{ fed_at: veryOverdue }];
  const result = calculateHealth(feedings, PROFILE);
  assert.equal(result.health, 0);
  assert.equal(result.status, 'Kritisch');
});

test('consecutive on-time feedings build a streak bonus (capped at +10)', () => {
  const now = Date.now();
  // 5 feedings each 12h apart, well within the 24h-max profile -> streak bonus should apply
  const feedings = [0, 1, 2, 3, 4].map(i => ({ fed_at: new Date(now - i * 12 * 3600000).toISOString() }));
  const result = calculateHealth(feedings, PROFILE);
  assert.equal(result.health, 100); // already capped at 100 (base 100 + bonus, clamped)
});

test('low activity_rating on last feeding penalizes health by 15', () => {
  const feedings = [{ fed_at: new Date().toISOString(), activity_rating: 2 }];
  const result = calculateHealth(feedings, PROFILE);
  assert.equal(result.health, 85); // 100 - 15
});

test('plan adherence returns null with fewer than 2 snapshot-tagged feedings', () => {
  const feedings = [{ fed_at: new Date().toISOString(), target_profile_at_feeding: 'ausgeglichen', flour_grams: 100, water_grams: 100 }];
  const starter = { flour_type: 'weizen' };
  assert.equal(calculatePlanAdherence(feedings, starter), null);
});

test('plan adherence is 100 for on-time, on-hydration, same-flour feedings', () => {
  const now = Date.now();
  // feedings arrive newest-first (DESC), matching the real DB query order
  const feedings = [
    { fed_at: new Date(now).toISOString(), target_profile_at_feeding: 'ausgeglichen', flour_grams: 100, water_grams: 100, flour_type: 'weizen' },
    { fed_at: new Date(now - 18 * 3600000).toISOString(), target_profile_at_feeding: 'ausgeglichen', flour_grams: 100, water_grams: 100, flour_type: 'weizen' },
  ];
  const starter = { flour_type: 'weizen' };
  assert.equal(calculatePlanAdherence(feedings, starter), 100);
});

test('a strongly delayed feeding causes a noticeable but non-zero deduction', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), target_profile_at_feeding: 'ausgeglichen', flour_grams: 100, water_grams: 100, flour_type: 'weizen' },
    { fed_at: new Date(now - 48 * 3600000).toISOString(), target_profile_at_feeding: 'ausgeglichen', flour_grams: 100, water_grams: 100, flour_type: 'weizen' },
  ];
  const starter = { flour_type: 'weizen' };
  const result = calculatePlanAdherence(feedings, starter);
  assert.equal(result, 60);
  assert.ok(result > 0, 'no cliff effect down to 0');
});

test('each feeding is scored against its own snapshot profile, not the current one', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), target_profile_at_feeding: 'powerkur', flour_grams: 100, water_grams: 100, flour_type: 'weizen' },
    { fed_at: new Date(now - 10 * 3600000).toISOString(), target_profile_at_feeding: 'powerkur', flour_grams: 100, water_grams: 100, flour_type: 'weizen' },
  ];
  const starter = { flour_type: 'weizen' };
  // powerkur window is 8-12h; a 10h gap is within window -> full score,
  // regardless of what the starter's current target_profile is now.
  assert.equal(calculatePlanAdherence(feedings, starter), 100);
});

test('feedings without a profile snapshot (pre-migration data) are excluded, not defaulted', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), target_profile_at_feeding: 'ausgeglichen', flour_grams: 100, water_grams: 100, flour_type: 'weizen' },
    { fed_at: new Date(now - 18 * 3600000).toISOString(), target_profile_at_feeding: null, flour_grams: 100, water_grams: 100, flour_type: 'weizen' },
  ];
  const starter = { flour_type: 'weizen' };
  assert.equal(calculatePlanAdherence(feedings, starter), null);
});

test('a flour type different from the starter deducts 15 points', () => {
  const now = Date.now();
  const feedings = [
    { fed_at: new Date(now).toISOString(), target_profile_at_feeding: 'ausgeglichen', flour_grams: 100, water_grams: 100, flour_type: 'roggen' },
    { fed_at: new Date(now - 18 * 3600000).toISOString(), target_profile_at_feeding: 'ausgeglichen', flour_grams: 100, water_grams: 100, flour_type: 'weizen' },
  ];
  const starter = { flour_type: 'weizen' };
  assert.equal(calculatePlanAdherence(feedings, starter), 85);
});
