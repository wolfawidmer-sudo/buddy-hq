'use strict';

// GitHub REST, nur lesend. Fine-grained Token:
//   Repository: Actions (Read), Contents (Read), Metadata (Read) für buddy-island und buddy-hq
//   Account: Plan (Read) für den Billing-Usage-Report
// Doku: https://docs.github.com/en/rest/billing/usage

const { request, ServiceError } = require('./http');

const API = 'https://api.github.com';

function headers(key) {
  return {
    Authorization: `Bearer ${key}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function monthsInPeriod(period) {
  const set = new Set(period.days.map((d) => d.slice(0, 7)));
  return [...set].map((m) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) }));
}

// Commit-Aktivität (grüne Felder) der letzten 52 Wochen pro Repo.
// GET /repos/{owner}/{repo}/stats/commit_activity → [{ week, days[7] (So–Sa), total }]
// 202 = GitHub rechnet noch, später nochmals laden. 204 = leeres Repo.
// Hinweis von GitHub: Merge-Commits werden nicht mitgezählt.
async function commitActivity(fetchImpl, key, fullName) {
  try {
    const res = await request(fetchImpl, `${API}/repos/${fullName}/stats/commit_activity`, { headers: headers(key), parse: 'raw' });
    if (res.status === 202) return { repo: fullName, status: 'pending', weeks: [] };
    if (res.status === 204 || !res.text) return { repo: fullName, status: 'ok', weeks: [] };
    const data = JSON.parse(res.text);
    if (!Array.isArray(data)) return { repo: fullName, status: 'pending', weeks: [] };
    return {
      repo: fullName,
      status: 'ok',
      weeks: data.map((w) => ({ week: Number(w.week), days: (w.days || []).map((n) => Number(n) || 0) })),
    };
  } catch (e) {
    return { repo: fullName, status: 'error', error: e.message, weeks: [] };
  }
}

// Alle ausgewählten Repos zu einem Tagesraster zusammenzählen (UTC-Tage, wie bei GitHub).
function combineActivity(results) {
  const days = new Map();
  for (const r of results) {
    for (const w of r.weeks) {
      w.days.forEach((n, i) => {
        const key = new Date((w.week + i * 86_400) * 1000).toISOString().slice(0, 10);
        days.set(key, (days.get(key) || 0) + n);
      });
    }
  }
  return [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, count]) => ({ date, count }));
}

const github = {
  id: 'github',
  name: 'GitHub',
  keyId: 'github',
  dashboardUrl: 'https://github.com/settings/billing',
  hosts: ['api.github.com'],
  costSource: true,

  async test({ fetch, getKey }) {
    const key = getKey('github');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    const me = await request(fetch, `${API}/user`, { headers: headers(key) });
    return `Verbindung ok. Angemeldet als ${me.login}.`;
  },

  async load({ fetch, getKey, config }, period) {
    const key = getKey('github');
    if (!key) throw new ServiceError('nokey', 'Kein Key eingetragen.');
    const owner = config.githubOwner;
    const repo = config.githubRepo;
    const me = await request(fetch, `${API}/user`, { headers: headers(key) });

    const activityRepos = config.activityRepos || [];
    const [runs, releases, repos, activity] = await Promise.all([
      request(fetch, `${API}/repos/${owner}/${repo}/actions/runs?per_page=5`, { headers: headers(key) }),
      request(fetch, `${API}/repos/${owner}/${repo}/releases?per_page=5`, { headers: headers(key) }),
      request(fetch, `${API}/user/repos?per_page=100&affiliation=owner&sort=pushed`, { headers: headers(key) }),
      Promise.all(activityRepos.map((r) => commitActivity(fetch, key, r))),
    ]);

    let costs;
    try {
      const items = [];
      for (const { year, month } of monthsInPeriod(period)) {
        const res = await request(fetch, `${API}/users/${me.login}/settings/billing/usage?year=${year}&month=${month}`, {
          headers: headers(key),
        });
        for (const u of res.usageItems || []) {
          if (u.netAmount === undefined || u.netAmount === null) continue;
          items.push({
            date: String(u.date).slice(0, 10),
            amount: u.netAmount,
            currency: 'USD',
            label: `GitHub ${u.product || ''}`.trim(),
          });
        }
      }
      costs = { status: 'live', items };
    } catch (e) {
      costs = { status: 'unavailable', error: `Billing: ${e.message}`, items: [] };
    }

    return {
      costs,
      detail: {
        login: me.login,
        repo: `${owner}/${repo}`,
        runs: (runs.workflow_runs || []).map((r) => ({
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          branch: r.head_branch,
          createdAt: r.created_at,
        })),
        releases: (releases || []).map((r) => ({ tag: r.tag_name, name: r.name, publishedAt: r.published_at, draft: r.draft })),
        repos: (repos || []).map((r) => ({ name: r.full_name, private: r.private, pushedAt: r.pushed_at })),
        activity: {
          repos: activity.map((a) => ({
            repo: a.repo,
            status: a.status,
            error: a.error || null,
            total: a.weeks.reduce((s, w) => s + w.days.reduce((x, y) => x + y, 0), 0),
          })),
          days: combineActivity(activity),
          note: 'Commits pro Tag (UTC), letzte 52 Wochen, ohne Merge-Commits.',
        },
      },
    };
  },
};

module.exports = github;
module.exports.combineActivity = combineActivity;
