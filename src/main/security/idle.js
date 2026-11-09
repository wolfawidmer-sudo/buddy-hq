'use strict';

// Automatische Sperre nach Inaktivität (Standard 15 Minuten).
// Uhr und Timer sind austauschbar, damit es sich ohne Warten testen lässt.

const DEFAULT_IDLE_MS = 15 * 60_000;

class IdleLock {
  constructor({ timeoutMs = DEFAULT_IDLE_MS, onLock, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.timeoutMs = timeoutMs;
    this.onLock = onLock || (() => {});
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.lastActivity = null;
    this.timer = null;
    this.active = false;
  }

  start() {
    this.active = true;
    this.touch();
  }

  stop() {
    this.active = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  // Bei jeder Eingabe (Maus, Tastatur) aufrufen.
  touch() {
    if (!this.active) return;
    this.lastActivity = this.now();
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.check(), this.timeoutMs);
  }

  // Auch nach Standby: Zeit seit letzter Aktivität zählt, nicht nur der Timer.
  check() {
    if (!this.active) return false;
    if (this.now() - this.lastActivity >= this.timeoutMs) {
      this.stop();
      this.onLock();
      return true;
    }
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.check(), this.timeoutMs - (this.now() - this.lastActivity));
    return false;
  }
}

module.exports = { IdleLock, DEFAULT_IDLE_MS };
