'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthService, GENERIC_ERROR } = require('../src/main/security/auth');
const { Vault } = require('../src/main/security/vault');
const { fakeSafeStorage, tempDir, files, FAST, FAKE_KEYS } = require('./helpers/security');

function app(dir, clock) {
  const { authFile, vaultFile } = files(dir);
  const vault = new Vault({ file: vaultFile, safeStorage: fakeSafeStorage() });
  const auth = new AuthService({ authFile, vault, now: clock.now, params: FAST });
  return { auth, vault, authFile, vaultFile };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

const USER = 'wolf';
const PW = 'buddy-hq-geheim-2026';

test('Ersteinrichtung, Login, Sperren', async () => {
  const c = clock();
  const { auth, vault } = app(tempDir(), c);
  assert.equal(auth.status().setUp, false);
  await auth.setup(USER, PW);
  assert.equal(auth.status().unlocked, true);
  vault.set('stripe', FAKE_KEYS.stripe);
  auth.lock();
  assert.equal(vault.unlocked, false);

  const r = await auth.login(USER, PW);
  assert.equal(r.ok, true);
  assert.equal(vault.get('stripe'), FAKE_KEYS.stripe);
  await assert.rejects(auth.setup(USER, PW), /schon eingerichtet/);
});

test('Falscher Name und falsches Passwort geben dieselbe Meldung', async () => {
  const c = clock();
  const { auth } = app(tempDir(), c);
  await auth.setup(USER, PW);
  auth.lock();
  const a = await auth.login('anderer', PW);
  const b = await auth.login(USER, 'falsches-passwort');
  assert.equal(a.error, GENERIC_ERROR);
  assert.equal(b.error, GENERIC_ERROR);
});

test('Nach 5 Fehlversuchen Wartezeit, auch nach Neustart', async () => {
  const c = clock();
  const dir = tempDir();
  const first = app(dir, c);
  await first.auth.setup(USER, PW);
  first.auth.lock();
  for (let i = 0; i < 4; i++) assert.equal((await first.auth.login(USER, 'falsch-falsch')).waitMs, 0);
  const fifth = await first.auth.login(USER, 'falsch-falsch');
  assert.equal(fifth.waitMs, 30_000);
  assert.match(fifth.error, /Warte 30 Sekunden/);

  // «Neustart»: neue Instanz, gleiche Dateien
  const second = app(dir, c);
  const blocked = await second.auth.login(USER, PW);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Zu viele Fehlversuche/);
  assert.equal(second.vault.unlocked, false);

  c.advance(30_000);
  const ok = await second.auth.login(USER, PW);
  assert.equal(ok.ok, true);
  assert.equal(second.auth.status().waitMs, 0);
});

test('Passwort ändern behält die Keys', async () => {
  const c = clock();
  const dir = tempDir();
  const { auth, vault } = app(dir, c);
  await auth.setup(USER, PW);
  vault.set('openai', FAKE_KEYS.openai);
  await auth.changePassword(PW, 'neues-passwort-2027');
  auth.lock();
  assert.equal((await auth.login(USER, PW)).ok, false);
  assert.equal((await auth.login(USER, 'neues-passwort-2027')).ok, true);
  assert.equal(vault.get('openai'), FAKE_KEYS.openai);
});

test('«Passwort vergessen» löscht alle Keys, danach Neueinrichtung', async () => {
  const c = clock();
  const dir = tempDir();
  const { auth, vault, vaultFile, authFile } = app(dir, c);
  await auth.setup(USER, PW);
  vault.set('stripe', FAKE_KEYS.stripe);
  auth.forgotPassword();
  assert.equal(vaultFile.exists(), false);
  assert.equal(authFile.exists(), false);
  assert.equal(auth.status().setUp, false);
  await auth.setup('wolf2', 'ganz-neues-passwort');
  assert.equal(vault.has('stripe'), false);
});

test('Gespeicherte Zugangsdaten enthalten kein Passwort', async () => {
  const c = clock();
  const { auth, authFile } = app(tempDir(), c);
  await auth.setup(USER, PW);
  const raw = JSON.stringify(authFile.read());
  assert.ok(!raw.includes(PW));
});
