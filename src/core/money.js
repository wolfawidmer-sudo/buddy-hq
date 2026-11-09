'use strict';

const { Rational } = require('./rational');

// Geldbeträge in CHF werden als Rappen (BigInt) gespeichert.

const RAPPEN_PER_CHF = 100n;

// Exakter Betrag in CHF (Rational) -> Rappen (BigInt), kaufmännisch gerundet.
function chfToRappen(chf) {
  return Rational.of(chf).mul(new Rational(RAPPEN_PER_CHF)).roundHalfAwayFromZero();
}

// Stripe liefert Beträge bereits in der kleinsten Einheit (Rappen) als Ganzzahl.
function rappenFromMinorUnits(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new RangeError(`Kein ganzzahliger Rappen-Betrag: ${value}`);
}

// Anzeige: «CHF 1’234.50» bzw. «−CHF 12.00». Schweizer Tausendertrennzeichen.
function formatChf(rappen, { sign = false } = {}) {
  const r = BigInt(rappen);
  const neg = r < 0n;
  const abs = neg ? -r : r;
  const francs = (abs / 100n).toString();
  const cents = (abs % 100n).toString().padStart(2, '0');
  const grouped = francs.replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  const prefix = neg ? '−' : sign && r > 0n ? '+' : '';
  return `${prefix}CHF ${grouped}.${cents}`;
}

module.exports = { chfToRappen, rappenFromMinorUnits, formatChf };
