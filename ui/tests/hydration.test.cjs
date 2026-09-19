const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { hydrationDetails } = require('./load-ts.cjs')(path.resolve(__dirname, '../src/lib/hydration.ts'));
const ingredient = (name, amount, unit = 'g', extra = {}) => ({ name, amount, unit, ...extra });
const result = ingredients => hydrationDetails([{ name: 'Hauptteig', ingredients }]);

test('converts kilograms and litres, including decimal commas', () => {
  assert.equal(result([ingredient('Mehl', '0,5', 'kg'), ingredient('Wasser', '0,35', 'l')]).value, 70);
});
test('includes external starter flour and water at its configured hydration', () => {
  assert.equal(result([ingredient('Mehl', 500), ingredient('Wasser', 300), ingredient('Anstellgut', 150, 'g', { hydration_percent: 50 })]).value, 58);
});
test('marks assumed starter hydration explicitly', () => {
  const value = result([ingredient('Mehl', 500), ingredient('Wasser', 300), ingredient('Anstellgut', 100)]);
  assert.equal(value.value, 64);
  assert.equal(value.approximate, true);
  assert.match(value.warnings.join(' '), /100 %/);
});
test('does not count a referenced preferment phase twice', () => {
  const value = hydrationDetails([
    { name: 'Sauerteig', ingredients: [ingredient('Mehl', 100), ingredient('Wasser', 100)] },
    { name: 'Hauptteig', ingredients: [ingredient('Sauerteig', 200), ingredient('Mehl', 400), ingredient('Wasser', 200)] },
  ]);
  assert.equal(value.value, 60);
  assert.equal(value.approximate, false);
});
test('milk contributes an explicitly estimated water fraction', () => {
  const value = result([ingredient('Mehl', 500), ingredient('Milch', 300)]);
  assert.equal(value.value, 52);
  assert.equal(value.approximate, true);
});
test('unsupported flour units and malformed amounts do not produce misleading percentages', () => {
  assert.equal(result([ingredient('Mehl', 3, 'EL'), ingredient('Wasser', 300)]).value, null);
  assert.equal(result([ingredient('Mehl', '500-600'), ingredient('Wasser', 300)]).value, null);
});
