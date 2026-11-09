'use strict';

// Hauptprozess. Alle API-Aufrufe laufen nur hier, nie im Renderer.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, session, shell, ipcMain, safeStorage, net, powerMonitor } = require('electron');

const { JsonFile } = require('./security/filestore');
const { Vault } = require('./security/vault');
const { AuthService } = require('./security/auth');
const { IdleLock } = require('./security/idle');
const { createLogger, assertNoSecrets } = require('./security/redact');
const { Config } = require('./config');
const { FxLoader } = require('./services/fx-loader');
const { Hub } = require('./hub');
const { DASHBOARD_HOSTS } = require('./services/registry');

const SMOKE = process.env.BUDDY_HQ_SMOKE === '1';
const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

if (SMOKE) {
  // Eigener, leerer Datenordner für den Selbsttest.
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-hq-smoke-')));
}

let win = null;
let services = null;

function hardenSession(ses) {
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
}

function createServices() {
  const dir = app.getPath('userData');
  const vault = new Vault({ file: new JsonFile(path.join(dir, 'vault.json')), safeStorage });
  const logger = createLogger({ sink: console, getSecrets: () => (vault.unlocked ? vault.knownSecrets() : []) });
  const auth = new AuthService({ authFile: new JsonFile(path.join(dir, 'auth.json')), vault });
  const config = new Config(new JsonFile(path.join(dir, 'config.json')));
  const fetchImpl = (url, opts) => net.fetch(url, opts);
  const fxLoader = new FxLoader({ file: new JsonFile(path.join(dir, 'fx.json')), fetch: fetchImpl });
  const hub = new Hub({ vault, config, fxLoader, fetch: fetchImpl, logger });
  const idle = new IdleLock({
    onLock: () => {
      auth.lock();
      if (win && !win.isDestroyed()) win.webContents.send('hq:locked');
    },
  });
  return { vault, logger, auth, config, hub, idle };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#000000',
    title: 'Buddy HQ',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.loadFile(INDEX);
  return win;
}

// Nur Aufrufe aus unserer eigenen Seite annehmen.
function fromApp(event) {
  const url = event.senderFrame && event.senderFrame.url;
  if (!url || !url.startsWith('file://') || !decodeURIComponent(new URL(url).pathname).replace(/\\/g, '/').endsWith('/renderer/index.html')) {
    throw new Error('Unerlaubter Aufruf');
  }
}

function handle(channel, fn, { needsUnlock = true } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    fromApp(event);
    if (needsUnlock && !services.vault.unlocked) throw new Error('Gesperrt. Bitte anmelden.');
    if (needsUnlock) services.idle.touch();
    const out = await fn(...args);
    return assertNoSecrets(out === undefined ? null : out, services.vault.unlocked ? services.vault.knownSecrets() : []);
  });
}

function openExternalSafe(url) {
  const u = new URL(String(url));
  if (u.protocol !== 'https:' || !DASHBOARD_HOSTS.includes(u.hostname)) throw new Error('Link nicht erlaubt');
  return shell.openExternal(u.toString());
}

function registerIpc() {
  const { auth, hub, config, vault, idle } = services;

  handle('auth:status', () => auth.status(), { needsUnlock: false });
  handle(
    'auth:setup',
    async (u, p) => {
      await auth.setup(u, p);
      idle.start();
      return auth.status();
    },
    { needsUnlock: false },
  );
  handle(
    'auth:login',
    async (u, p) => {
      const r = await auth.login(u, p);
      if (r.ok) idle.start();
      return r;
    },
    { needsUnlock: false },
  );
  handle(
    'auth:lock',
    () => {
      idle.stop();
      auth.lock();
      return auth.status();
    },
    { needsUnlock: false },
  );
  handle(
    'auth:forgot',
    () => {
      idle.stop();
      auth.forgotPassword();
      return auth.status();
    },
    { needsUnlock: false },
  );
  handle('auth:change', (oldPw, newPw) => auth.changePassword(oldPw, newPw).then(() => ({ ok: true })));

  handle('data:load', (period) => hub.load(period));
  handle('keys:overview', () => hub.keyOverview());
  handle('keys:set', (id, value) => {
    vault.set(String(id), String(value));
    return hub.keyOverview();
  });
  handle('keys:remove', (id) => {
    vault.remove(String(id));
    return hub.keyOverview();
  });
  handle('keys:test', (id) => hub.testConnection(String(id)));
  handle('config:get', () => config.get());
  handle('config:update', (patch) => config.update(patch || {}));
  handle('manual:upsert', (entry) => config.upsertManual(entry || {}));
  handle('manual:remove', (id) => config.removeManual(String(id)));
  handle('ui:open', (url) => openExternalSafe(url).then(() => true), { needsUnlock: false });
  handle(
    'ui:activity',
    () => {
      if (vault.unlocked) idle.touch();
      return true;
    },
    { needsUnlock: false },
  );
  handle('ui:theme', () => config.get().theme, { needsUnlock: false });
}

