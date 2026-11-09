'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { mockFetch } = require('./helpers/mockfetch');
const { routes } = require('./fixtures-services');
const { NOW } = require('./fixtures');
const { fakeSafeStorage, tempDir, FAKE_KEYS } = require('./helpers/security');
const { getPeriod } = require('../src/core/period');
const { request } = require('../src/main/services/http');
const stripe = require('../src/main/services/stripe');
const openai = require('../src/main/services/openai');
const github = require('../src/main/services/github');
const supabase = require('../src/main/services/supabase');
const railway = require('../src/main/services/railway');
const resend = require('../src/main/services/resend');
const { domain, findRdapBase } = require('../src/main/services/domain');
const { SERVICES } = require('../src/main/services/registry');
const { Hub } = require('../src/main/hub');
const { Config, DEFAULTS } = require('../src/main/config');
const { FxLoader } = require('../src/main/services/fx-loader');
const { Vault } = require('../src/main/security/vault');
const { JsonFile } = require('../src/main/security/filestore');
const { createLogger } = require('../src/main/security/redact');

const GH_KEY = 'github_' + 'pat_' + 'G'.repeat(60) + 'mnop';
const SB_KEY = 'sbp_' + 's'.repeat(36) + 'qrst';
const RW_KEY = '1b2c3d4e-' + 'aaaa-bbbb-cccc-' + 'ddddeeee9999';
const KEYS = { ...FAKE_KEYS, github: GH_KEY, supabase: SB_KEY, railway: RW_KEY };

const period = getPeriod('month', NOW);
const config = { ...DEFAULTS, railwayProjectId: 'proj-1' };

function ctx(fetch, keys = KEYS) {
  return { fetch, now: () => NOW, config, getKey: (id) => keys[id] || null };
}

test('HTTP: Fehler werden verständlich, nur HTTPS', async () => {
  const f = mockFetch([
    { match: 'https://x.test/401', reply: { status: 401, json: {} } },
    { match: 'https://x.test/403', reply: { status: 403, json: {} } },
    { match: 'https://x.test/500', reply: { status: 503, json: {} } },
    { match: 'https://x.test/bad', reply: { text: '<html>' } },
    { match: 'https://x.test/net', throw: new TypeError('fetch failed') },
    { match: 'https://x.test/slow', throw: Object.assign(new Error('t'), { name: 'TimeoutError' }) },
  ]);
  await assert.rejects(request(f, 'https://x.test/401'), /ungültig oder abgelaufen/);
  await assert.rejects(request(f, 'https://x.test/403'), /nicht die nötigen Rechte/);
  await assert.rejects(request(f, 'https://x.test/500'), /Fehler \(503\)/);
  await assert.rejects(request(f, 'https://x.test/bad'), /kein gültiges JSON/);
  await assert.rejects(request(f, 'https://x.test/net'), /Keine Verbindung/);
  await assert.rejects(request(f, 'https://x.test/slow'), /Keine Antwort/);
  await assert.rejects(request(f, 'http://x.test/'), /Nur HTTPS/);
  assert.equal(f.calls[0].redirect, 'error'); // Keys nie per Weiterleitung weitergeben
});

test('Stripe: blättert durch alle Buchungen, nächste Auszahlung, keine Kundendaten', async () => {
  const f = mockFetch(routes());
  const r = await stripe.load(ctx(f), period);
  assert.equal(r.revenue.transactions.length, 3);
  assert.equal(r.detail.nextPayout.minor, '4737');
  assert.equal(r.detail.recentPayments.length, 1);
  assert.ok(!JSON.stringify(r).includes('kunde@example.com'));
  const txCall = f.calls.find((c) => c.url.includes('balance_transactions'));
  assert.match(txCall.url, /created%5Bgte%5D=1793487600/); // 1.11.2026 00:00 Zürich
  assert.equal(txCall.headers.Authorization, `Bearer ${KEYS.stripe}`);
});

