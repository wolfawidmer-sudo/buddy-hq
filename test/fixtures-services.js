'use strict';

// Attrappen-Antworten aller Dienste (Form nach den offiziellen Dokus, Werte erfunden).

const { ECB_XML, ts } = require('./fixtures');

function routes({ failOpenAI = false } = {}) {
  return [
    // --- Stripe ---
    {
      match: /^https:\/\/api\.stripe\.com\/v1\/balance_transactions\?/,
      reply: (url) =>
        url.includes('starting_after=txn_2')
          ? {
              json: {
                has_more: false,
                data: [{ id: 'txn_3', type: 'refund', created: ts('2026-11-06T10:00:00Z'), amount: -2000, fee: 0, net: -2000, currency: 'chf' }],
              },
            }
          : {
              json: {
                has_more: true,
                data: [
                  { id: 'txn_1', type: 'charge', created: ts('2026-11-02T10:00:00Z'), amount: 2000, fee: 88, net: 1912, currency: 'chf' },
                  { id: 'txn_2', type: 'charge', created: ts('2026-11-05T10:00:00Z'), amount: 5000, fee: 175, net: 4825, currency: 'chf' },
                ],
              },
            },
    },
    {
      match: 'https://api.stripe.com/v1/charges',
      reply: { json: { data: [{ id: 'ch_1', amount: 5000, currency: 'chf', created: ts('2026-11-05T10:00:00Z'), status: 'succeeded', refunded: false, amount_refunded: 0, billing_details: { email: 'kunde@example.com' } }] } },
    },
    {
      match: 'https://api.stripe.com/v1/payouts?status=pending',
      reply: { json: { data: [{ id: 'po_1', amount: 4737, currency: 'chf', arrival_date: ts('2026-11-12T00:00:00Z'), status: 'pending' }] } },
    },
    { match: 'https://api.stripe.com/v1/payouts?status=in_transit', reply: { json: { data: [] } } },
    { match: 'https://api.stripe.com/v1/balance', reply: { json: { available: [{ amount: 100, currency: 'chf' }], pending: [{ amount: 4737, currency: 'chf' }] } } },

    // --- OpenAI ---
    failOpenAI
      ? { match: /^https:\/\/api\.openai\.com\//, reply: { status: 500, json: {} } }
      : {
          match: /^https:\/\/api\.openai\.com\/v1\/organization\/costs\?/,
          reply: (url) =>
            url.includes('page=p2')
              ? { json: { object: 'page', has_more: false, next_page: null, data: [{ object: 'bucket', start_time: ts('2026-11-06T00:00:00Z'), results: [{ amount: { value: 1.25, currency: 'usd' }, line_item: 'gpt-6, input' }] }] } }
              : { json: { object: 'page', has_more: true, next_page: 'p2', data: [{ object: 'bucket', start_time: ts('2026-11-05T00:00:00Z'), results: [{ amount: { value: 0.5, currency: 'usd' }, line_item: 'gpt-6, output' }] }] } },
        },
    {
      match: /^https:\/\/api\.openai\.com\/v1\/organization\/usage\/completions\?/,
      reply: { json: { has_more: false, data: [{ start_time: ts('2026-11-05T00:00:00Z'), results: [{ model: 'gpt-6', input_tokens: 1000, output_tokens: 200, num_model_requests: 3 }] }] } },
    },

    // --- GitHub ---
    { match: 'https://api.github.com/user/repos', reply: { json: [{ full_name: 'wolfawidmer-sudo/buddy-island', private: false, pushed_at: '2026-11-05T10:00:00Z' }] } },
    { match: /^https:\/\/api\.github\.com\/user$/, reply: { json: { login: 'wolfawidmer-sudo' } } },
    {
      match: /\/repos\/wolfawidmer-sudo\/buddy-island\/stats\/commit_activity$/,
      // Woche ab So 1.11.2026 00:00 UTC
      reply: { json: [{ week: ts('2026-11-01T00:00:00Z'), days: [0, 3, 1, 0, 2, 0, 0], total: 6 }] },
    },
    { match: /\/repos\/wolfawidmer-sudo\/buddy-hq\/stats\/commit_activity$/, reply: { status: 202, text: '' } },
    { match: /\/actions\/runs\?/, reply: { json: { workflow_runs: [{ name: 'Tests', status: 'completed', conclusion: 'success', head_branch: 'main', created_at: '2026-11-08T10:00:00Z' }] } } },
    { match: /\/releases\?/, reply: { json: [{ tag_name: 'v0.12.0', name: '0.12.0', published_at: '2026-11-05T10:00:00Z', draft: false }] } },
    {
      match: /\/settings\/billing\/usage\?/,
      reply: { json: { usageItems: [{ date: '2026-11-04T00:00:00Z', product: 'actions', sku: 'linux', quantity: 10, netAmount: 0.08 }, { date: '2026-11-03T00:00:00Z', product: 'actions', sku: 'linux', quantity: 100, netAmount: 0 }] } },
    },

    // --- Supabase ---
    { match: /^https:\/\/api\.supabase\.com\/v1\/projects\/[a-z]+\/health\?/, reply: { json: [{ name: 'db', healthy: true, status: 'ACTIVE_HEALTHY' }, { name: 'auth', healthy: true, status: 'ACTIVE_HEALTHY' }] } },
    { method: 'POST', match: /\/database\/query\/read-only$/, reply: { status: 201, json: [{ users: 42, db_bytes: 10485760 }] } },
    { match: /^https:\/\/api\.supabase\.com\/v1\/projects\/[a-z]+$/, reply: { json: { name: 'buddy-island', region: 'eu-central-2', status: 'ACTIVE_HEALTHY' } } },

    // --- Railway ---
    {
      method: 'POST',
      match: 'https://backboard.railway.com/graphql/v2',
      reply: (_u, opts) => {
        const q = JSON.parse(opts.body).query;
        if (q.includes('hqProject')) return { json: { data: { project: { id: 'p', name: 'buddy-backend', services: { edges: [{ node: { id: 's', name: 'api' } }] } } } } };
        return { json: { data: { deployments: { edges: [{ node: { id: 'd', status: 'SUCCESS', createdAt: '2026-11-09T08:00:00Z' } }] } } } };
      },
    },
    { match: 'https://api.buddy-island.top/health', reply: { status: 200, json: { ok: true } } },

    // --- Resend ---
    {
      match: /^https:\/\/api\.resend\.com\/emails\?/,
      reply: {
        json: {
          object: 'list',
          has_more: true,
          data: [
            { id: 'e1', to: ['a@example.com'], subject: 'Code', created_at: '2026-11-08 10:00:00.000000+00', last_event: 'delivered' },
            { id: 'e2', to: ['b@example.com'], subject: 'Code', created_at: '2026-11-03 10:00:00.000000+00', last_event: 'bounced' },
            { id: 'e3', to: ['c@example.com'], subject: 'Alt', created_at: '2026-10-20 10:00:00.000000+00', last_event: 'delivered' },
          ],
        },
      },
    },

    // --- Domain (RDAP) ---
    { match: 'https://data.iana.org/rdap/dns.json', reply: { json: { services: [[['com', 'net'], ['https://rdap.verisign.com/com/v1/']], [['top'], ['https://rdap.nic.top/']]] } } },
    {
      match: 'https://rdap.nic.top/domain/buddy-island.top',
      reply: { json: { events: [{ eventAction: 'registration', eventDate: '2026-11-05T09:00:00Z' }, { eventAction: 'expiration', eventDate: '2027-11-05T09:00:00Z' }], status: ['client transfer prohibited'], entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'GoDaddy.com, LLC']]] }] } },
    },

    // --- EZB ---
    { match: /^https:\/\/www\.ecb\.europa\.eu\/stats\/eurofxref\//, reply: { text: ECB_XML } },
  ];
}

module.exports = { routes };
