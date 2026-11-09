'use strict';

// Einstellungen ohne Geheimnisse (IDs, Domain, Fixkosten, Theme). Keys liegen nur im Tresor.

const crypto = require('node:crypto');
const { parseDecimal } = require('../core/rational');

const DEFAULTS = Object.freeze({
  version: 1,
  theme: 'dark',
  period: 'month',
  supabaseRef: 'ifbpbsbgdpnxmwtycjqr',
  railwayProjectId: 'e91889d9-5698-4e40-a877-11720c79bf61', // «motivated-spontaneity», von Wolf bestätigt (9.11.)
  healthUrl: 'https://api.buddy-island.top/health',
  githubOwner: 'wolfawidmer-sudo',
  githubRepo: 'buddy-island',
  domain: 'buddy-island.top',
  // Kostenquellen per API: ist eine aktiv, aber ohne Key, gilt der Gewinn als unvollständig.
  costSources: { openai: true, github: true },
  // Repos für das Commit-Raster (grüne Felder), Format owner/name.
  activityRepos: ['wolfawidmer-sudo/buddy-island', 'wolfawidmer-sudo/buddy-hq'],
  manualCosts: [],
});

const CURRENCIES = ['CHF', 'USD', 'EUR'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9-]{1,40}$/;

function validateManual(input) {
  const name = String(input.name ?? '').trim();
  if (name.length < 1 || name.length > 60) throw new Error('Name: 1 bis 60 Zeichen.');
  const monthlyStr = String(input.monthly ?? '').trim().replace(/['’]/g, '');
  let monthly;
  try {
    monthly = parseDecimal(monthlyStr);
  } catch {
    throw new Error('Betrag pro Monat: Zahl mit Punkt, z. B. 18.50');
  }
  if (monthly.cmp('0') < 0) throw new Error('Betrag darf nicht negativ sein.');
  const currency = String(input.currency || 'CHF').toUpperCase();
  if (!CURRENCIES.includes(currency)) throw new Error('Währung: CHF, USD oder EUR.');
  let link = null;
  if (input.link) {
    let u;
    try {
      u = new URL(String(input.link));
    } catch {
      throw new Error('Link ist keine gültige Adresse.');
    }
    if (u.protocol !== 'https:') throw new Error('Link muss mit https:// beginnen.');
    link = u.toString();
  }
  for (const f of ['from', 'until', 'renews']) {
    if (input[f] && !DATE_RE.test(input[f])) throw new Error('Datum im Format JJJJ-MM-TT.');
  }
  const id = input.id && ID_RE.test(input.id) ? input.id : `m-${crypto.randomBytes(4).toString('hex')}`;
  return {
    id,
    name,
    monthly: monthlyStr,
    currency,
    link,
    from: input.from || null,
    until: input.until || null,
    renews: input.renews || null,
    note: String(input.note ?? '').slice(0, 200),
  };
}

const EDITABLE = ['theme', 'period', 'supabaseRef', 'railwayProjectId', 'healthUrl', 'githubOwner', 'githubRepo', 'domain'];

class Config {
  constructor(file) {
    this.file = file;
    // Tiefe Kopie: die Standardwerte dürfen nie mitverändert werden.
    const saved = file.read({}) || {};
    this.data = { ...structuredClone(DEFAULTS), ...structuredClone(saved) };
    this.data.costSources = { ...DEFAULTS.costSources, ...(saved.costSources || {}) };
    if (!Array.isArray(this.data.manualCosts)) this.data.manualCosts = [];
  }

  get() {
    return JSON.parse(JSON.stringify(this.data));
  }

  save() {
    this.file.write(this.data);
  }

  update(patch) {
    for (const k of EDITABLE) {
      if (patch[k] === undefined) continue;
      const v = String(patch[k]).trim();
      if (k === 'theme' && !['dark', 'light'].includes(v)) throw new Error('Theme: dark oder light.');
      if (k === 'period' && !['7d', '30d', 'month', 'year'].includes(v)) throw new Error('Unbekannter Zeitraum.');
      if (k === 'healthUrl' && v && !v.startsWith('https://')) throw new Error('Health-URL muss mit https:// beginnen.');
      if (['supabaseRef', 'railwayProjectId', 'githubOwner', 'githubRepo'].includes(k) && v && !/^[A-Za-z0-9._-]{1,100}$/.test(v)) {
        throw new Error(`Ungültiger Wert für ${k}.`);
      }
      if (k === 'domain' && v && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) throw new Error('Ungültige Domain.');
      this.data[k] = v;
    }
    if (patch.activityRepos !== undefined) {
      if (!Array.isArray(patch.activityRepos) || patch.activityRepos.length > 20) throw new Error('Höchstens 20 Repos.');
      const list = [...new Set(patch.activityRepos.map((r) => String(r).trim()))];
      for (const r of list) {
        if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(r)) throw new Error(`Ungültiges Repo: ${r}`);
      }
      this.data.activityRepos = list;
    }
    if (patch.costSources) {
      for (const k of Object.keys(DEFAULTS.costSources)) {
        if (typeof patch.costSources[k] === 'boolean') this.data.costSources[k] = patch.costSources[k];
      }
    }
    this.save();
    return this.get();
  }

  upsertManual(input) {
    const entry = validateManual(input);
    const i = this.data.manualCosts.findIndex((m) => m.id === entry.id);
    if (i >= 0) this.data.manualCosts[i] = entry;
    else this.data.manualCosts.push(entry);
    this.save();
    return entry;
  }

  removeManual(id) {
    this.data.manualCosts = this.data.manualCosts.filter((m) => m.id !== id);
    this.save();
  }
}

module.exports = { Config, DEFAULTS, validateManual };
