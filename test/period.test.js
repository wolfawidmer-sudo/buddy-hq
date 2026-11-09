'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getPeriod, dateKey } = require('../src/core/period');
const { NOW } = require('./fixtures');

test('Monat aktuell beginnt am 1. um Mitternacht Zürich', () => {
  const p = getPeriod('month', NOW);
  assert.equal(p.startKey, '2026-11-01');
  assert.equal(p.endKey, '2026-11-09');
  assert.equal(new Date(p.startMs).toISOString(), '2026-10-31T23:00:00.000Z');
  assert.equal(p.days.length, 9);
  assert.equal(p.endMs, NOW);
});

test('7 und 30 Tage zählen heute mit', () => {
  const w = getPeriod('7d', NOW);
  assert.equal(w.days.length, 7);
  assert.equal(w.startKey, '2026-11-03');
  const m = getPeriod('30d', NOW);
  assert.equal(m.days.length, 30);
  assert.equal(m.startKey, '2026-10-11');
  // 25.10. war Zeitumstellung: Start 11.10. ist noch Sommerzeit (UTC+2)
  assert.equal(new Date(m.startMs).toISOString(), '2026-10-10T22:00:00.000Z');
});

test('Jahr = Kalenderjahr bis heute', () => {
  const y = getPeriod('year', NOW);
  assert.equal(y.startKey, '2026-01-01');
  assert.equal(new Date(y.startMs).toISOString(), '2025-12-31T23:00:00.000Z');
  assert.equal(y.days.length, 313);
});

test('Sommerzeit und Tagesgrenze', () => {
  const summer = getPeriod('month', Date.UTC(2026, 6, 15, 12));
  assert.equal(new Date(summer.startMs).toISOString(), '2026-06-30T22:00:00.000Z');
  // 23:30 UTC am 9.11. ist in Zürich schon der 10.11.
  assert.equal(dateKey(Date.UTC(2026, 10, 9, 23, 30)), '2026-11-10');
  assert.equal(dateKey(Date.UTC(2026, 10, 9, 22, 59)), '2026-11-09');
});

test('Unbekannter Zeitraum', () => {
  assert.throws(() => getPeriod('quarter', NOW), RangeError);
});