test('OpenAI: Kosten über mehrere Seiten, Tokens pro Modell', async () => {
  const f = mockFetch(routes());
  const r = await openai.load(ctx(f), period);
  assert.deepEqual(
    r.costs.items.map((i) => [i.date, i.amount, i.currency, i.label]),
    [
      ['2026-11-05', 0.5, 'USD', 'gpt-6, output'],
      ['2026-11-06', 1.25, 'USD', 'gpt-6, input'],
    ],
  );
  assert.deepEqual(r.detail.tokens, [{ model: 'gpt-6', input: 1000, output: 200, requests: 3 }]);
  assert.equal(r.detail.balance, null);
  const c = f.calls.find((x) => x.url.includes('/costs?'));
  assert.match(c.url, /start_time=1793491200/); // 1.11. 00:00 UTC
  assert.match(c.url, /group_by=line_item/);
});

test('GitHub: CI-Läufe, Releases, Actions-Kosten', async () => {
  const f = mockFetch(routes());
  const r = await github.load(ctx(f), period);
  assert.equal(r.detail.runs[0].conclusion, 'success');
  assert.equal(r.detail.releases[0].tag, 'v0.12.0');
  assert.equal(r.costs.status, 'live');
  assert.deepEqual(r.costs.items[0], { date: '2026-11-04', amount: 0.08, currency: 'USD', label: 'GitHub actions' });
  assert.ok(f.calls.some((c) => c.url.includes('/users/wolfawidmer-sudo/settings/billing/usage?year=2026&month=11')));
});

test('GitHub: Commit-Raster aus ausgewählten Repos, «wird berechnet» bei 202', async () => {
  const f = mockFetch(routes());
  const c = { ...ctx(f), config: { ...config, activityRepos: ['wolfawidmer-sudo/buddy-island', 'wolfawidmer-sudo/buddy-hq'] } };
  const r = await github.load(c, period);
  const a = r.detail.activity;
  assert.deepEqual(a.repos.map((x) => [x.repo, x.status, x.total]), [
    ['wolfawidmer-sudo/buddy-island', 'ok', 6],
    ['wolfawidmer-sudo/buddy-hq', 'pending', 0],
  ]);
  assert.deepEqual(a.days.filter((d) => d.count > 0), [
    { date: '2026-11-02', count: 3 },
    { date: '2026-11-03', count: 1 },
    { date: '2026-11-05', count: 2 },
  ]);
  assert.equal(a.days.length, 7);
});

test('GitHub: Raster zählt mehrere Repos pro Tag zusammen', () => {
  const w = Date.UTC(2026, 10, 1) / 1000;
  const days = github.combineActivity([
    { weeks: [{ week: w, days: [1, 0, 0, 0, 0, 0, 2] }] },
    { weeks: [{ week: w, days: [4, 0, 0, 0, 0, 0, 0] }] },
  ]);
  assert.equal(days[0].count, 5);
  assert.equal(days[6].date, '2026-11-07');
  assert.equal(days[6].count, 2);
});

test('Repo-Auswahl wird geprüft', () => {
  const cfg = new Config(new JsonFile(path.join(tempDir(), 'c.json')));
  assert.deepEqual(cfg.get().activityRepos, ['wolfawidmer-sudo/buddy-island', 'wolfawidmer-sudo/buddy-hq']);
  cfg.update({ activityRepos: ['wolfawidmer-sudo/racing-game', 'wolfawidmer-sudo/racing-game'] });
  assert.deepEqual(cfg.get().activityRepos, ['wolfawidmer-sudo/racing-game']);
  assert.throws(() => cfg.update({ activityRepos: ['../etc/passwd'] }), /Ungültiges Repo/);
});

test('GitHub: fehlender Billing-Zugriff macht nur die Kosten «nicht verfügbar»', async () => {
  const f = mockFetch([{ match: /billing\/usage/, reply: { status: 403, json: {} } }, ...routes()]);
  const r = await github.load(ctx(f), period);
  assert.equal(r.costs.status, 'unavailable');
  assert.match(r.costs.error, /Rechte/);
  assert.equal(r.detail.runs.length, 1);
});

test('Supabase: Status, Nutzer, Datenbankgrösse über Nur-Lese-Abfrage', async () => {
  const f = mockFetch(routes());
  const r = await supabase.load(ctx(f), period);
  assert.equal(r.detail.allHealthy, true);
  assert.deepEqual(r.detail.stats, { users: '42', dbBytes: '10485760' });
  const q = f.calls.find((c) => c.method === 'POST');
  assert.match(q.url, /\/projects\/ifbpbsbgdpnxmwtycjqr\/database\/query\/read-only$/);
  assert.match(JSON.parse(q.body).query, /^select /);
});

