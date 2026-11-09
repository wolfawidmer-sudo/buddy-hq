'use strict';

// Alle Dienste mit Anleitung: welcher Key, wo erstellen, welche Rechte.

const stripe = require('./stripe');
const openai = require('./openai');
const github = require('./github');
const supabase = require('./supabase');
const railway = require('./railway');
const resend = require('./resend');
const { domain } = require('./domain');

const KEY_HELP = {
  stripe: {
    label: 'Stripe Restricted Key (rk_live_…)',
    steps: [
      'Öffne https://dashboard.stripe.com/apikeys',
      'Klick auf «Create restricted key» (Eingeschränkten Schlüssel erstellen).',
      'Wähle «Building your own integration», Name: Buddy HQ.',
      'Setze nur diese Rechte auf «Read»: Balance, Charges, Payouts. Alles andere bleibt «None».',
      'Klick auf «Create key», kopiere den Key (beginnt mit rk_live_) und füge ihn hier ein.',
    ],
  },
  openai: {
    label: 'OpenAI Admin Key (sk-admin-…)',
    steps: [
      'Öffne https://platform.openai.com/settings/organization/admin-keys (nur als Organization Owner sichtbar).',
      'Klick auf «Create new admin key», Name: Buddy HQ.',
      'Wähle bei den Berechtigungen «Read only».',
      'Kopiere den Key und füge ihn hier ein. Er wird nur einmal angezeigt.',
    ],
  },
  github: {
    label: 'GitHub Fine-grained Token (github_pat_…)',
    steps: [
      'Öffne https://github.com/settings/personal-access-tokens/new',
      'Name: Buddy HQ, Ablauf: 90 Tage (oder länger).',
      'Repository access: «Only select repositories» → buddy-island, buddy-hq und alle Repos, deren Commit-Raster (grüne Felder) du sehen willst. Oder «All repositories», dann kannst du jedes Repo auswählen.',
      'Repository permissions: Actions = Read-only, Contents = Read-only (Metadata ist automatisch Read-only). Contents braucht es auch für die Commit-Statistik.',
      'Account permissions: Plan = Read-only (für die Actions-Kosten).',
      'Klick auf «Generate token», kopiere ihn und füge ihn hier ein.',
    ],
  },
  supabase: {
    label: 'Supabase Access Token (sbp_…)',
    steps: [
      'Öffne https://supabase.com/dashboard/account/tokens',
      'Klick auf «Generate new token», Name: Buddy HQ.',
      'Wähle das Preset «No access» (nicht «Read-only», das enthält auch API-Keys).',
      'Beschränke den Token auf das Projekt buddy-island.',
      'Setze diese Rechte auf Read: Project (project_admin_read) und Database (database_read).',
      'Kopiere den Token und füge ihn hier ein.',
    ],
  },
  railway: {
    label: 'Railway Workspace-Token',
    steps: [
      'Öffne https://railway.com/account/tokens',
      'Wähle bei «Workspace» deinen Workspace (wolof_\'s Projects), Name: Buddy HQ.',
      'Klick auf «Create», kopiere den Token und füge ihn hier ein.',
      'Hinweis: Railway kennt keine Nur-Lese-Tokens. Der Token kann den ganzen Workspace verwalten. Buddy HQ liest nur.',
      'Trag unten die Projekt-ID ein. Dein einziges Projekt heisst «motivated-spontaneity» (ID e91889d9-5698-4e40-a877-11720c79bf61). Prüf, ob das dein Buddy-Backend ist.',
    ],
  },
  resend: {
    label: 'Resend API Key (re_…), Full access',
    steps: [
      'Öffne https://resend.com/api-keys',
      'Klick auf «Create API Key», Name: Buddy HQ.',
      'Permission: «Full access». Nur damit lassen sich Mails auflisten («Sending access» kann nur senden).',
      'Kopiere den Key und füge ihn hier ein. Buddy HQ liest nur und sendet nie.',
    ],
  },
};

const SERVICES = [stripe, supabase, railway, openai, github, resend, domain];

// Erlaubte Ziele für «Im Dashboard öffnen».
const DASHBOARD_HOSTS = [
  'dashboard.stripe.com',
  'supabase.com',
  'railway.com',
  'platform.openai.com',
  'github.com',
  'resend.com',
  'dcc.godaddy.com',
  'claude.ai',
];

function byId(id) {
  return SERVICES.find((s) => s.id === id) || null;
}

module.exports = { SERVICES, KEY_HELP, DASHBOARD_HOSTS, byId };
