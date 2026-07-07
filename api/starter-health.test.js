const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateHealth } = require('./starter-health');

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