test('Railway: Projekt, letzte Deploys, Health-Check; ohne Key nur Health', async () => {
  const f = mockFetch(routes());
  const r = await railway.load(ctx(f), period);
  assert.equal(r.detail.project.name, 'buddy-backend');
  assert.equal(r.detail.deployments[0].status, 'SUCCESS');
  assert.equal(r.detail.health.ok, true);
  const healthCall = f.calls.find((c) => c.url.includes('/health'));
  assert.equal(healthCall.headers.Authorization, undefined); // Health ohne Key

  const f2 = mockFetch(routes());
  const r2 = await railway.load(ctx(f2, {}), period);
  assert.equal(r2.partial, true);
  assert.ok(!f2.calls.some((c) => c.url.includes('backboard')));
});

test('Railway: GraphQL-Fehler wird gemeldet', async () => {
  const f = mockFetch([{ method: 'POST', match: 'https://backboard.railway.com/', reply: { json: { errors: [{ message: 'Not Authorized' }] } } }, ...routes()]);
  await assert.rejects(railway.test(ctx(f)), /Not Authorized/);
});

test('Resend: zählt nur Mails im Zeitraum, ohne Empfänger', async () => {
  const f = mockFetch(routes());
  const r = await resend.load(ctx(f), period);
  assert.equal(r.detail.total, 2);
  assert.deepEqual(r.detail.counts, { delivered: 1, bounced: 1 });
  assert.equal(r.detail.complete, true);
  assert.ok(!JSON.stringify(r).includes('example.com'));
});

test('Domain: Ablaufdatum über RDAP, ohne Key', async () => {
  const f = mockFetch(routes());
  const r = await domain.load(ctx(f), period);
  assert.equal(r.detail.expires, '2027-11-05T09:00:00Z');
  assert.equal(r.detail.registrar, 'GoDaddy.com, LLC');
  assert.equal(r.detail.daysLeft, 360); // 9.11. 12:00 → 5.11.2027 10:00 = 360 volle Tage
  assert.ok(f.calls.every((c) => !c.headers.Authorization));
  assert.equal(findRdapBase({ services: [] }, 'x.top'), null);
});

test('Ohne Key: klare Meldung statt Absturz', async () => {
  const f = mockFetch(routes());
  for (const svc of [stripe, openai, github, supabase, resend]) {
    await assert.rejects(svc.load(ctx(f, {}), period), /Kein Key eingetragen/);
  }
  assert.equal(f.calls.length, 0);
});

test('Jeder Key geht nur an seinen eigenen Dienst', async () => {
  const f = mockFetch(routes());
  for (const svc of SERVICES) await svc.load(ctx(f), period).catch(() => {});
  const hostsOf = Object.fromEntries(SERVICES.map((s) => [s.keyId, s.hosts]));
  for (const c of f.calls) {
    const auth = c.headers.Authorization;
    if (!auth) continue;
    const owner = Object.entries(KEYS).find(([, k]) => auth.includes(k));
    assert.ok(owner, `Unbekannter Key an ${c.url}`);
    assert.ok(hostsOf[owner[0]].includes(new URL(c.url).hostname), `${owner[0]}-Key ging an ${c.url}`);
  }
});

// ---------- Hub: alles zusammen ----------

function makeHub({ failOpenAI = false, keys = KEYS, manual = [] } = {}) {
  const dir = tempDir();
  const vault = new Vault({ file: new JsonFile(path.join(dir, 'vault.json')), safeStorage: fakeSafeStorage() });
  vault.unlock(crypto.randomBytes(32));
  for (const [id, k] of Object.entries(keys)) vault.set(id, k);
  const cfg = new Config(new JsonFile(path.join(dir, 'config.json')));
  cfg.update({ railwayProjectId: 'proj-1' });
  for (const m of manual) cfg.upsertManual(m);
  const fetch = mockFetch(routes({ failOpenAI }));
  const lines = [];
  const logger = createLogger({ sink: { log: (s) => lines.push(s), warn: (s) => lines.push(s), error: (s) => lines.push(s) }, getSecrets: () => vault.knownSecrets() });
  const fxLoader = new FxLoader({ file: new JsonFile(path.join(dir, 'fx.json')), fetch, now: () => NOW });
  const hub = new Hub({ vault, config: cfg, fxLoader, fetch, now: () => NOW, logger });
  return { hub, fetch, lines, vault };
}

