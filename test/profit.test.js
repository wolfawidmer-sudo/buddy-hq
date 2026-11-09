'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeProfit, STATUS } = require('../src/core/profit');
const { getPeriod } = require('../src/core/period');
const { FxTable } = require('../src/core/fx');
const { ECB_XML, NOW, ts } = require('./fixtures');

const fx = new FxTable().addEcbXml(ECB_XML);
const period = getPeriod('month', NOW); // 1.–9.11.2026

const stripe = {
  status: STATUS.LIVE,
  transactions: [
    { type: 'charge', created: ts('2026-11-02T10:00:00Z'), amount: 2000, fee: 88, net: 1912, currency: 'chf' },
    { type: 'charge', created: ts('2026-11-05T10:00:00Z'), amount: 5000, fee: 175, net: 4825, currency: 'chf' },
    { type: 'refund', created: ts('2026-11-06T10:00:00Z'), amount: -2000, fee: 0, net: -2000, currency: 'chf' },
    { type: 'payout', created: ts('2026-11-07T10:00:00Z'), amount: -4737, fee: 0, net: -4737, currency: 'chf' },
    { type: 'stripe_fee', created: ts('2026-11-08T10:00:00Z'), amount: -50, fee: 0, net: -50, currency: 'chf' },
    // 31.10. 23:00 Zürich: gehört nicht mehr zum November
    { type: 'charge', created: ts('2026-10-31T22:00:00Z'), amount: 9999, fee: 0, net: 9999, currency: 'chf' },
  ],
};

const services = [
  {
    id: 'openai',
    name: 'OpenAI',
    status: STATUS.LIVE,
    items: [
      { date: '2026-11-06', amount: '1.25', currency: 'USD', label: 'GPT Eingabe' },
      { date: '2026-11-08', amount: 0.1, currency: 'usd', label: 'GPT Eingabe' }, // Sonntag
      { date: '2026-10-30', amount: '99', currency: 'USD', label: 'GPT Eingabe' }, // ausserhalb
    ],
  },
  {
    id: 'anthropic',
    name: 'Claude',
    status: STATUS.LIVE,
    items: [{ date: '2026-11-04', amount: '2', currency: 'USD', label: 'Claude API' }],
  },
  { id: 'railway', name: 'Railway', status: STATUS.UNAVAILABLE, error: 'Zeitüberschreitung' },
];

const manualCosts = [
  { id: 'godaddy', name: 'Domain buddy-island.top', monthly: '30', currency: 'CHF' },
  { id: 'supabase', name: 'Supabase', monthly: '25', currency: 'USD', from: '2026-11-05' },
];

test('Gewinnrechnung mit Gebühren, Rückerstattung, Auszahlung und Währungen', () => {
  const r = computeProfit({ period, stripe, services, manualCosts, fx });

  assert.equal(r.revenue.status, 'live');
  assert.equal(r.revenue.grossRappen, 7000n);
  assert.equal(r.revenue.feesRappen, 313n); // 88 + 175 + 50 (stripe_fee)
  assert.equal(r.revenue.refundsRappen, -2000n);
  assert.equal(r.revenue.netRappen, 4687n); // Auszahlung zählt nicht
  assert.equal(r.revenue.otherRappen, 0n);
  assert.equal(r.revenue.count, 4);

  const byId = Object.fromEntries(r.costs.map((c) => [c.id, c]));
  assert.equal(byId.openai.rappen, 108n); // (1.25 + 0.10) USD × 0.8
  assert.equal(byId.anthropic.rappen, 160n); // 2 USD × (1.00/1.25)
  assert.equal(byId.godaddy.rappen, 900n); // 30 CHF / 30 Tage × 9 Tage
  assert.equal(byId.godaddy.status, 'manual');
  assert.equal(byId.supabase.rappen, 333n); // 25/30 × 5 Tage × 0.8 = 3.333…

  assert.equal(r.totalCostsRappen, 1501n);
  assert.equal(r.profitRappen, 4687n - 1501n);
});

test('Fehlender Dienst wird nicht als 0 gerechnet, sondern gemeldet', () => {
  const r = computeProfit({ period, stripe, services, manualCosts, fx });
  const railway = r.costs.find((c) => c.id === 'railway');
  assert.equal(railway.status, 'unavailable');
  assert.equal(railway.rappen, null);
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, [{ id: 'railway', name: 'Railway', reason: 'Zeitüberschreitung' }]);
});

