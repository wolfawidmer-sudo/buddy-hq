'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCredential,
  verifyCredential,
  validateNewCredentials,
  safeEqualText,
  DEFAULT_PARAMS,
} = require('../src/main/security/password');
const { FAST } = require('./helpers/security');

test('Passwort wird mit Salt gehasht, nie im Klartext gespeichert', async () => {
  const pw = 'korrekt-pferd-batterie';
  const a = await createCredential(pw, FAST);
  const b = await createCredential(pw, FAST);
  assert.notEqual(a.record.salt, b.record.salt);
  assert.notEqual(a.record.verifier, b.record.verifier);
  assert.ok(!JSON.stringify(a.record).includes(pw));
  assert.equal(a.record.algo, 'scrypt');
  // Tresor-Schlüssel steckt nicht im gespeicherten Datensatz
  assert.ok(!JSON.stringify(a.record).includes(a.vaultKey.toString('base64')));
});

test('Richtiges Passwort liefert denselben Tresor-Schlüssel, falsches null', async () => {
  const { record, vaultKey } = await createCredential('mein-langes-passwort', FAST);
  const again = await verifyCredential('mein-langes-passwort', record);
  assert.ok(again && again.equals(vaultKey));
  assert.equal(await verifyCredential('mein-langes-passworT', record), null);
  assert.equal(await verifyCredential('', record), null);
});

test('Unicode-Normalisierung: gleiche Eingabe, andere Codierung', async () => {
  const { record } = await createCredential('Zürich-Sonne-2026', FAST);
  const decomposed = 'Zürich-Sonne-2026';
  assert.ok(await verifyCredential(decomposed, record));
});

test('Sichere Standard-Parameter funktionieren (N=2^17, r=8, p=1)', async () => {
  assert.deepEqual({ ...DEFAULT_PARAMS }, { N: 131072, r: 8, p: 1 });
  const { record } = await createCredential('echte-parameter-test', DEFAULT_PARAMS);
  assert.equal(record.N, 131072);
  assert.ok(await verifyCredential('echte-parameter-test', record));
});

test('Regeln für neue Zugangsdaten', () => {
  assert.throws(() => validateNewCredentials('', 'langgenug123'), /Benutzername/);
  assert.throws(() => validateNewCredentials('wolf', 'kurz'), /mindestens 10/);
  assert.deepEqual(validateNewCredentials('  wolf ', 'langgenug123'), { username: 'wolf', password: 'langgenug123' });
});

test('Benutzername-Vergleich', () => {
  assert.equal(safeEqualText('wolf', 'wolf'), true);
  assert.equal(safeEqualText('wolf', 'Wolf'), false);
});
