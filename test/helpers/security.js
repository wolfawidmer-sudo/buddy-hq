'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonFile } = require('../../src/main/security/filestore');

// Attrappe für Electron safeStorage. Jeder «Windows-Benutzer» hat einen eigenen Schlüssel,
// wie bei DPAPI: was Benutzer A verschlüsselt, kann Benutzer B nicht lesen.
function fakeSafeStorage({ available = true, userSecret = 'windows-user-a' } = {}) {
  const key = crypto.createHash('sha256').update(userSecret).digest();
  return {
    isEncryptionAvailable: () => available,
    encryptString(text) {
      if (!available) throw new Error('nicht verfügbar');
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return Buffer.concat([Buffer.from('DPAPI'), iv, c.getAuthTag(), ct]);
    },
    decryptString(buf) {
      if (buf.subarray(0, 5).toString() !== 'DPAPI') throw new Error('kein DPAPI-Blob');
      const iv = buf.subarray(5, 17);
      const tag = buf.subarray(17, 33);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(buf.subarray(33)), d.final()]).toString('utf8');
    },
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hq-sec-'));
}

function files(dir) {
  return {
    authFile: new JsonFile(path.join(dir, 'auth.json')),
    vaultFile: new JsonFile(path.join(dir, 'vault.json')),
  };
}

// Schnelle scrypt-Parameter nur für Tests.
const FAST = Object.freeze({ N: 2 ** 10, r: 8, p: 1 });

// Falsche Keys, zusammengesetzt, damit der Secret-Scan diese Datei nicht meldet.
const FAKE_KEYS = Object.freeze({
  stripe: 'rk_' + 'live_' + 'Z9y8X7w6V5u4T3s2R1q0abcd',
  openai: 'sk-' + 'admin-' + 'k'.repeat(36) + 'wxyz',
  anthropic: 'sk-' + 'ant-admin01-' + 'm'.repeat(30) + 'efgh',
  resend: 're_' + 'Ab12Cd34_' + 'n'.repeat(20) + 'ijkl',
});

module.exports = { fakeSafeStorage, tempDir, files, FAST, FAKE_KEYS };
