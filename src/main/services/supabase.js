'use strict';

// Supabase Management API, nur lesend. Fine-grained Token (Preset «No access»),
// nur Projekt buddy-island, Rechte: project_admin_read, database_read.
// Doku: https://supabase.com/docs/reference/api/introduction
// Kosten/Plan: keine Kosten-API → manueller Eintrag.

const { request, ServiceError } = require('./http');

const API = 'https://api.supabase.com/v1';

function headers(key) {
  return { Authorization: `Bearer ${key}` };
}

const STATS_SQL =
  'select (select count(*) from auth.users) as users, pg_catalog.pg_database_size(pg_catalog.current_database()) as db_bytes';

function firstRow(res) {
  if (Array.isArray(res)) return res[0] || null;
  if (res && Array.isArray(res.result)) return res.result[0] || null;
  if (res && Array.isArray(res.rows)) return res.rows[0] || null;
  return null;
}

const supabase = {
  id: 'supabase',
  name: 'Supabase',
  keyId: 'supabase',
  dashboardUrl: 'https://supabase.com/dashboard/projects',
  hosts: ['api.supabase.com'],

  dashboardFor(config) {
    return `https://supabase.com/dashboard/project/${config.supabaseRef}`;
  },

  async test({ fetch, getKey, config }) {
    const key = getKey('supabase');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    await request(fetch, `${API}/projects/${config.supabaseRef}/health?services=db`, { headers: headers(key) });
    return 'Verbindung ok. Projektstatus lässt sich lesen.';
  },

  async load({ fetch, getKey, config }) {
    const key = getKey('supabase');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    const ref = config.supabaseRef;
    const health = await request(fetch, `${API}/projects/${ref}/health?services=auth,db,rest,storage`, { headers: headers(key) });

    let stats = null;
    let statsError = null;
    try {
      const res = await request(fetch, `${API}/projects/${ref}/database/query/read-only`, {
        method: 'POST',
        headers: { ...headers(key), 'Content-Type': 'application/json' },
        body: { query: STATS_SQL },
      });
      const row = firstRow(res);
      if (!row) throw new ServiceError('badresponse', 'Leere Antwort.');
      stats = { users: String(row.users), dbBytes: String(row.db_bytes) };
    } catch (e) {
      statsError = `Nutzer/Grösse: ${e.message}`;
    }

    let project = null;
    try {
      const p = await request(fetch, `${API}/projects/${ref}`, { headers: headers(key) });
      project = { name: p.name, region: p.region, status: p.status };
    } catch {
      project = null;
    }

    const services = (Array.isArray(health) ? health : []).map((s) => ({ name: s.name, healthy: Boolean(s.healthy), status: s.status }));
    return {
      detail: {
        ref,
        project,
        services,
        allHealthy: services.length > 0 && services.every((s) => s.healthy),
        stats,
        statsError,
        planNote: 'Plan und Kosten trägst du unter «Fixkosten» ein (keine Kosten-API).',
      },
    };
  },
};

module.exports = supabase;
