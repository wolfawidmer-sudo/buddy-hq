'use strict';

// Exakte Bruchzahlen auf BigInt-Basis. Keine Fliesskommazahlen.

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

class Rational {
  constructor(n, d = 1n) {
    if (typeof n !== 'bigint' || typeof d !== 'bigint') {
      throw new TypeError('Rational braucht BigInt');
    }
    if (d === 0n) throw new RangeError('Division durch null');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
    Object.freeze(this);
  }

  static of(value) {
    if (value instanceof Rational) return value;
    if (typeof value === 'bigint') return new Rational(value, 1n);
    if (typeof value === 'string') return parseDecimal(value);
    if (typeof value === 'number') {
      // Zahlen aus JSON (z. B. OpenAI) kommen als Number an. String(x) liefert
      // die kürzeste Dezimaldarstellung, also genau das, was im JSON stand.
      if (!Number.isFinite(value)) throw new RangeError('Ungültige Zahl');
      return parseDecimal(String(value));
    }
    throw new TypeError(`Kein Betrag: ${typeof value}`);
  }

  add(o) {
    o = Rational.of(o);
    return new Rational(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  sub(o) {
    o = Rational.of(o);
    return new Rational(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  mul(o) {
    o = Rational.of(o);
    return new Rational(this.n * o.n, this.d * o.d);
  }

  div(o) {
    o = Rational.of(o);
    if (o.n === 0n) throw new RangeError('Division durch null');
    return new Rational(this.n * o.d, this.d * o.n);
  }

  neg() {
    return new Rational(-this.n, this.d);
  }

  isZero() {
    return this.n === 0n;
  }

  cmp(o) {
    o = Rational.of(o);
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  // Kaufmännisch runden (halbe Einheiten weg von null) auf ganze Zahl.
  roundHalfAwayFromZero() {
    const neg = this.n < 0n;
    const n = neg ? -this.n : this.n;
    const q = n / this.d;
    const r = n % this.d;
    const up = r * 2n >= this.d;
    const res = up ? q + 1n : q;
    return neg ? -res : res;
  }

  // Dezimalstring mit fester Anzahl Stellen (gerundet), nur für Anzeige.
  toFixed(places) {
    const f = 10n ** BigInt(places);
    const scaled = this.mul(new Rational(f)).roundHalfAwayFromZero();
    const neg = scaled < 0n;
    const abs = neg ? -scaled : scaled;
    const s = abs.toString().padStart(places + 1, '0');
    const int = s.slice(0, s.length - places) || '0';
    const frac = places > 0 ? '.' + s.slice(s.length - places) : '';
    return (neg ? '-' : '') + int + frac;
  }
}

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

function parseDecimal(str) {
  const s = String(str).trim();
  const m = DECIMAL_RE.exec(s);
  if (!m) throw new RangeError(`Kein gültiger Dezimalwert: «${s}»`);
  const [, sign, int, frac = '', exp = '0'] = m;
  let n = BigInt(int + frac);
  let d = 10n ** BigInt(frac.length);
  const e = BigInt(exp);
  if (e > 0n) n *= 10n ** e;
  if (e < 0n) d *= 10n ** -e;
  if (sign === '-') n = -n;
  return new Rational(n, d);
}

const ZERO = new Rational(0n);

module.exports = { Rational, parseDecimal, ZERO };
