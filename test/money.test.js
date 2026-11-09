'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Rational, parseDecimal } = require('../src/core/rational');
const { chfToRappen, rappenFromMinorUnits, formatChf } = require('../src/core/money');

test('Dezimalwerte werden exakt gelesen', () => {
  assert.equal(parseDecimal('0.1').add('0.2').cmp('0.3'), 0); // 0.1 + 0.2 ist genau 0.3
  assert.equal(parseDecimal('1e-3').cmp(new Rational(1n, 1000n)), 0);
  assert.equal(parseDecimal('-12.50').cmp(new Rational(-25n, 2n)), 0);
  assert.equal(Rational.of(0.07).cmp('0.07'), 0); // Number aus JSON
  assert.throws(() => parseDecimal('12,50'), RangeError);
  assert.throws(() => parseDecimal('abc'), RangeError);
  assert.throws(() => Rational.of(NaN), RangeError);
});

test('Runden auf Rappen: kaufmännisch, symmetrisch', () => {
  assert.equal(chfToRappen('0.005'), 1n);
  assert.equal(chfToRappen('-0.005'), -1n);
  assert.equal(chfToRappen('0.0049'), 0n);
  assert.equal(chfToRappen('19.995'), 2000n);
  assert.equal(chfToRappen(new Rational(1n, 3n)), 33n);
});

test('Rappen aus Stripe-Ganzzahlen', () => {
  assert.equal(rappenFromMinorUnits(1999), 1999n);
  assert.equal(rappenFromMinorUnits('-500'), -500n);
  assert.throws(() => rappenFromMinorUnits(19.99), RangeError);
});

test('Anzeige in Schweizer Schreibweise', () => {
  assert.equal(formatChf(123456n), 'CHF 1’234.56');
  assert.equal(formatChf(-5n), '−CHF 0.05');
  assert.equal(formatChf(100000000n), 'CHF 1’000’000.00');
  assert.equal(formatChf(250n, { sign: true }), '+CHF 2.50');
  assert.equal(formatChf(0n, { sign: true }), 'CHF 0.00');
});

test('toFixed nur für Anzeige', () => {
  assert.equal(parseDecimal('0.8172839').toFixed(4), '0.8173');
  assert.equal(parseDecimal('-1.5').toFixed(0), '-2');
});
