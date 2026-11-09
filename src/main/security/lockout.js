'use strict';

// Sperre nach Fehlversuchen. Reine Funktionen, der Zustand wird vom Aufrufer gespeichert
// (damit die Sperre einen Neustart überlebt).
//
// Ab dem 5. Fehlversuch: 30 s, dann 1, 2, 4, 8 Minuten, höchstens 15 Minuten.

const FREE_ATTEMPTS = 4; // Versuche 1–4 ohne Wartezeit
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;

function initialState() {
  return { failures: 0, lockedUntil: 0 };
}

function delayForFailures(failures) {
  if (failures <= FREE_ATTEMPTS) return 0;
  const step = failures - FREE_ATTEMPTS - 1; // 5. Fehlversuch → step 0
  return Math.min(BASE_DELAY_MS * 2 ** Math.min(step, 20), MAX_DELAY_MS);
}

function canAttempt(state, now) {
  const s = state || initialState();
  const waitMs = Math.max(0, (s.lockedUntil || 0) - now);
  return { ok: waitMs === 0, waitMs };
}

function registerFailure(state, now) {
  const s = state || initialState();
  const failures = (s.failures || 0) + 1;
  const delay = delayForFailures(failures);
  return { failures, lockedUntil: delay > 0 ? now + delay : 0 };
}

function registerSuccess() {
  return initialState();
}

function formatWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} Sekunden`;
  const m = Math.ceil(s / 60);
  return m === 1 ? '1 Minute' : `${m} Minuten`;
}

module.exports = {
  initialState,
  canAttempt,
  registerFailure,
  registerSuccess,
  delayForFailures,
  formatWait,
  FREE_ATTEMPTS,
  MAX_DELAY_MS,
};
