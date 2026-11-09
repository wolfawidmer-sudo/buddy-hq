'use strict';

// Lokaler Login ohne Backend.
// - Ersteinrichtung: Benutzername + Passwort festlegen.
// - Login: scrypt-Prüfung, Sperre mit steigender Wartezeit (überlebt Neustart).
// - «Passwort vergessen»: löscht ALLE gespeicherten Keys und die Zugangsdaten. Danach neu einrichten.

const { createCredential, verifyCredential, validateNewCredentials, safeEqualText, DEFAULT_PARAMS } = require('./password');
const lockout = require('./lockout');

const GENERIC_ERROR = 'Benutzername oder Passwort falsch.';

class AuthService {
  // authFile: JsonFile, vault: Vault, now: () => ms, params: scrypt-Parameter (Tests: kleiner)
  constructor({ authFile, vault, now = Date.now, params = DEFAULT_PARAMS }) {
    this.authFile = authFile;
    this.vault = vault;
    this.now = now;
    this.params = params;
  }

  readAuth() {
    return this.authFile.read(null);
  }

  isSetUp() {
    const a = this.readAuth();
    return Boolean(a && a.username && a.credential);
  }

  status() {
    const a = this.readAuth();
    const gate = lockout.canAttempt(a && a.lockout, this.now());
    return {
      setUp: Boolean(a && a.credential),
      unlocked: this.vault.unlocked,
      waitMs: gate.waitMs,
    };
  }

  async setup(username, password) {
    if (this.isSetUp()) throw new Error('Zugang ist schon eingerichtet.');
    const v = validateNewCredentials(username, password);
    const { record, vaultKey } = await createCredential(v.password, this.params);
    this.authFile.write({ version: 1, username: v.username, credential: record, lockout: lockout.initialState() });
    this.vault.wipe(); // alte Reste nie übernehmen
    this.vault.unlock(vaultKey);
    vaultKey.fill(0);
    return { ok: true };
  }

  async login(username, password) {
    const a = this.readAuth();
    if (!a || !a.credential) throw new Error('Noch kein Zugang eingerichtet.');
    const gate = lockout.canAttempt(a.lockout, this.now());
    if (!gate.ok) {
      return { ok: false, waitMs: gate.waitMs, error: `Zu viele Fehlversuche. Warte ${lockout.formatWait(gate.waitMs)}.` };
    }
    const userOk = safeEqualText(String(username ?? '').trim(), a.username);
    // Passwort immer prüfen (auch bei falschem Namen), damit die Antwortzeit nichts verrät.
    const vaultKey = await verifyCredential(String(password ?? ''), a.credential);
    if (!userOk || !vaultKey) {
      if (vaultKey) vaultKey.fill(0);
      const next = lockout.registerFailure(a.lockout, this.now());
      this.authFile.write({ ...a, lockout: next });
      const waitMs = Math.max(0, next.lockedUntil - this.now());
      return {
        ok: false,
        waitMs,
        error: waitMs > 0 ? `${GENERIC_ERROR} Warte ${lockout.formatWait(waitMs)}.` : GENERIC_ERROR,
      };
    }
    this.authFile.write({ ...a, lockout: lockout.registerSuccess() });
    this.vault.unlock(vaultKey);
    vaultKey.fill(0);
    return { ok: true, waitMs: 0 };
  }

  lock() {
    this.vault.lock();
  }

  async changePassword(oldPassword, newPassword) {
    const a = this.readAuth();
    const key = await verifyCredential(String(oldPassword ?? ''), a.credential);
    if (!key) throw new Error('Bisheriges Passwort ist falsch.');
    key.fill(0);
    const v = validateNewCredentials(a.username, newPassword);
    const { record, vaultKey } = await createCredential(v.password, this.params);
    this.vault.rekey(vaultKey);
    vaultKey.fill(0);
    this.authFile.write({ ...a, credential: record, lockout: lockout.initialState() });
  }

  // Ehrlich beschriftet in der App: «Passwort vergessen – alle gespeicherten Keys löschen und neu einrichten».
  forgotPassword() {
    this.vault.wipe();
    this.authFile.delete();
  }
}

module.exports = { AuthService, GENERIC_ERROR };
