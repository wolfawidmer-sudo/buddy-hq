'use strict';

// Schmales API zwischen Renderer und Hauptprozess.
// Der Renderer bekommt nie Keys: nur fertige Zahlen, Status und maskierte Werte («…abcd»).
// Ein Key geht nur in eine Richtung: vom Eingabefeld zum Hauptprozess (keys.set).

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld(
  'hq',
  Object.freeze({
    auth: Object.freeze({
      status: call('auth:status'),
      setup: call('auth:setup'),
      login: call('auth:login'),
      lock: call('auth:lock'),
      forgot: call('auth:forgot'),
      changePassword: call('auth:change'),
    }),
    data: Object.freeze({ load: call('data:load') }),
    keys: Object.freeze({
      overview: call('keys:overview'),
      set: call('keys:set'),
      remove: call('keys:remove'),
      test: call('keys:test'),
    }),
    config: Object.freeze({ get: call('config:get'), update: call('config:update') }),
    manual: Object.freeze({ upsert: call('manual:upsert'), remove: call('manual:remove') }),
    open: call('ui:open'),
    activity: call('ui:activity'),
    theme: call('ui:theme'),
    onLocked: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('hq:locked', listener);
      return () => ipcRenderer.removeListener('hq:locked', listener);
    },
  }),
);
