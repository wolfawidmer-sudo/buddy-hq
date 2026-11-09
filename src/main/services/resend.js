'use strict';

// Resend: versendete/zugestellte Mails. Lesen geht nur mit «Full access»-Key.
// Doku: https://resend.com/docs/api-reference/emails/list-emails
// Es werden nur Zahlen weitergegeben, keine Empfänger oder Betreffzeilen.

const { request, ServiceError } = require('./http');

const API = 'https://api.resend.com';
const MAX_PAGES = 20;

// Resend liefert z. B. «2023-04-03T22:13:42.674981+00:00», teils mit Leerzeichen und «+00».
function parseTime(value) {
  let s = String(value || '').trim().replace(' ', 'T');
  if (/[+-]\d{2}$/.test(s)) s += ':00';
  return Date.parse(s);
}

const resend = {
  id: 'resend',
  name: 'Resend',
  keyId: 'resend',
  dashboardUrl: 'https://resend.com/emails',
  hosts: ['api.resend.com'],

  async test({ fetch, getKey }) {
    const key = getKey('resend');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    await request(fetch, `${API}/emails?limit=1`, { headers: { Authorization: `Bearer ${key}` } });
    return 'Verbindung ok. Mails lassen sich lesen.';
  },

  async load({ fetch, getKey }, period) {
    const key = getKey('resend');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    const counts = {};
    let total = 0;
    let after = null;
    let complete = false;
    for (let i = 0; i < MAX_PAGES; i++) {
      const q = new URLSearchParams({ limit: '100' });
      if (after) q.set('after', after);
      const res = await request(fetch, `${API}/emails?${q}`, { headers: { Authorization: `Bearer ${key}` } });
      const data = Array.isArray(res.data) ? res.data : [];
      let reachedStart = false;
      for (const m of data) {
        const t = parseTime(m.created_at);
        if (Number.isFinite(t) && t < period.startMs) {
          reachedStart = true;
          continue;
        }
        if (Number.isFinite(t) && t >= period.endMs) continue;
        total++;
        const ev = m.last_event || 'unbekannt';
        counts[ev] = (counts[ev] || 0) + 1;
      }
      if (reachedStart || !res.has_more || data.length === 0) {
        complete = true;
        break;
      }
      after = data[data.length - 1].id;
    }
    return {
      detail: {
        total,
        counts,
        complete,
        note: complete ? null : 'Mehr als 2000 Mails im Zeitraum, Zählung ist unvollständig.',
      },
    };
  },
};

module.exports = resend;
