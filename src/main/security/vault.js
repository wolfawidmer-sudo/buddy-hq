'use strict';

// Tresor für API-Keys. Zwei Schichten:
//   1. AES-256-GCM mit dem Tresor-Schlüssel aus dem Passwort (scrypt). Die Dienst-ID ist
//      als AAD gebunden, damit sich Einträge nicht vertauschen lassen.
//   2. Das Ergebnis wird zusätzlich mit Electron safeStorage verschlüsselt (Windows DPAPI).
// Ohne Passwort UND ohne das Windows-Konto ist nichts lesbar.
// Ist safeStorage nicht verfügbar, wird NICHT im Klartext gespeichert, sondern abgebrochen.
//
// Keys verlassen diese Klasse nur über get() – das ruft ausschliesslich der Hauptprozess auf.
// Für Anzeige gibt es nur mask() («…abcd»).

const crypto = require('node:crypto');

const VERSION = 1;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;

function maskSecret(value) {
  const v = String(value);
  return v.length >= 8 ? `…${v.slice(-4)}` : '…';
}

class Vault {
  // file: JsonFile, safeStorage: { isEncryptionAvailable, encryptString, decryptString }
  constructor({ file, safeStorage }) {
    this.file = file;
    this.safe = safeStorage;
    this.key = null;
    this.cache = new Map(); // id -> Klartext, nur solange entsperrt
  }

  get unlocked() {
    return this.key !== null;
  }

  ensureSafe() {
    if (!this.safe || !this.safe.isEncryptionAvailable()) {
      throw new Error('Windows-Verschlüsselung (DPAPI) ist nicht verfügbar. Keys werden nicht gespeichert.');
    }
  }

  readData() {
    const data = this.file.read({ version: VERSION, entries: {} });
    if (data.version !== VERSION || typeof data.entries !== 'object') {
      throw new Error('Tresor-Datei hat ein unbekanntes Format');
    }
    return data;
  }

  // Entsperren mit dem Schlüssel aus dem Login. Prüft, dass alle Einträge lesbar sind.
  unlock(vaultKey) {
    if (!Buffer.isBuffer(vaultKey) || vaultKey.length !== 32) throw new Error('Ungültiger Tresor-Schlüssel');
    this.key = Buffer.from(vaultKey);
    this.cache.clear();
    const data = this.readData();
    const ids = Object.keys(data.entries);
    if (ids.length > 0) this.ensureSafe();
    for (const id of ids) {
      this.cache.set(id, this.decryptEntry(id, data.entries[id]));
    }
  }

  lock() {
    if (this.key) this.key.fill(0);
    this.key = null;
    this.cache.clear();
  }

  requireUnlocked() {
    if (!this.unlocked) throw new Error('Tresor ist gesperrt');
  }

  encryptEntry(id, value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`buddy-hq:${id}`));
    const ct = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const inner = JSON.stringify({ iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
    return this.safe.encryptString(inner).toString('base64');
  }

  decryptEntry(id, stored) {
    let inner;
    try {
      inner = JSON.parse(this.safe.decryptString(Buffer.from(stored, 'base64')));
    } catch {
      throw new Error('Tresor kann mit diesem Windows-Konto nicht gelesen werden');
    }
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(inner.iv, 'base64'));
      decipher.setAAD(Buffer.from(`buddy-hq:${id}`));
      decipher.setAuthTag(Buffer.from(inner.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(inner.ct, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Tresor-Eintrag ist beschädigt oder das Passwort passt nicht');
    }
  }

  set(id, value) {
    this.requireUnlocked();
    if (!ID_RE.test(id)) throw new Error('Ungültige Dienst-ID');
    const v = String(value ?? '').trim();
    if (!v) throw new Error('Leerer Key');
    if (v.length > 4096) throw new Error('Key ist zu lang');
    this.ensureSafe();
    const data = this.readData();
    data.entries[id] = this.encryptEntry(id, v);
    this.file.write(data);
    this.cache.set(id, v);
  }

  // NUR für den Hauptprozess (API-Aufrufe). Nie an den Renderer geben.
  get(id) {
    this.requireUnlocked();
    return this.cache.get(id) ?? null;
  }

  has(id) {
    this.requireUnlocked();
    return this.cache.has(id);
  }

  remove(id) {
    this.requireUnlocked();
    const data = this.readData();
    delete data.entries[id];
    this.file.write(data);
    this.cache.delete(id);
  }

  // Was der Renderer sehen darf: Dienst-ID und «…abcd».
  list() {
    this.requireUnlocked();
    return [...this.cache].map(([id, v]) => ({ id, masked: maskSecret(v) }));
  }

  // Alle Klartext-Werte (für Log-Filter und Renderer-Wächter).
  knownSecrets() {
    return [...this.cache.values()];
  }

  // Neues Passwort: alle Einträge mit dem neuen Schlüssel neu verschlüsseln.
  rekey(newKey) {
    this.requireUnlocked();
    const values = [...this.cache];
    this.key.fill(0);
    this.key = Buffer.from(newKey);
    const data = { version: VERSION, entries: {} };
    if (values.length > 0) this.ensureSafe();
    for (const [id, v] of values) data.entries[id] = this.encryptEntry(id, v);
    this.file.write(data);
  }

  // «Passwort vergessen»: alles löschen.
  wipe() {
    this.lock();
    this.file.delete();
  }
}

module.exports = { Vault, maskSecret };
