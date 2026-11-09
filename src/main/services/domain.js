'use strict';

// Domain-Ablaufdatum über RDAP (offener Standard, RFC 9083), ohne Key.
// Der zuständige RDAP-Server wird aus der IANA-Liste gelesen.
// Absichtlich KEIN GoDaddy-Key: der hätte vollen Kontozugriff.

const { request, ServiceError } = require('./http');

const IANA_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';

function findRdapBase(bootstrap, domain) {
  const tld = domain.split('.').pop().toLowerCase();
  for (const [tlds, urls] of bootstrap.services || []) {
    if (tlds.map((t) => t.toLowerCase()).includes(tld)) {
      const https = urls.find((u) => u.startsWith('https://'));
      if (https) return https.endsWith('/') ? https : `${https}/`;
    }
  }
  return null;
}

function vcardName(entity) {
  const arr = entity && entity.vcardArray && entity.vcardArray[1];
  if (!Array.isArray(arr)) return null;
  const fn = arr.find((x) => x[0] === 'fn');
  return fn ? String(fn[3]) : null;
}

const domain = {
  id: 'domain',
  name: 'Domain',
  keyId: null,
  dashboardUrl: 'https://dcc.godaddy.com/control/portfolio',
  hosts: [],

  async test(ctx) {
    const r = await this.load(ctx);
    return `Verbindung ok. Läuft ab am ${r.detail.expires ? r.detail.expires.slice(0, 10) : 'unbekannt'}.`;
  },

  async load({ fetch, config, now }) {
    const name = config.domain;
    if (!name) throw new ServiceError('config', 'Keine Domain eingetragen.');
    const bootstrap = await request(fetch, IANA_BOOTSTRAP, { redirect: 'follow' });
    const base = findRdapBase(bootstrap, name);
    if (!base) throw new ServiceError('notfound', 'Für diese Endung gibt es keinen RDAP-Server.');
    const rdap = await request(fetch, `${base}domain/${encodeURIComponent(name)}`, {
      redirect: 'follow',
      headers: { Accept: 'application/rdap+json, application/json' },
    });
    const ev = (rdap.events || []).find((e) => e.eventAction === 'expiration');
    const registrar = (rdap.entities || []).find((e) => (e.roles || []).includes('registrar'));
    const expires = ev ? ev.eventDate : null;
    const daysLeft = expires ? Math.floor((Date.parse(expires) - now()) / 86_400_000) : null;
    return {
      detail: {
        domain: name,
        expires,
        daysLeft,
        registrar: vcardName(registrar),
        status: rdap.status || [],
        source: `RDAP (${new URL(base).hostname})`,
        costNote: 'Den Preis trägst du unter «Fixkosten» ein.',
      },
    };
  },
};

module.exports = { domain, findRdapBase };
