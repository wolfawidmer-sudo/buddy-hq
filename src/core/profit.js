'use strict';

const { Rational, ZERO } = require('./rational');
const { chfToRappen, rappenFromMinorUnits } = require('./money');
const { dateKey, daysInMonth } = require('./period');

// Reingewinn = Stripe-Netto (nach Gebühren und Rückerstattungen)
//            − Kosten aller Dienste im selben Zeitraum.
//
// Regeln:
// - Exakt rechnen (Rational/BigInt), erst am Ende pro Posten auf Rappen runden.
// - Jeder Posten hat eine Herkunft: live, geschätzt, manuell oder nicht verfügbar.
// - Ein Dienst, der nicht geladen werden kann, wird NICHT als 0 gerechnet,
//   sondern als fehlend gemeldet. Das Ergebnis heisst dann «unvollständig».

const STATUS = Object.freeze({
  LIVE: 'live',
  ESTIMATED: 'estimated',
  MANUAL: 'manual',
  UNAVAILABLE: 'unavailable',
});

const STATUS_LABELS = Object.freeze({
  live: 'live',
  estimated: 'geschätzt',
  manual: 'manuell',
  unavailable: 'nicht verfügbar',
});

// Stripe Balance Transactions, die keine Einnahmen/Kosten sind (Geldbewegung zur Bank).
const STRIPE_EXCLUDED_TYPES = new Set([
  'payout',
  'payout_cancel',
  'payout_failure',
  'payout_minimum_balance_hold',
  'payout_minimum_balance_release',
  'topup',
  'topup_reversal',
]);
const STRIPE_REFUND_TYPES = new Set(['refund', 'refund_failure', 'payment_refund', 'payment_failure_refund']);
const STRIPE_FEE_TYPES = new Set(['stripe_fee', 'tax_fee']);
const STRIPE_SALE_TYPES = new Set(['charge', 'payment']);

class ConversionError extends Error {}

function toChfExact(amount, currency, date, fx, used) {
  const value = Rational.of(amount);
  const cur = String(currency || '').toUpperCase();
  if (!cur) throw new ConversionError('Währung fehlt');
  if (cur === 'CHF') return value;
  const r = fx && fx.toChf(cur, date);
  if (!r) throw new ConversionError(`Kein Wechselkurs ${cur}→CHF für ${date}`);
  used.push({ currency: cur, date, rateDate: r.rateDate, rate: r.rate, source: r.source });
  return value.mul(r.rate);
}

function addTo(map, key, value) {
  map.set(key, (map.get(key) || ZERO).add(value));
}

function computeRevenue(stripe, period, fx, dailyRevenue) {
  const base = {
    status: STATUS.UNAVAILABLE,
    grossRappen: null,
    feesRappen: null,
    refundsRappen: null,
    otherRappen: null,
    netRappen: null,
    count: 0,
    error: null,
  };
  if (!stripe || stripe.status !== STATUS.LIVE) {
    return { ...base, error: (stripe && stripe.error) || 'Stripe nicht geladen' };
  }
  let gross = ZERO;
  let fees = ZERO;
  let refunds = ZERO;
  let net = ZERO;
  let count = 0;
  const used = [];
  try {
    for (const tx of stripe.transactions || []) {
      const ms = Number(tx.created) * 1000;
      if (!(ms >= period.startMs && ms < period.endMs)) continue;
      if (STRIPE_EXCLUDED_TYPES.has(tx.type)) continue;
      const day = dateKey(ms);
      // Stripe-Beträge sind in der kleinsten Einheit → durch 100 teilen.
      const conv = (v) =>
        toChfExact(new Rational(rappenFromMinorUnits(v), 100n), tx.currency, day, fx, used);
      const amount = conv(tx.amount);
      const fee = conv(tx.fee ?? 0);
      const txNet = conv(tx.net);
      if (STRIPE_SALE_TYPES.has(tx.type)) gross = gross.add(amount);
      if (STRIPE_REFUND_TYPES.has(tx.type)) refunds = refunds.add(amount);
      fees = fees.add(fee);
      if (STRIPE_FEE_TYPES.has(tx.type)) fees = fees.sub(amount);
      net = net.add(txNet);
      addTo(dailyRevenue, day, txNet);
      count++;
    }
  } catch (e) {
    if (e instanceof ConversionError || e instanceof RangeError) {
      return { ...base, error: `Stripe: ${e.message}` };
    }
    throw e;
  }
  const grossR = chfToRappen(gross);
  const feesR = chfToRappen(fees);
  const refundsR = chfToRappen(refunds);
  const netR = chfToRappen(net);
  return {
    status: STATUS.LIVE,
    grossRappen: grossR,
    feesRappen: feesR,
    refundsRappen: refundsR,
    // Alles, was nicht Verkauf, Rückerstattung oder Gebühr ist (z. B. Disputes, Anpassungen).
    otherRappen: netR - (grossR + refundsR - feesR),
    netRappen: netR,
    count,
    error: null,
    fxUsed: used,
  };
}

