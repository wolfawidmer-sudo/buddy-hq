'use strict';

// Railway Public API (GraphQL), Workspace- oder Account-Token mit «Authorization: Bearer».
// Doku: https://docs.railway.com/integrations/api
// Kosten: die Nutzungsfelder sind nicht dokumentiert → Railway-Kosten als Fixkosten eintragen.
// Health-Check von /health läuft ohne Key.

const { request, ServiceError } = require('./http');

const GQL = 'https://backboard.railway.com/graphql/v2';

const PROJECT_QUERY = `query hqProject($id: String!) {
  project(id: $id) {
    id
    name
    services { edges { node { id name } } }
  }
}`;

const DEPLOYMENTS_QUERY = `query hqDeployments($input: DeploymentListInput!, $first: Int) {
  deployments(input: $input, first: $first) {
    edges { node { id status createdAt } }
  }
}`;

async function gql(fetchImpl, key, query, variables) {
  const res = await request(fetchImpl, GQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: { query, variables },
  });
  if (res.errors && res.errors.length) {
    const msg = String(res.errors[0].message || 'GraphQL-Fehler').slice(0, 160);
    throw new ServiceError('graphql', `Railway: ${msg}`);
  }
  return res.data;
}

async function healthCheck(fetchImpl, url, now) {
  if (!url) return null;
  const t0 = now();
  try {
    const res = await request(fetchImpl, url, { parse: 'none', timeoutMs: 8_000, headers: { Accept: '*/*' } });
    return { ok: true, status: res.status, ms: now() - t0 };
  } catch (e) {
    return { ok: false, error: e.message, ms: now() - t0 };
  }
}

const railway = {
  id: 'railway',
  name: 'Railway',
  keyId: 'railway',
  dashboardUrl: 'https://railway.com/dashboard',
  hosts: ['backboard.railway.com'],

  dashboardFor(config) {
    return config.railwayProjectId ? `https://railway.com/project/${config.railwayProjectId}` : this.dashboardUrl;
  },

  async test({ fetch, getKey, config }) {
    const key = getKey('railway');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    if (!config.railwayProjectId) throw new ServiceError('config', 'Projekt-ID fehlt in den Einstellungen.');
    const data = await gql(fetch, key, PROJECT_QUERY, { id: config.railwayProjectId });
    return `Verbindung ok. Projekt «${data.project.name}».`;
  },

  async load({ fetch, getKey, config, now }) {
    const health = await healthCheck(fetch, config.healthUrl, now);
    const key = getKey('railway');
    if (!key) {
      // Ohne Key nur der Health-Check.
      return { partial: true, error: 'Kein Key eingetragen (nur Health-Check).', detail: { health, project: null, deployments: [] } };
    }
    if (!config.railwayProjectId) throw new ServiceError('config', 'Projekt-ID fehlt in den Einstellungen.');
    const [p, d] = await Promise.all([
      gql(fetch, key, PROJECT_QUERY, { id: config.railwayProjectId }),
      gql(fetch, key, DEPLOYMENTS_QUERY, { input: { projectId: config.railwayProjectId }, first: 5 }),
    ]);
    return {
      detail: {
        health,
        project: {
          name: p.project.name,
          services: (p.project.services?.edges || []).map((e) => e.node.name),
        },
        deployments: (d.deployments?.edges || []).map((e) => ({ status: e.node.status, createdAt: e.node.createdAt })),
        costNote: 'Railway-Kosten trägst du unter «Fixkosten» ein (Nutzungsdaten sind in der API nicht dokumentiert).',
      },
    };
  },
};

module.exports = railway;
