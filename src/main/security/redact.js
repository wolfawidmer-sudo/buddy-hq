'use strict';

// Schutz gegen Key-Lecks in Logs und Richtung Renderer.

const { PATTERNS } = require('../../core/secret-patterns');
const { maskSecret } = require('./vault');

// Ersetzt bekannte Keys und alles, was wie ein Key aussieht, durch «…abcd».
function redact(text, knownSecrets = []) {
  let out = String(text);
  for (const s of knownSecrets) {
    if (s && s.length >= 8) out = out.split(s).join(maskSecret(s));
  }
  for (const { re } of PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), (m) => maskSecret(m));
  }
  // Authorization-Header u. Ä. sicherheitshalber ganz kürzen.
  out = out.replace(/(authorization|x-api-key|api[_-]?key)(["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi, (_m, k, sep, v) => `${k}${sep}${maskSecret(v)}`);
  return out;
}

// Logger, der alles filtert. getSecrets liefert die aktuell bekannten Keys.
function createLogger({ sink = console, getSecrets = () => [] } = {}) {
  const fmt = (args) =>
    redact(
      args
        .map((a) => {
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
          } catch {
            return String(a);
          }
        })
        .join(' '),
      getSecrets(),
    );
  return {
    info: (...a) => sink.log(fmt(a)),
    warn: (...a) => sink.warn(fmt(a)),
    error: (...a) => sink.error(fmt(a)),
  };
}

// Wächter für alles, was an den Renderer geht: wirft, wenn irgendwo ein Key steckt.
function assertNoSecrets(payload, knownSecrets = []) {
  const seen = new Set();
  const visit = (v, pathStr) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') {
      for (const s of knownSecrets) {
        if (s && s.length >= 8 && v.includes(s)) throw new Error(`Key im Renderer-Paket bei ${pathStr}`);
      }
      for (const { re } of PATTERNS) {
        if (new RegExp(re.source, re.flags.replace('g', '')).test(v)) {
          throw new Error(`Key-ähnlicher Wert im Renderer-Paket bei ${pathStr}`);
        }
      }
      return;
    }
    if (typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    for (const [k, child] of Object.entries(v)) visit(child, `${pathStr}.${k}`);
  };
  visit(payload, '$');
  return payload;
}

module.exports = { redact, createLogger, assertNoSecrets };
