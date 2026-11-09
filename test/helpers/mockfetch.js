'use strict';

// Attrappe für fetch: Routen nach Methode + URL-Muster. Merkt sich alle Aufrufe.
// Es gehen nie echte Anfragen raus.

function mockFetch(routes) {
  const calls = [];
  async function fetchImpl(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url, method, headers: { ...(opts.headers || {}) }, body: opts.body, redirect: opts.redirect });
    for (const r of routes) {
      if ((r.method || 'GET') !== method) continue;
      const m = typeof r.match === 'string' ? url.startsWith(r.match) : r.match.test(url);
      if (!m) continue;
      if (r.throw) throw r.throw;
      const out = typeof r.reply === 'function' ? r.reply(url, opts) : r.reply;
      const status = out.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if (out.json === undefined) throw new SyntaxError('kein JSON');
          return JSON.parse(JSON.stringify(out.json));
        },
        text: async () => (out.text !== undefined ? out.text : JSON.stringify(out.json)),
      };
    }
    throw new Error(`Keine Attrappe für ${method} ${url}`);
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}

module.exports = { mockFetch };
