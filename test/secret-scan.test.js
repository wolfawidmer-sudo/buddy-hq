'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scanText, scanRepo, mask } = require('../scripts/secret-scan');

// Falsche Keys werden zusammengesetzt, damit dieser Test selbst nicht als Fund gilt.
const fake = {
  stripe: 'rk_' + 'live_' + 'A1b2C3d4E5f6G7h8I9j0',
  openai: 'sk-' + 'admin-' + 'x'.repeat(40),
  anthropic: 'sk-' + 'ant-admin01-' + 'y'.repeat(30),
  supabase: 'sbp_' + 'f'.repeat(40),
  resend: 're_' + 'abc12345_' + 'Z'.repeat(20),
  github: 'github_' + 'pat_' + 'Q'.repeat(60),
};

test('Erkennt Keys aller Dienste', () => {
  for (const [name, key] of Object.entries(fake)) {
    const found = scanText(`const k = "${key}";`);
    assert.equal(found.length, 1, `${name} nicht erkannt`);
    assert.ok(!found[0].preview.includes(key.slice(6, -4)), 'Fund darf nicht ganz ausgegeben werden');
  }
});

test('Normale Texte sind kein Fund', () => {
  assert.deepEqual(scanText('Stripe Restricted Key (rk_...) eintragen\nsk-admin- Präfix'), []);
});

test('Maskierung zeigt nur Anfang und Ende', () => {
  assert.equal(mask('rk_' + 'live_1234567890abcd'), 'rk_l…abcd');
  assert.equal(mask('kurz'), '…');
});

test('Repo-Scan findet .env und Keys in neuen Dateien', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-scan-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'nichts geheimes\n');
  assert.deepEqual(scanRepo(dir), []);
  fs.writeFileSync(path.join(dir, '.env'), 'X=1\n');
  fs.writeFileSync(path.join(dir, 'config.js'), `module.exports = "${fake.stripe}";\n`);
  const found = scanRepo(dir);
  assert.deepEqual(found.map((f) => f.file).sort(), ['.env', 'config.js']);
  fs.rmSync(dir, { recursive: true, force: true });
});
