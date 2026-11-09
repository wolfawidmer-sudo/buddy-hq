'use strict';

// Stripe, nur lesend. Restricted Key mit Balance Read, Charges Read, Payouts Read.
// Doku: https://docs.stripe.com/api/balance_transactions

const { request, ServiceError } = require('./http');

const API = 'https://api.stripe.com/v1';
const MAX_PAGES = 50;

function headers(key) {
  return { Authorization: `Bearer ${key}` };
}

async function listAll(fetchImpl, key, path, params) {
  const out = [];
  let startingAfter = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ ...params, limit: '100' });
    if (startingAfter) q.set('starting_after', startingAfter);
    const res = await request(fetchImpl, `${API}${path}?${q}`, { headers: headers(key) });
    const data = Array.isArray(res.data) ? res.data : [];
    out.push(...data);
    if (!res.has_more || data.length === 0) return { items: out, truncated: false };
    startingAfter = data[data.length - 1].id;
  }
  return { items: out, truncated: true };
}

const stripe = {
  id: 'stripe',
  name: 'Stripe',
  keyId: 'stripe',
  dashboardUrl: 'https://dashboard.stripe.com/dashboard',
  hosts: ['api.stripe.com'],

  async test({ fetch, getKey }) {
    const key = getKey('stripe');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    await request(fetch, `${API}/balance`, { headers: headers(key) });
    return 'Verbindung ok. Lesen von Balance funktioniert.';
  },

  async load({ fetch, getKey }, period) {
    const key = getKey('stripe');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    const gte = Math.floor(period.startMs / 1000);
    const lt = Math.ceil(period.endMs / 1000);
    const [tx, charges, pending, inTransit, balance] = await Promise.all([
      listAll(fetch, key, '/balance_transactions', { 'created[gte]': String(gte), 'created[lt]': String(lt) }),
      request(fetch, `${API}/charges?limit=10`, { headers: headers(key) }),
      request(fetch, `${API}/payouts?status=pending&limit=10`, { headers: headers(key) }),
      request(fetch, `${API}/payouts?status=in_transit&limit=10`, { headers: headers(key) }),
      request(fetch, `${API}/balance`, { headers: headers(key) }),
    ]);
    if (tx.truncated) {
      throw new ServiceError('toomany', 'Zu viele Buchungen im Zeitraum (über 5000). Kürzeren Zeitraum wählen.');
    }
    const upcoming = [...(pending.data || []), ...(inTransit.data || [])]
      .filter((p) => p && p.arrival_date)
      .sort((a, b) => a.arrival_date - b.arrival_date)[0];
    return {
      revenue: {
        status: 'live',
        transactions: tx.items.map((t) => ({
          type: t.type,
          created: t.created,
          amount: t.amount,
          fee: t.fee,
          net: t.net,
          currency: t.currency,
        })),
      },
      detail: {
        recentPayments: (charges.data || []).map((c) => ({
          created: c.created,
          minor: String(c.amount),
          currency: c.currency,
          status: c.status,
          refunded: Boolean(c.refunded),
          refundedMinor: String(c.amount_refunded || 0),
        })),
        nextPayout: upcoming
          ? { arrivalDate: upcoming.arrival_date, minor: String(upcoming.amount), currency: upcoming.currency, status: upcoming.status }
          : null,
        balance: {
          available: (balance.available || []).map((b) => ({ minor: String(b.amount), currency: b.currency })),
          pending: (balance.pending || []).map((b) => ({ minor: String(b.amount), currency: b.currency })),
        },
      },
    };
  },
};

module.exports = stripe;
