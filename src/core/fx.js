'use strict';

const { Rational, parseDecimal } = require('./rational');

// Wechselkurse aus den EZB-Referenzkursen (Basis EUR).
// USD -> CHF wird als Kreuzkurs berechnet: (CHF je EUR) / (USD je EUR).
// Quelle: https://www.ecb.europa.eu/stats/eurofxref/

const ECB_SOURCE = 'EZB-Referenzkurs (Kreuzkurs über EUR)';
const ECB_URLS = Object.freeze({
  daily: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
  last90Days: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
  full: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
});

// Wie viele Tage zurück ein Kurs gesucht wird (Wochenenden, Feiertage).
const MAX_LOOKBACK_DAYS = 7;

const DAY_RE = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g;
const RATE_RE = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g;

// Liefert Map: Datum -> { CUR: Rational (je 1 EUR) }
function parseEcbXml(xml) {
  if (typeof xml !== 'string' || !xml.includes('Cube')) {
    throw new Error('EZB-Antwort ist kein gültiges Kurs-XML');
  }
  const days = new Map();
  for (const day of xml.matchAll(DAY_RE)) {
    const rates = {};
    for (const r of day[2].matchAll(RATE_RE)) {
      rates[r[1]] = parseDecimal(r[2]);
    }
    if (Object.keys(rates).length > 0) days.set(day[1], rates);
  }
  if (days.size === 0) throw new Error('Keine Kurse im EZB-XML gefunden');
  return days;
}

function previousDate(dateKey) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

class FxTable {
  constructor() {
    this.days = new Map();
  }

  addEcbXml(xml) {
    for (const [date, rates] of parseEcbXml(xml)) this.days.set(date, rates);
    return this;
  }

  // Serialisierbar für den lokalen Speicher (Strings, keine Floats).
  toJSON() {
    const out = {};
    for (const [date, rates] of [...this.days].sort()) {
      out[date] = {};
      for (const [c, r] of Object.entries(rates)) out[date][c] = `${r.n}/${r.d}`;
    }
    return out;
  }

  static fromJSON(obj) {
    const t = new FxTable();
    for (const [date, rates] of Object.entries(obj || {})) {
      const parsed = {};
      for (const [c, s] of Object.entries(rates)) {
        const [n, d] = String(s).split('/');
        parsed[c] = new Rational(BigInt(n), BigInt(d ?? '1'));
      }
      t.days.set(date, parsed);
    }
    return t;
  }

  latestDate() {
    return [...this.days.keys()].sort().at(-1) ?? null;
  }

  // Kurs «1 FROM = x CHF» für ein Datum. Fällt auf frühere Arbeitstage zurück.
  // Gibt null zurück, wenn kein Kurs innerhalb von MAX_LOOKBACK_DAYS da ist.
  toChf(currency, dateKey) {
    const cur = currency.toUpperCase();
    if (cur === 'CHF') {
      return { rate: new Rational(1n), rateDate: dateKey, source: 'keine Umrechnung' };
    }
    let d = dateKey;
    for (let i = 0; i <= MAX_LOOKBACK_DAYS; i++) {
      const rates = this.days.get(d);
      if (rates && rates.CHF) {
        const perEurChf = rates.CHF;
        const perEurFrom = cur === 'EUR' ? new Rational(1n) : rates[cur];
        if (perEurFrom) {
          return { rate: perEurChf.div(perEurFrom), rateDate: d, source: ECB_SOURCE };
        }
      }
      d = previousDate(d);
    }
    return null;
  }
}

module.exports = { FxTable, parseEcbXml, ECB_URLS, ECB_SOURCE, MAX_LOOKBACK_DAYS };
