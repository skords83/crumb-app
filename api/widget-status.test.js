'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectNextStep, secureKeyMatches } = require('./widget-status');

test('returns null when no sessions are active', () => {
  assert.equal(selectNextStep([]), null);
});

test('expired timer takes priority over a future step', () => {
  const result = selectNextStep([
    { title: 'Brot A', timeline: [{ state: 'active', instruction: 'Backen', end: '2026-09-20T12:00:00Z' }] },
    { title: 'Brot B', timeline: [{ state: 'soft_done', instruction: 'Falten', end: '2026-09-20T10:00:00Z' }] },
  ]);
  assert.equal(result.recipe, 'Brot B');
  assert.equal(result.state, 'soft_done');
});

test('sorts scheduled steps across sessions', () => {
  const result = selectNextStep([
    { title: 'Brot A', timeline: [{ state: 'ready', instruction: 'Formen', scheduled_start: '2026-09-20T12:00:00Z' }] },
    { title: 'Brot B', timeline: [{ state: 'ready', instruction: 'Falten', scheduled_start: '2026-09-20T11:00:00Z' }] },
  ]);
  assert.equal(result.recipe, 'Brot B');
});

test('requires the complete widget key', () => {
  assert.equal(secureKeyMatches('secret', 'secret'), true);
  assert.equal(secureKeyMatches('wrong', 'secret'), false);
  assert.equal(secureKeyMatches('', 'secret'), false);
});
