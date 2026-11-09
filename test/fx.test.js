'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FxTable, parseEcbXml } = require('../src/core/fx');
const { ECB_XML } = require('./fixtures');

test('EZB-XML wird gelesen', () => {
  const days = parseEcbXml(ECB_XML);
  assert.equal(days.size, 5);
  assert.equal(days.get('2026-11-06').USD.toFixed(4), '1.1500');
  assert.throws(() => parseEcbXml('<html>Fehler</html>'));
  assert.throws(() => parseEcbXml('<Cube></Cube>'));
});

test('USD→CHF als Kreuzkurs', () => {
  const fx = new FxTable().addEcbXml(ECB_XML);
  const r = fx.toChf('USD', '2026-11-06');
  // 0.92 / 1.15 = 0.8 genau
  assert.equal(r.rate.toFixed(6), '0.800000');
  assert.equal(r.rateDate, '2026-11-06');
  assert.match(r.source, /EZB/);
});

test('Wochenende nimmt den letzten Arbeitstag', () => {
  const fx = new FxTable().addEcbXml(ECB_XML);
  const sat = fx.toChf('USD', '2026-11-07');
  const sun = fx.toChf('usd', '2026-11-08');
  assert.equal(sat.rateDate, '2026-11-06');
  assert.equal(sun.rateDate, '2026-11-06');
});

test('Kein Kurs, wenn zu alt oder unbekannte Währung', () => {
  const fx = new FxTable().addEcbXml(ECB_XML);
  assert.equal(fx.toChf('USD', '2026-11-20'), null); // > 7 Tage Lücke
  assert.equal(fx.toChf('USD', '2026-10-01'), null);
  assert.equal(fx.toChf('XYZ', '2026-11-06'), null);
  assert.equal(fx.toChf('CHF', '2030-01-01').rate.toFixed(2), '1.00');
});

test('Speichern und Laden ohne Rundungsverlust', () => {
  const fx = new FxTable().addEcbXml(ECB_XML);
  const back = FxTable.fromJSON(JSON.parse(JSON.stringify(fx.toJSON())));
  assert.equal(back.toChf('USD', '2026-11-05').rate.cmp(fx.toChf('USD', '2026-11-05').rate), 0);
  assert.equal(back.latestDate(), '2026-11-06');
});
