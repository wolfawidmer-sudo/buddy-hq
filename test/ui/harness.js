'use strict';

// UI-Vorschau ohne Electron: die echte Hauptprozess-Logik (Login, Tresor, Hub) läuft in Node
// mit Attrappen für alle Dienste. Die Oberfläche läuft in Chrome (Playwright) und spricht über
// window.hq mit Node – wie über das preload-API. Macht Screenshots jeder Seite.
//
// Aufruf: node test/ui/harness.js <playwright-modul> <chrome-pfad> <ausgabe-ordner>
// Nur für die Entwicklung, gehört nicht in die App.

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const [, , pwModule, chromePath, outDir] = process.argv;
const { chromium } = require(pwModule);

const { Vault } = require('../../src/main/security/vault');
const { AuthService } = require('../../src/main/security/auth');
const { JsonFile } = require('../../src/main/security/filestore');
const { assertNoSecrets } = require('../../src/main/security/redact');
const { Config } = require('../../src/main/config');
const { FxLoader } = require('../../src/main/services/fx-loader');
const { Hub } = require('../../src/main/hub');
const { mockFetch } = require('../helpers/mockfetch');
const { routes } = require('../fixtures-services');
const { fakeSafeStorage, tempDir, FAST, FAKE_KEYS } = require('../helpers/security');
const { NOW } = require('../fixtures');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const dir = tempDir();
  const vault = new Vault({ file: new JsonFile(path.join(dir, 'vault.json')), safeStorage: fakeSafeStorage() });
  const auth = new AuthService({ authFile: new JsonFile(path.join(dir, 'auth.json')), vault, params: FAST });
  const config = new Config(new JsonFile(path.join(dir, 'config.json')));
  const fetch = mockFetch(routes({ failOpenAI: process.env.FAIL_OPENAI === '1' }));
  const fxLoader = new FxLoader({ file: new JsonFile(path.join(dir, 'fx.json')), fetch, now: () => NOW });
  const hub = new Hub({ vault, config, fxLoader, fetch, now: () => NOW });

  const api = {
    'auth:status': () => auth.status(),
    'auth:setup': (u, p) => auth.setup(u, p).then(() => auth.status()),
    'auth:login': (u, p) => auth.login(u, p),
    'auth:lock': () => (auth.lock(), auth.status()),
    'auth:forgot': () => (auth.forgotPassword(), auth.status()),
    'auth:change': (a, b) => auth.changePassword(a, b).then(() => ({ ok: true })),
    'data:load': (p) => hub.load(p),
    'keys:overview': () => hub.keyOverview(),
    'keys:set': (id, v) => (vault.set(id, v), hub.keyOverview()),
    'keys:remove': (id) => (vault.remove(id), hub.keyOverview()),
    'keys:test': (id) => hub.testConnection(id),
    'config:get': () => config.get(),
    'config:update': (patch) => config.update(patch),
    'manual:upsert': (e) => config.upsertManual(e),
    'manual:remove': (id) => config.removeManual(id),
    'ui:open': () => true,
    'ui:activity': () => true,
    'ui:theme': () => config.get().theme,
  };

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.exposeFunction('__hqCall', async (channel, args) => {
    try {
      const out = await api[channel](...args);
      return { ok: true, value: assertNoSecrets(out === undefined ? null : out, vault.unlocked ? vault.knownSecrets() : []) };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });
  await page.addInitScript(() => {
    const call = (ch) => async (...args) => {
      const r = await window.__hqCall(ch, args);
      if (!r.ok) throw new Error(r.message);
      return r.value;
    };
    window.hq = {
      auth: { status: call('auth:status'), setup: call('auth:setup'), login: call('auth:login'), lock: call('auth:lock'), forgot: call('auth:forgot'), changePassword: call('auth:change') },
      data: { load: call('data:load') },
      keys: { overview: call('keys:overview'), set: call('keys:set'), remove: call('keys:remove'), test: call('keys:test') },
      config: { get: call('config:get'), update: call('config:update') },
      manual: { upsert: call('manual:upsert'), remove: call('manual:remove') },
      open: call('ui:open'),
      activity: call('ui:activity'),
      theme: call('ui:theme'),
      onLocked: () => () => {},
    };
  });

  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  };

  await page.goto('file://' + path.join(__dirname, '../../src/renderer/index.html'));
  await page.waitForSelector('body[data-screen="setup"]');
  await shot('01-einrichten');

  // Passwörter stimmen nicht überein → Fehlermeldung
  await page.fill('#u', 'wolf');
  await page.fill('#p', 'buddy-hq-geheim-2026');
  await page.fill('#p2', 'anders');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=stimmen nicht überein');

  await page.fill('#p2', 'buddy-hq-geheim-2026');
  await page.click('button[type=submit]');
  await page.waitForSelector('body[data-screen="app"]');

  // Keys über die Oberfläche eintragen (wie Wolf es tun würde)
  await page.click('nav >> text=Einstellungen');
  await page.waitForSelector('.key-row');
  const keyIds = ['stripe', 'openai', 'github', 'supabase', 'railway', 'resend'];
  const keyValues = { ...FAKE_KEYS, github: 'github_' + 'pat_' + 'G'.repeat(60) + 'mnop', supabase: 'sbp_' + 's'.repeat(36) + 'qrst', railway: 'tok-' + crypto.randomBytes(16).toString('hex') };
  for (let i = 0; i < keyIds.length; i++) {
    const row = page.locator('.key-row').nth(i);
    await row.locator('input[type=password]').fill(keyValues[keyIds[i]]);
    await row.locator('button', { hasText: 'Speichern' }).click();
    await page.waitForTimeout(300);
  }
  await page.fill('#cfg-railwayProjectId', 'proj-1');
  await page.click('form >> button:has-text("Speichern")');
  await page.waitForTimeout(300);
  await shot('09-einstellungen');

  // Fixkosten: Claude Pro über die Claude-Seite
  await page.click('nav >> text=Claude');
  await page.fill('#mm', '20');
  await page.click('button:has-text("Hinzufügen")');
  await page.waitForTimeout(500);
  await shot('06-claude');

  // Domain als «+ Dienst» mit Vorlage
  await page.click('nav >> text=+ Dienst');
  await page.click('button.link:has-text("Domain buddy-island.top")');
  await page.fill('#mm', '1.75');
  await page.click('button:has-text("Hinzufügen")');
  await page.waitForTimeout(500);

  await page.click('nav >> text=Reingewinn');
  await page.waitForSelector('.hero .figure');
  await shot('02-reingewinn-dunkel');

  for (const [nav, file] of [
    ['Stripe', '03-stripe'],
    ['Supabase', '04-supabase'],
    ['Railway', '05-railway'],
    ['OpenAI', '07-openai'],
    ['GitHub', '08-github'],
    ['Resend', '10-resend'],
    ['Domain', '11-domain'],
  ]) {
    await page.click(`nav >> text="${nav}"`);
    await shot(file);
  }

  // Hell
  await page.click('nav >> text=Einstellungen');
  await page.click('text=Hell');
  await page.click('nav >> text=Reingewinn');
  await shot('12-reingewinn-hell');
  await page.click('nav >> text="GitHub"');
  await shot('13-github-hell');

  // Sperren und wieder anmelden, falsches Passwort
  await page.click('nav >> text=Sperren');
  await page.waitForSelector('body[data-screen="login"]');
  await page.fill('#u', 'wolf');
  await page.fill('#p', 'falsch-falsch-falsch');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Benutzername oder Passwort falsch');
  await shot('14-anmelden-fehler');

  const html = await page.content();
  const leaked = Object.values(keyValues).filter((k) => html.includes(k));
  const summary = { errors, leaked: leaked.length, calls: fetch.calls.length };
  console.log(JSON.stringify(summary));
  await browser.close();
  if (errors.length || leaked.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
