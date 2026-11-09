'use strict';

// HTTP nur im Hauptprozess. Fehler werden in einfache, deutsche Meldungen übersetzt.
// Fehlermeldungen enthalten nie Header oder Keys.

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'buddy-hq';

class ServiceError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
  }
}

function messageForStatus(status) {
  if (status === 401) return ['auth', 'Key ungültig oder abgelaufen (401).'];
  if (status === 403) return ['auth', 'Key hat nicht die nötigen Rechte (403).'];
  if (status === 404) return ['notfound', 'Nicht gefunden (404). ID oder Rechte prüfen.'];
  if (status === 429) return ['ratelimit', 'Zu viele Anfragen (429). Später nochmals versuchen.'];
  if (status >= 500) return ['server', `Dienst hat einen Fehler (${status}).`];
  return ['http', `Unerwartete Antwort (${status}).`];
}

// redirect: Standard 'error' (Keys sollen nie an eine andere Adresse weitergereicht werden).
// Nur Anfragen ohne Key (z. B. RDAP) dürfen 'follow' nutzen.
async function request(fetchImpl, url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, parse = 'json', redirect = 'error' } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new ServiceError('insecure', 'Nur HTTPS ist erlaubt.');
  let res;
  try {
    res = await fetchImpl(u.toString(), {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect,
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new ServiceError('timeout', `Keine Antwort innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden.`);
    }
    throw new ServiceError('network', 'Keine Verbindung (Netzwerk oder DNS).');
  }
  if (!res.ok) {
    const [code, msg] = messageForStatus(res.status);
    throw new ServiceError(code, msg, res.status);
  }
  if (parse === 'text') return res.text();
  if (parse === 'raw') return { status: res.status, text: await res.text() };
  if (parse === 'none') return { status: res.status };
  try {
    return await res.json();
  } catch {
    throw new ServiceError('badresponse', 'Antwort ist kein gültiges JSON.');
  }
}

function toError(e) {
  if (e instanceof ServiceError) return e.message;
  return 'Unerwarteter Fehler beim Laden.';
}

module.exports = { request, ServiceError, toError, DEFAULT_TIMEOUT_MS };
