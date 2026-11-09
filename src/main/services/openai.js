'use strict';

// OpenAI Costs API und Usage API (Admin Key, Berechtigung «Read only»).
// Doku: https://platform.openai.com/docs/api-reference/usage/costs
// Die Tages-Buckets von OpenAI sind UTC-Tage.

const { request, ServiceError } = require('./http');

const API = 'https://api.openai.com/v1/organization';
const MAX_PAGES = 20;

function headers(key) {
  return { Authorization: `Bearer ${key}` };
}

function utcStartOf(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 1000);
}

function utcDate(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

async function pages(fetchImpl, key, path, params) {
  const buckets = [];
  let page = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams(params);
    if (page) q.set('page', page);
    const res = await request(fetchImpl, `${API}${path}?${q}`, { headers: headers(key) });
    buckets.push(...(Array.isArray(res.data) ? res.data : []));
    if (!res.has_more || !res.next_page) return buckets;
    page = res.next_page;
  }
  throw new ServiceError('toomany', 'Zu viele Seiten von OpenAI.');
}

function bucketResults(b) {
  if (Array.isArray(b.results)) return b.results;
  if (Array.isArray(b.result)) return b.result;
  return [];
}

const openai = {
  id: 'openai',
  name: 'OpenAI',
  keyId: 'openai',
  dashboardUrl: 'https://platform.openai.com/usage',
  hosts: ['api.openai.com'],
  costSource: true,

  async test({ fetch, getKey, now }) {
    const key = getKey('openai');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    const start = Math.floor(now() / 1000) - 86_400;
    await request(fetch, `${API}/costs?start_time=${start}&limit=1`, { headers: headers(key) });
    return 'Verbindung ok. Kosten lassen sich lesen.';
  },

  async load({ fetch, getKey, now }, period) {
    const key = getKey('openai');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    const start = String(utcStartOf(period.startKey));
    const end = String(Math.ceil(now() / 1000));
    const [costBuckets, usageBuckets] = await Promise.all([
      pages(fetch, key, '/costs', { start_time: start, end_time: end, bucket_width: '1d', group_by: 'line_item', limit: '180' }),
      pages(fetch, key, '/usage/completions', { start_time: start, end_time: end, bucket_width: '1d', group_by: 'model', limit: '31' }).catch(
        (e) => ({ error: e.message }),
      ),
    ]);

    const items = [];
    for (const b of costBuckets) {
      const date = utcDate(b.start_time);
      for (const r of bucketResults(b)) {
        if (!r.amount || r.amount.value === undefined || r.amount.value === null) continue;
        items.push({ date, amount: r.amount.value, currency: String(r.amount.currency || 'usd').toUpperCase(), label: r.line_item || 'OpenAI' });
      }
    }

    let tokens = null;
    if (!usageBuckets.error) {
      const byModel = new Map();
      for (const b of usageBuckets) {
        for (const r of bucketResults(b)) {
          const m = r.model || 'unbekannt';
          const cur = byModel.get(m) || { model: m, input: 0, output: 0, requests: 0 };
          cur.input += Number(r.input_tokens || 0);
          cur.output += Number(r.output_tokens || 0);
          cur.requests += Number(r.num_model_requests || 0);
          byModel.set(m, cur);
        }
      }
      tokens = [...byModel.values()].sort((a, b) => b.input + b.output - (a.input + a.output));
    }

    return {
      costs: { status: 'live', items },
      detail: {
        tokens,
        tokensError: usageBuckets.error || null,
        balance: null,
        balanceNote: 'Das Guthaben ist über keine offizielle API abrufbar.',
        utcNote: 'OpenAI rechnet in UTC-Tagen.',
      },
    };
  },
};

module.exports = openai;
