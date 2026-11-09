'use strict';

// Zeiträume in der Zeitzone Europe/Zurich (inkl. Sommerzeit).
// Ein Zeitraum ist halboffen: [startMs, endMs). endMs ist «jetzt».

const TZ = 'Europe/Zurich';
const PERIODS = Object.freeze(['7d', '30d', 'month', 'year']);
const PERIOD_LABELS = Object.freeze({
  '7d': '7 Tage',
  '30d': '30 Tage',
  month: 'Monat',
  year: 'Jahr',
});

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function zurichParts(ms) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

// Versatz von Zürich zu UTC in Millisekunden zum Zeitpunkt ms.
function offsetMs(ms) {
  const p = zurichParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (ms - (ms % 1000));
}

// UTC-Zeitpunkt von Mitternacht (Zürich) an einem Kalendertag.
function zurichMidnight(year, month, day) {
  const guess = Date.UTC(year, month - 1, day);
  let t = guess - offsetMs(guess);
  t = guess - offsetMs(t); // zweiter Schritt für Tage mit Zeitumstellung
  return t;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// 'YYYY-MM-DD' in Zürcher Zeit.
function dateKey(ms) {
  const p = zurichParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function keyToMidnight(key) {
  const [y, m, d] = key.split('-').map(Number);
  return zurichMidnight(y, m, d);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Liefert { id, label, startMs, endMs, startKey, endKey, days[] }.
// days enthält jeden Kalendertag (Zürich) im Zeitraum, inkl. heute.
function getPeriod(id, nowMs = Date.now()) {
  if (!PERIODS.includes(id)) throw new RangeError(`Unbekannter Zeitraum: ${id}`);
  const today = dateKey(nowMs);
  const [y, m] = today.split('-').map(Number);
  let startKey;
  if (id === '7d') startKey = addDays(today, -6);
  else if (id === '30d') startKey = addDays(today, -29);
  else if (id === 'month') startKey = `${y}-${pad(m)}-01`;
  else startKey = `${y}-01-01`;

  const days = [];
  for (let k = startKey; k <= today; k = addDays(k, 1)) days.push(k);

  return {
    id,
    label: PERIOD_LABELS[id],
    startMs: keyToMidnight(startKey),
    endMs: nowMs,
    startKey,
    endKey: today,
    days,
  };
}

module.exports = {
  TZ,
  PERIODS,
  PERIOD_LABELS,
  getPeriod,
  dateKey,
  addDays,
  keyToMidnight,
  zurichMidnight,
  daysInMonth,
};
