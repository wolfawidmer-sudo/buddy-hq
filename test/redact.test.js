'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, createLogger, assertNoSecrets } = require('../src/main/security/redact');
const { FAKE_KEYS } = require('./helpers/security');

const ALL = Object.values(FAKE_KEYS);

function capture() {
  const lines = [];
  const sink = { log: (s) => lines.push(s), warn: (s) => lines.push(s), error: (s) => lines.push(s) };
  return { lines, sink };
}

test('Log enthält nie einen Key (bekannt oder nach Muster)', () => {
  const { lines, sink } = capture();
  const log = createLogger({ sink, getSecrets: () => ALL });
  log.info('Anfrage mit', FAKE_KEYS.stripe);
  log.error(new Error(`401 für Key ${FAKE_KEYS.openai}`));
  log.warn({ headers: { authorization: `Bearer ${FAKE_KEYS.anthropic}` } });
  log.info('custom', 'geheimer-wert-ohne-muster-1234');
  const all = lines.join('\n');
  for (const k of ALL) assert.ok(!all.includes(k), 'Key im Log');
  assert.match(all, /…abcd/);
});

test('Unbekannter Key wird über das Muster erkannt', () => {
  const unknown = 'sk-' + 'ant-api03-' + 'q'.repeat(40);
  assert.ok(!redact(`x ${unknown} y`).includes(unknown));
});

test('Header-Werte werden gekürzt', () => {
  const out = redact('x-api-key: abcdefghijklmnop1234');
  assert.ok(!out.includes('abcdefghijklmnop1234'));
  assert.match(out, /…1234/);
});

test('Renderer-Wächter blockiert Keys, lässt Masken durch', () => {
  const ok = { services: [{ id: 'stripe', masked: '…abcd', profit: '123' }] };
  assert.equal(assertNoSecrets(ok, ALL), ok);
  assert.throws(() => assertNoSecrets({ a: { b: [FAKE_KEYS.resend] } }, ALL), /\$\.a\.b\.0/);
  assert.throws(() => assertNoSecrets({ msg: `Fehler ${'rk_' + 'test_' + 'x'.repeat(20)}` }, []), /Key-ähnlich/);
  const loop = { x: 1 };
  loop.self = loop;
  assert.doesNotThrow(() => assertNoSecrets(loop, ALL));
});
