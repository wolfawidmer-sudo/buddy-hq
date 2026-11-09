'use strict';

// Schmales API zwischen Renderer und Hauptprozess.
// Der Renderer bekommt nie Keys, nur fertige Zahlen und maskierte Werte («…abcd»).
// Die Kanäle werden in Phase 2–4 ergänzt.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('hq', Object.freeze({
  version: '0.1.0',
}));
