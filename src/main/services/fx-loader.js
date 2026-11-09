'use strict';

// Holt EZB-Referenzkurse und speichert sie lokal. Pro Tag höchstens einmal nachladen.
// Fehlt ein älterer Zeitraum (z. B. «Jahr»), wird die 90-Tage- oder die Gesamt-Datei geholt.

const { request } = require('./http');
const { FxTable, ECB_URLS } = require('../../core/fx');
const { addDays } = require('../../core/period');

class FxLoader {
  constructor({ file, fetch, now = Date.now }) {
    this.file = file; // JsonFile
    this.fetch = fetch;
    this.now = now;
    const saved = file.read(null);
    this.table = FxTable.fromJSON(saved && saved.rates);
    this.lastFetch = (saved && saved.lastFetch) || 0;
    this.lastError = null;
  }

  earliest() {
    return [...this.table.days.keys()].sort()[0] || null;
  }

  async fetchXml(url) {
    const xml = await request(this.fetch, url, { parse: 'text', timeoutMs: 30_000, headers: { Accept: 'application/xml' }, redirect: 'follow' });
    this.table.addEcbXml(xml);
  }

  // Stellt sicher, dass Kurse ab startKey (minus Puffer) da sind. Fehler werden gemerkt, nicht geworfen:
  // dann wird mit dem Gespeicherten gerechnet, und fehlende Tage machen Dienste «nicht verfügbar».
  async ensure(startKey) {
    const need = addDays(startKey, -7);
    const stale = this.now() - this.lastFetch > 6 * 3600_000;
    try {
      const earliest = this.earliest();
      if (!earliest || earliest > need) {
        const ninetyAgo = new Date(this.now() - 85 * 86_400_000).toISOString().slice(0, 10);
        await this.fetchXml(need >= ninetyAgo ? ECB_URLS.last90Days : ECB_URLS.full);
        this.lastFetch = this.now();
      } else if (stale) {
        await this.fetchXml(ECB_URLS.daily);
        this.lastFetch = this.now();
      }
      this.lastError = null;
      this.file.write({ lastFetch: this.lastFetch, rates: this.table.toJSON() });
    } catch (e) {
      this.lastError = e.message;
    }
    return this.table;
  }

  status() {
    return { latest: this.table.latestDate(), error: this.lastError };
  }
}

module.exports = { FxLoader };