test('Hub: Reingewinn aus Stripe minus OpenAI, GitHub und Fixkosten', async () => {
  const { hub } = makeHub({ manual: [{ name: 'Claude Pro', monthly: '30', currency: 'CHF', link: 'https://claude.ai/settings/billing' }] });
  const d = await hub.load('month');
  const p = d.profit;
  assert.equal(p.revenue.netRappen, '4737'); // 1912 + 4825 − 2000
  const cost = Object.fromEntries(p.costs.map((c) => [c.name, c]));
  assert.equal(cost.OpenAI.rappen, '140'); // 0.50 × 0.928/1.16 + 1.25 × 0.8 = 0.40 + 1.00
  assert.equal(cost.GitHub.rappen, '6'); // 0.08 × 0.8 = 0.064
  assert.equal(cost['Claude Pro'].rappen, '900'); // 30/30 × 9 Tage
  assert.equal(cost['Claude Pro'].status, 'manual');
  assert.equal(p.totalCostsRappen, '1046');
  assert.equal(p.profitRappen, '3691');
  assert.equal(p.complete, true);
  assert.equal(p.fx.rateDate, '2026-11-06');
  assert.equal(d.services.find((s) => s.id === 'railway').detail.health.ok, true);
});

test('Hub: ausgefallener Dienst wird gemeldet, nicht als 0 gerechnet', async () => {
  const { hub } = makeHub({ failOpenAI: true });
  const d = await hub.load('month');
  assert.equal(d.profit.complete, false);
  assert.equal(d.profit.missing[0].name, 'OpenAI');
  assert.match(d.profit.missing[0].reason, /Fehler \(500\)/);
  assert.equal(d.profit.costs.find((c) => c.id === 'openai').rappen, null);
  assert.equal(d.services.find((s) => s.id === 'openai').status, 'error');
});

test('Hub: fehlender Key bei aktiver Kostenquelle macht den Gewinn unvollständig', async () => {
  const { hub } = makeHub({ keys: { stripe: KEYS.stripe } });
  const d = await hub.load('month');
  assert.equal(d.profit.complete, false);
  assert.deepEqual(d.profit.missing.map((m) => m.id).sort(), ['github', 'openai']);
  assert.equal(d.services.find((s) => s.id === 'openai').status, 'nokey');
});

test('Hub: Renderer-Paket und Logs enthalten keinen einzigen Key', async () => {
  const { hub, lines } = makeHub({ failOpenAI: true });
  const d = await hub.load('month');
  const overview = hub.keyOverview();
  const tested = await hub.testConnection('openai');
  const all = JSON.stringify([d, overview, tested]) + lines.join('\n');
  for (const k of Object.values(KEYS)) assert.ok(!all.includes(k), 'Key gefunden');
  assert.equal(overview.find((o) => o.id === 'stripe').masked, '…abcd');
  assert.equal(tested.ok, false);
});

test('Hub: Verbindung testen pro Dienst', async () => {
  const { hub } = makeHub();
  const results = {};
  for (const id of ['stripe', 'openai', 'github', 'supabase', 'railway', 'resend', 'domain']) {
    results[id] = await hub.testConnection(id);
  }
  for (const [id, r] of Object.entries(results)) assert.equal(r.ok, true, `${id}: ${r.message}`);
  assert.match(results.github.message, /wolfawidmer-sudo/);
  assert.match(results.domain.message, /2027-11-05/);
});

test('Fixkosten: Eingaben werden geprüft', () => {
  const cfg = new Config(new JsonFile(path.join(tempDir(), 'c.json')));
  assert.throws(() => cfg.upsertManual({ name: '', monthly: '5' }), /Name/);
  assert.throws(() => cfg.upsertManual({ name: 'X', monthly: '5,50' }), /Zahl mit Punkt/);
  assert.throws(() => cfg.upsertManual({ name: 'X', monthly: '-1' }), /negativ/);
  assert.throws(() => cfg.upsertManual({ name: 'X', monthly: '1', link: 'http://a.b' }), /https/);
  const e = cfg.upsertManual({ name: 'Domain', monthly: '1’000.50', currency: 'chf' });
  assert.equal(e.monthly, '1000.50');
  assert.equal(e.currency, 'CHF');
  cfg.removeManual(e.id);
  assert.equal(cfg.get().manualCosts.length, 0);
});