function computeServiceCost(service, period, fx, dailyCosts, items) {
  const result = {
    id: service.id,
    name: service.name,
    status: service.status,
    rappen: null,
    error: service.error || null,
    fxUsed: [],
  };
  if (service.status === STATUS.UNAVAILABLE) {
    result.error = result.error || 'Dienst konnte nicht geladen werden';
    return result;
  }
  if (service.status !== STATUS.LIVE && service.status !== STATUS.ESTIMATED) {
    throw new RangeError(`Ungültiger Status für ${service.id}: ${service.status}`);
  }
  const inPeriod = new Set(period.days);
  const perDay = new Map();
  const perLabel = new Map();
  let total = ZERO;
  try {
    for (const item of service.items || []) {
      if (!inPeriod.has(item.date)) continue;
      const chf = toChfExact(item.amount, item.currency, item.date, fx, result.fxUsed);
      total = total.add(chf);
      addTo(perDay, item.date, chf);
      addTo(perLabel, item.label || service.name, chf);
    }
  } catch (e) {
    if (e instanceof ConversionError || e instanceof RangeError) {
      return { ...result, status: STATUS.UNAVAILABLE, error: e.message, fxUsed: [] };
    }
    throw e;
  }
  for (const [d, v] of perDay) addTo(dailyCosts, d, v);
  for (const [label, v] of perLabel) {
    items.push({ serviceId: service.id, name: service.name, label, status: service.status, value: v });
  }
  result.rappen = chfToRappen(total);
  return result;
}

function isActiveOn(entry, day) {
  if (entry.from && day < entry.from) return false;
  if (entry.until && day > entry.until) return false;
  return true;
}

// Manuelle Fixkosten pro Monat, tagesgenau anteilig verteilt.
function computeManualCost(entry, period, fx, dailyCosts, items) {
  const result = {
    id: entry.id,
    name: entry.name,
    status: STATUS.MANUAL,
    rappen: null,
    error: null,
    link: entry.link || null,
    fxUsed: [],
  };
  let total = ZERO;
  const perDay = new Map();
  try {
    const monthly = Rational.of(entry.monthly);
    for (const day of period.days) {
      if (!isActiveOn(entry, day)) continue;
      const [y, m] = day.split('-').map(Number);
      const share = monthly.div(new Rational(BigInt(daysInMonth(y, m))));
      const chf = toChfExact(share, entry.currency || 'CHF', day, fx, result.fxUsed);
      total = total.add(chf);
      perDay.set(day, chf);
    }
  } catch (e) {
    if (e instanceof ConversionError || e instanceof RangeError) {
      return { ...result, status: STATUS.UNAVAILABLE, error: e.message, fxUsed: [] };
    }
    throw e;
  }
  for (const [d, v] of perDay) addTo(dailyCosts, d, v);
  items.push({ serviceId: entry.id, name: entry.name, label: entry.name, status: STATUS.MANUAL, value: total });
  result.rappen = chfToRappen(total);
  return result;
}

function latestFx(lists) {
  let best = null;
  for (const list of lists) {
    for (const u of list || []) {
      if (!best || u.rateDate > best.rateDate) best = u;
    }
  }
  if (!best) return null;
  return { currency: best.currency, rateDate: best.rateDate, rate: best.rate.toFixed(6), source: best.source };
}

function computeProfit({ period, stripe, services = [], manualCosts = [], fx = null }) {
  if (!period || !Array.isArray(period.days)) throw new TypeError('Zeitraum fehlt');
  const dailyRevenue = new Map();
  const dailyCosts = new Map();
  const items = [];

  const revenue = computeRevenue(stripe, period, fx, dailyRevenue);
  const costs = [
    ...services.map((s) => computeServiceCost(s, period, fx, dailyCosts, items)),
    ...manualCosts.map((m) => computeManualCost(m, period, fx, dailyCosts, items)),
  ];

  const counted = costs.filter((c) => c.status !== STATUS.UNAVAILABLE);
  const totalCostsRappen = counted.reduce((sum, c) => sum + c.rappen, 0n);

  const missing = [];
  if (revenue.status === STATUS.UNAVAILABLE) {
    missing.push({ id: 'stripe', name: 'Stripe', reason: revenue.error });
  }
  for (const c of costs) {
    if (c.status === STATUS.UNAVAILABLE) missing.push({ id: c.id, name: c.name, reason: c.error });
  }

  const profitRappen = revenue.status === STATUS.LIVE ? revenue.netRappen - totalCostsRappen : null;

  // Verlauf pro Tag (für das Diagramm; pro Tag gerundet).
  const daily = period.days.map((d) => ({
    date: d,
    revenueRappen: revenue.status === STATUS.LIVE ? chfToRappen(dailyRevenue.get(d) || ZERO) : null,
    costsRappen: chfToRappen(dailyCosts.get(d) || ZERO),
  }));

  const topCosts = items
    .map((i) => ({ serviceId: i.serviceId, name: i.name, label: i.label, status: i.status, rappen: chfToRappen(i.value) }))
    .filter((i) => i.rappen !== 0n)
    .sort((a, b) => (a.rappen > b.rappen ? -1 : a.rappen < b.rappen ? 1 : 0))
    .slice(0, 5);

  return {
    period: { id: period.id, label: period.label, startKey: period.startKey, endKey: period.endKey },
    revenue,
    costs,
    totalCostsRappen,
    profitRappen,
    complete: missing.length === 0,
    missing,
    daily,
    topCosts,
    fx: latestFx([revenue.fxUsed, ...costs.map((c) => c.fxUsed)]),
  };
}

module.exports = { computeProfit, STATUS, STATUS_LABELS, STRIPE_EXCLUDED_TYPES };
