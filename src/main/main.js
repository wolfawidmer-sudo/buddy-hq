'use strict';

// Hauptprozess. Alle API-Aufrufe laufen später nur hier, nie im Renderer.

const path = require('node:path');
const { app, BrowserWindow, session, shell } = require('electron');

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

function hardenSession(ses) {
  // Keine Berechtigungen (Kamera, Mikrofon, Benachrichtigungen …) für den Renderer.
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b0c',
    title: 'Buddy HQ',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  // Keine Navigation weg von der App, keine neuen Fenster.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

// Links ins offizielle Dashboard: nur https und nur bekannte Hosts (wird in Phase 3 befüllt).
function openExternalSafe(url, allowedHosts) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !allowedHosts.includes(u.hostname)) {
    throw new Error('Link nicht erlaubt');
  }
  return shell.openExternal(u.toString());
}

app.enableSandbox();

app.whenReady().then(() => {
  hardenSession(session.defaultSession);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { CSP, openExternalSafe };