test('Ohne Stripe gibt es keinen Gewinn, nur Kosten', () => {
  const r = computeProfit({
    period,
    stripe: { status: STATUS.UNAVAILABLE, error: 'Key ungültig' },
    services: services.slice(0, 2),
    fx,
  });
  assert.equal(r.profitRappen, null);
  assert.equal(r.revenue.netRappen, null);
  assert.equal(r.totalCostsRappen, 268n);
  assert.equal(r.complete, false);
  assert.equal(r.missing[0].id, 'stripe');
  assert.ok(r.daily.every((d) => d.revenueRappen === null));
});

test('Fehlender Wechselkurs macht den Dienst «nicht verfügbar»', () => {
  const r = computeProfit({
    period,
    stripe,
    services: [
      { id: 'openai', name: 'OpenAI', status: STATUS.LIVE, items: [{ date: '2026-11-01', amount: '5', currency: 'USD' }] },
    ],
    fx,
  });
  const c = r.costs[0];
  assert.equal(c.status, 'unavailable');
  assert.match(c.error, /Kein Wechselkurs USD→CHF für 2026-11-01/);
  assert.equal(r.totalCostsRappen, 0n);
  assert.equal(r.complete, false);
});

test('Ungültige Beträge und fehlende Währung brechen nicht still ab', () => {
  const r = computeProfit({
    period,
    stripe,
    services: [
      { id: 'a', name: 'A', status: STATUS.LIVE, items: [{ date: '2026-11-03', amount: '1,50', currency: 'CHF' }] },
      { id: 'b', name: 'B', status: STATUS.LIVE, items: [{ date: '2026-11-03', amount: '1' }] },
    ],
    fx,
  });
  assert.deepEqual(r.costs.map((c) => c.status), ['unavailable', 'unavailable']);
  assert.match(r.costs[1].error, /Währung fehlt/);
});

test('Keine Fliesskomma-Fehler bei vielen kleinen Beträgen', () => {
  const items = Array.from({ length: 1000 }, () => ({ date: '2026-11-03', amount: 0.001, currency: 'CHF' }));
  const r = computeProfit({
    period,
    stripe,
    services: [{ id: 'x', name: 'X', status: STATUS.ESTIMATED, items }],
    fx,
  });
  assert.equal(r.costs[0].rappen, 100n); // genau CHF 1.00
  assert.equal(r.costs[0].status, 'estimated');
});

test('Verlauf pro Tag und die 5 grössten Kostenposten', () => {
  const r = computeProfit({ period, stripe, services, manualCosts, fx });
  assert.equal(r.daily.length, 9);
  const d2 = r.daily.find((d) => d.date === '2026-11-02');
  assert.equal(d2.revenueRappen, 1912n);
  assert.equal(d2.costsRappen, 100n); // nur Domain: CHF 1.00 pro Tag
  const d6 = r.daily.find((d) => d.date === '2026-11-06');
  assert.equal(d6.revenueRappen, -2000n);

  assert.ok(r.topCosts.length <= 5);
  assert.deepEqual(
    r.topCosts.map((t) => t.label),
    ['Domain buddy-island.top', 'Supabase', 'Claude API', 'GPT Eingabe'],
  );
  assert.equal(r.topCosts[0].status, 'manual');
});

test('Verwendeter Kurs wird mit Datum und Quelle ausgewiesen', () => {
  const r = computeProfit({ period, stripe, services, manualCosts, fx });
  assert.equal(r.fx.rateDate, '2026-11-06');
  assert.equal(r.fx.rate, '0.800000');
  assert.match(r.fx.source, /EZB/);
});

test('Fremdwährung bei Stripe wird umgerechnet', () => {
  const r = computeProfit({
    period,
    stripe: {
      status: STATUS.LIVE,
      transactions: [{ type: 'charge', created: ts('2026-11-06T10:00:00Z'), amount: 1000, fee: 50, net: 950, currency: 'usd' }],
    },
    fx,
  });
  assert.equal(r.revenue.grossRappen, 800n);
  assert.equal(r.revenue.netRappen, 760n);
  assert.equal(r.profitRappen, 760n);
  assert.equal(r.complete, true);
});
