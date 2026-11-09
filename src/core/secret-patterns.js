'use strict';

// Muster für API-Keys und andere Secrets. Genutzt vom Secret-Scan und vom Log-Filter.

const PATTERNS = [
  { name: 'Stripe Secret/Restricted Key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { name: 'OpenAI Key', re: /\bsk-(?!ant-)(?:proj-|admin-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { name: 'Anthropic Key', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}/g },
  { name: 'Supabase Token', re: /\b(?:sbp_[A-Za-z0-9_]{20,}|sb_secret_[A-Za-z0-9_-]{16,})/g },
  { name: 'Resend Key', re: /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{10,}/g },
  { name: 'GitHub Token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { name: 'Private Key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { name: 'JWT (z. B. service_role)', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

module.exports = { PATTERNS };
