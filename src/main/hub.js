'use strict';

// Lädt alle Dienste, rechnet den Reingewinn und baut das Paket für den Renderer.
// Das Paket enthält nur Zahlen (als Strings), Status und Texte – nie Keys.

const { getPeriod, PERIOD_LABELS } = require('../core/period');
const { computeProfit, STATUS } = require('../core/profit');
const { SERVICES, KEY_HELP, byId } = require('./services/registry');
const { toError } = require('./services/http');
const { assertNoSecrets } = require('./security/redact');

// BigInt → String (für IPC und JSON).
function plain(value) {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

class Hub {
  constructor({ vault, config, fxLoader, fetch, now = Date.now, logger }) {
    this.vault = vault;
    this.config = config;
    this.fxLoader = fxLoader;
    this.fetch = fetch;
    this.now = now;
    this.logger = logger;
  }

  ctx() {
    return {
      fetch: this.fetch,
      now: this.now,
      config: this.config.get(),
      getKey: (id) => (this.vault.unlocked ? this.vault.get(id) : null),
    };
  }

  // Für den Renderer: welche Keys gesetzt sind (nur maskiert) und die Anleitungen.
  keyOverview() {
    const masked = new Map(this.vault.list().map((e) => [e.id, e.masked]));
    const out = Object.entries(KEY_HELP).map(([id, help]) => ({ id, ...help, masked: masked.get(id) || null }));
    return this.safe(out);
  }

  safe(payload) {
    return assertNoSecrets(plain(payload), this.vault.unlocked ? this.vault.knownSecrets() : []);
  }

  async testConnection(serviceId) {
    const svc = byId(serviceId);
    if (!svc) throw new Error('Unbekannter Dienst');
    try {
      const msg = await svc.test(this.ctx());
      return this.safe({ ok: true, message: msg });
    } catch (e) {
      this.logger && this.logger.warn(`Verbindungstest ${serviceId}:`, e);
      return this.safe({ ok: false, message: toError(e) });
    }
  }

  async load(periodId) {
    const period = getPeriod(periodId, this.now());
    const ctx = this.ctx();
    const fx = await this.fxLoader.ensure(period.startKey);

    const results = await Promise.all(
      SERVICES.map(async (svc) => {
        const base = {
          id: svc.id,
          name: svc.name,
          dashboardUrl: svc.dashboardFor ? svc.dashboardFor(ctx.config) : svc.dashboardUrl,
          hasKey: svc.keyId ? Boolean(ctx.getKey(svc.keyId)) : null,
        };
        try {
          const r = await svc.load(ctx, period);
          return { ...base, status: r.partial ? 'partial' : 'live', error: r.error || null, raw: r };
        } catch (e) {
          this.logger && this.logger.warn(`Laden ${svc.id}:`, e);
          const code = e && e.code;
          return { ...base, status: code === 'nokey' ? 'nokey' : 'error', error: toError(e), raw: null };
        }
      }),
    );
    const byService = Object.fromEntries(results.map((r) => [r.id, r]));

    // Einnahmen
    const s = byService.stripe;
    const stripeInput = s.raw ? s.raw.revenue : { status: STATUS.UNAVAILABLE, error: `Stripe: ${s.error}` };

    // Kosten aus APIs (nur aktive Quellen)
    const costInputs = [];
    for (const id of ['openai', 'github']) {
      if (!ctx.config.costSources[id]) continue;
      const r = byService[id];
      const svcName = r.name;
      if (r.raw && r.raw.costs && r.raw.costs.status === 'live') {
        costInputs.push({ id, name: svcName, status: STATUS.LIVE, items: r.raw.costs.items });
      } else {
        const reason = r.raw && r.raw.costs ? r.raw.costs.error : r.error;
        costInputs.push({ id, name: svcName, status: STATUS.UNAVAILABLE, error: reason || 'nicht geladen' });
      }
    }

    const profit = computeProfit({
      period,
      stripe: stripeInput,
      services: costInputs,
      manualCosts: ctx.config.manualCosts,
      fx,
    });

    const services = results.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      error: r.error,
      hasKey: r.hasKey,
      dashboardUrl: r.dashboardUrl,
      detail: r.raw ? r.raw.detail || null : null,
      costs: r.raw && r.raw.costs ? { status: r.raw.costs.status, error: r.raw.costs.error || null } : null,
    }));

    return this.safe({
      loadedAt: new Date(this.now()).toISOString(),
      period: { ...profit.period, labels: PERIOD_LABELS },
      profit: {
        complete: profit.complete,
        missing: profit.missing,
        profitRappen: profit.profitRappen,
        revenue: { ...profit.revenue, fxUsed: undefined },
        totalCostsRappen: profit.totalCostsRappen,
        costs: profit.costs.map((c) => ({ id: c.id, name: c.name, status: c.status, rappen: c.rappen, error: c.error, link: c.link || null })),
        daily: profit.daily,
        topCosts: profit.topCosts,
        fx: profit.fx,
      },
      fxStatus: this.fxLoader.status(),
      services,
      manualCosts: ctx.config.manualCosts,
      costSources: ctx.config.costSources,
    });
  }
}

module.exports = { Hub, plain };
