'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Vault } = require('../src/main/security/vault');
const { fakeSafeStorage, tempDir, files, FAKE_KEYS } = require('./helpers/security');

function setup(opts = {}) {
  const dir = tempDir();
  const { vaultFile } = files(dir);
  const vault = new Vault({ file: vaultFile, safeStorage: opts.safe || fakeSafeStorage() });
  const key = crypto.randomBytes(32);
  vault.unlock(key);
  return { dir, vaultFile, vault, key };
}

test('Speichern, lesen, nur maskiert auflisten', () => {
  const { vault } = setup();
  vault.set('stripe', FAKE_KEYS.stripe);
  vault.set('openai', FAKE_KEYS.openai);
  assert.equal(vault.get('stripe'), FAKE_KEYS.stripe);
  assert.deepEqual(vault.list(), [
    { id: 'stripe', masked: '…abcd' },
    { id: 'openai', masked: '…wxyz' },
  ]);
});

test('Datei enthält keinen Klartext, auch nicht unter der DPAPI-Schicht', () => {
  const { vault, vaultFile } = setup();
  vault.set('stripe', FAKE_KEYS.stripe);
  const raw = fs.readFileSync(vaultFile.filePath, 'utf8');
  assert.ok(!raw.includes(FAKE_KEYS.stripe));
  // Äussere Schicht abschälen: darunter liegt nur AES-GCM-Chiffrat
  const blob = JSON.parse(raw).entries.stripe;
  const inner = fakeSafeStorage().decryptString(Buffer.from(blob, 'base64'));
  assert.ok(!inner.includes(FAKE_KEYS.stripe));
  assert.ok(!Buffer.from(JSON.parse(inner).ct, 'base64').toString('utf8').includes('rk_'));
});

test('Neustart: mit richtigem Schlüssel lesbar, mit falschem nicht', () => {
  const { vault, vaultFile, key } = setup();
  vault.set('stripe', FAKE_KEYS.stripe);
  vault.lock();
  assert.throws(() => vault.get('stripe'), /gesperrt/);

  const again = new Vault({ file: vaultFile, safeStorage: fakeSafeStorage() });
  again.unlock(key);
  assert.equal(again.get('stripe'), FAKE_KEYS.stripe);

  const wrong = new Vault({ file: vaultFile, safeStorage: fakeSafeStorage() });
  assert.throws(() => wrong.unlock(crypto.randomBytes(32)), /Passwort passt nicht/);
});

test('Anderes Windows-Konto kann den Tresor nicht lesen (DPAPI)', () => {
  const { vault, vaultFile, key } = setup();
  vault.set('stripe', FAKE_KEYS.stripe);
  const other = new Vault({ file: vaultFile, safeStorage: fakeSafeStorage({ userSecret: 'windows-user-b' }) });
  assert.throws(() => other.unlock(key), /Windows-Konto/);
});

test('Ohne DPAPI wird nichts gespeichert (kein Klartext-Rückfall)', () => {
  const { vault, vaultFile } = setup({ safe: fakeSafeStorage({ available: false }) });
  assert.throws(() => vault.set('stripe', FAKE_KEYS.stripe), /DPAPI/);
  assert.equal(vaultFile.exists(), false);
});

test('Vertauschte Einträge werden erkannt (Dienst-ID ist gebunden)', () => {
  const { vault, vaultFile, key } = setup();
  vault.set('stripe', FAKE_KEYS.stripe);
  vault.set('openai', FAKE_KEYS.openai);
  const data = vaultFile.read();
  [data.entries.stripe, data.entries.openai] = [data.entries.openai, data.entries.stripe];
  vaultFile.write(data);
  const v = new Vault({ file: vaultFile, safeStorage: fakeSafeStorage() });
  assert.throws(() => v.unlock(key), /beschädigt/);
});

test('Neuer Schlüssel (Passwortwechsel), Entfernen, Löschen', () => {
  const { vault, vaultFile } = setup();
  vault.set('stripe', FAKE_KEYS.stripe);
  vault.set('resend', FAKE_KEYS.resend);
  const newKey = crypto.randomBytes(32);
  vault.rekey(newKey);
  const v = new Vault({ file: vaultFile, safeStorage: fakeSafeStorage() });
  v.unlock(newKey);
  assert.equal(v.get('resend'), FAKE_KEYS.resend);
  v.remove('resend');
  assert.equal(v.has('resend'), false);
  v.wipe();
  assert.equal(vaultFile.exists(), false);
  assert.equal(v.unlocked, false);
});

test('Ungültige Eingaben', () => {
  const { vault } = setup();
  assert.throws(() => vault.set('../böse', 'x'.repeat(20)), /Dienst-ID/);
  assert.throws(() => vault.set('stripe', '   '), /Leerer Key/);
});
