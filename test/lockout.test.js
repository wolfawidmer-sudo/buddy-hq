'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/main/security/lockout');
const { IdleLock } = require('../src/main/security/idle');

test('4 freie Versuche, ab dem 5. steigende Wartezeit bis max. 15 Minuten', () => {
  let s = L.initialState();
  const now = 1_000_000;
  for (let i = 1; i <= 4; i++) {
    s = L.registerFailure(s, now);
    assert.equal(L.canAttempt(s, now).ok, true, `Versuch ${i} sollte frei sein`);
  }
  const waits = [];
  for (let i = 5; i <= 11; i++) {
    s = L.registerFailure(s, now);
    waits.push(L.canAttempt(s, now).waitMs);
  }
  assert.deepEqual(waits, [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000]);
});

test('Wartezeit läuft ab, Erfolg setzt zurück', () => {
  let s = L.initialState();
  for (let i = 0; i < 5; i++) s = L.registerFailure(s, 0);
  assert.equal(L.canAttempt(s, 29_999).ok, false);
  assert.equal(L.canAttempt(s, 30_000).ok, true);
  assert.deepEqual(L.registerSuccess(), { failures: 0, lockedUntil: 0 });
});

test('Wartezeit lesbar', () => {
  assert.equal(L.formatWait(30_000), '30 Sekunden');
  assert.equal(L.formatWait(60_000), '1 Minute');
  assert.equal(L.formatWait(900_000), '15 Minuten');
});

function fakeClock() {
  let t = 0;
  const timers = new Set();
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const h = { fn, at: t + ms };
      timers.add(h);
      return h;
    },
    clearTimer: (h) => timers.delete(h),
    advance(ms) {
      t += ms;
      for (const h of [...timers]) {
        if (h.at <= t) {
          timers.delete(h);
          h.fn();
        }
      }
    },
  };
}

test('Sperrt nach 15 Minuten ohne Eingabe, Eingaben verlängern', () => {
  const c = fakeClock();
  let locked = 0;
  const idle = new IdleLock({ onLock: () => locked++, ...c });
  idle.start();
  c.advance(14 * 60_000);
  idle.touch();
  c.advance(14 * 60_000);
  assert.equal(locked, 0);
  c.advance(60_000);
  assert.equal(locked, 1);
});

test('Nach Standby sofort gesperrt (Zeit zählt, nicht nur der Timer)', () => {
  const c = fakeClock();
  let locked = 0;
  const idle = new IdleLock({ onLock: () => locked++, now: c.now, setTimer: () => null, clearTimer: () => {} });
  idle.start();
  c.advance(20 * 60_000); // Timer lief im Standby nicht
  assert.equal(idle.check(), true);
  assert.equal(locked, 1);
});
