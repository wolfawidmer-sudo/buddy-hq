'use strict';

// Passwort-Hashing mit scrypt (node:crypto, stabil). Argon2id ist in Node noch experimentell.
// Aus EINEM scrypt-Lauf entstehen 64 Byte:
//   - Bytes 0–31: Prüfwert (wird gespeichert, um das Passwort zu prüfen)
//   - Bytes 32–63: Tresor-Schlüssel (wird NIE gespeichert, nur im Speicher gehalten)
// So braucht ein Login nur einen teuren Lauf, und aus dem gespeicherten Prüfwert
// lässt sich der Tresor-Schlüssel nicht ableiten.

const crypto = require('node:crypto');

const DEFAULT_PARAMS = Object.freeze({ N: 2 ** 17, r: 8, p: 1 }); // OWASP-Empfehlung für scrypt
const SALT_BYTES = 16;
const OUT_BYTES = 64;
const MIN_PASSWORD_LENGTH = 10;

function scryptAsync(password, salt, params) {
  const maxmem = 256 * params.N * params.r + 32 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, OUT_BYTES, { ...params, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

function normalize(s) {
  return String(s).normalize('NFC');
}

function validateNewCredentials(username, password) {
  const u = normalize(username ?? '').trim();
  const p = normalize(password ?? '');
  if (u.length < 1 || u.length > 64) throw new Error('Benutzername: 1 bis 64 Zeichen.');
  if (p.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Passwort: mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
  }
  if (p.length > 1024) throw new Error('Passwort ist zu lang.');
  return { username: u, password: p };
}

// Erstellt einen neuen Datensatz. Gibt { record, vaultKey } zurück.
async function createCredential(password, params = DEFAULT_PARAMS) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const out = await scryptAsync(normalize(password), salt, params);
  const record = {
    algo: 'scrypt',
    N: params.N,
    r: params.r,
    p: params.p,
    salt: salt.toString('base64'),
    verifier: out.subarray(0, 32).toString('base64'),
  };
  const vaultKey = Buffer.from(out.subarray(32, 64));
  out.fill(0);
  return { record, vaultKey };
}

// Prüft ein Passwort. Gibt den Tresor-Schlüssel zurück oder null.
async function verifyCredential(password, record) {
  if (!record || record.algo !== 'scrypt') throw new Error('Unbekanntes Passwort-Format');
  const salt = Buffer.from(record.salt, 'base64');
  const expected = Buffer.from(record.verifier, 'base64');
  const out = await scryptAsync(normalize(password), salt, { N: record.N, r: record.r, p: record.p });
  const ok = expected.length === 32 && crypto.timingSafeEqual(out.subarray(0, 32), expected);
  const vaultKey = ok ? Buffer.from(out.subarray(32, 64)) : null;
  out.fill(0);
  return vaultKey;
}

// Vergleich in konstanter Zeit (für den Benutzernamen).
function safeEqualText(a, b) {
  const ha = crypto.createHash('sha256').update(normalize(a)).digest();
  const hb = crypto.createHash('sha256').update(normalize(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = {
  createCredential,
  verifyCredential,
  validateNewCredentials,
  safeEqualText,
  DEFAULT_PARAMS,
  MIN_PASSWORD_LENGTH,
};