// Selbsttest für CI: Fenster lädt, Sicherheits-Grenzen stimmen, Einrichtung klappt,
// jede Seite lässt sich öffnen, keine Fehler in der Konsole. Ohne Keys (keine echten Dienste).
const SMOKE_FLOW = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 60000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('Zeitüberschreitung'); await wait(100); } };
  const out = {
    hasApi: typeof window.hq === 'object' && typeof window.hq.auth.status === 'function',
    noNode: typeof require === 'undefined' && typeof process === 'undefined',
  };
  await until(() => document.body.dataset.screen === 'setup', 10000);
  out.firstScreen = document.body.dataset.screen;
  document.getElementById('u').value = 'smoke';
  document.getElementById('p').value = 'smoke-passwort-2026';
  document.getElementById('p2').value = 'smoke-passwort-2026';
  document.querySelector('form').requestSubmit();
  await until(() => document.body.dataset.screen === 'app' && document.querySelector('.hero .figure') && !document.querySelector('.figure').textContent.includes('…'));
  out.figure = document.querySelector('.hero .figure').textContent;
  out.pages = [];
  for (const b of [...document.querySelectorAll('nav .nav button')]) {
    const label = b.textContent.trim();
    if (label === 'Sperren') continue;
    b.click();
    await wait(400);
    const h1 = document.querySelector('.page h1, .hero .label');
    out.pages.push(label + ': ' + (h1 ? h1.textContent : '?'));
  }
  return out;
})()`;

function runSmokeTest() {
  const errors = [];
  // Neuere Electron-Versionen liefern ein Event-Objekt, ältere (event, level, message).
  win.webContents.on('console-message', (e, level, message) => {
    const lvl = e && e.level !== undefined ? e.level : level;
    const msg = e && e.message !== undefined ? e.message : message;
    if (lvl === 'error' || lvl === 3) errors.push(String(msg));
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(SMOKE_FLOW);
      const ok = result.hasApi && result.noNode && result.firstScreen === 'setup' && result.pages.length >= 10 && errors.length === 0;
      console.log('SMOKE', JSON.stringify({ ok, ...result, errors, safeStorage: safeStorage.isEncryptionAvailable() }, null, 2));
      app.exit(ok ? 0 : 1);
    } catch (e) {
      console.log('SMOKE FEHLER', e.message, JSON.stringify(errors));
      app.exit(1);
    }
  });
  setTimeout(() => {
    console.log('SMOKE Zeitüberschreitung', JSON.stringify(errors));
    app.exit(1);
  }, 120_000);
}

app.enableSandbox();

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    hardenSession(session.defaultSession);
    services = createServices();
    registerIpc();
    createWindow();
    if (SMOKE) runSmokeTest();

    // Windows gesperrt → Buddy HQ auch sperren. Nach Standby Inaktivität prüfen.
    powerMonitor.on('lock-screen', () => {
      services.idle.stop();
      services.auth.lock();
      if (win && !win.isDestroyed()) win.webContents.send('hq:locked');
    });
    powerMonitor.on('resume', () => services.idle.check());
  });

  app.on('window-all-closed', () => {
    if (services) services.auth.lock();
    app.quit();
  });
}

module.exports = { CSP };
