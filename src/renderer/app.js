'use strict';

// Buddy HQ – Oberfläche. Kein Netz, kein Node. Alles läuft über window.hq (preload).
// DOM wird nur mit createElement/textContent gebaut, nie mit innerHTML aus Daten.

(() => {
  const hq = window.hq;
  const root = document.getElementById('app');
  const SVG = 'http://www.w3.org/2000/svg';

  // ---------- Helfer ----------

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
    append(el, children);
    return el;
  }

  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v !== null && v !== undefined) el.setAttribute(k, String(v));
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  function cleanError(e) {
    const msg = (e && e.message) || String(e);
    return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  }

  const nf = new Intl.NumberFormat('de-CH');
  const dateFmt = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Europe/Zurich' });
  const dateTimeFmt = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
  const monthFmt = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shortMonth = new Intl.DateTimeFormat('de-CH', { month: 'short', timeZone: 'UTC' });

  function chf(rappen, { sign = false } = {}) {
    if (rappen === null || rappen === undefined) return '–';
    const r = BigInt(rappen);
    const neg = r < 0n;
    const abs = neg ? -r : r;
    const francs = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '’');
    const cents = (abs % 100n).toString().padStart(2, '0');
    const prefix = neg ? '−' : sign && r > 0n ? '+' : '';
    return `${prefix}CHF ${francs}.${cents}`;
  }

  function minor(amountMinor, currency) {
    const r = BigInt(amountMinor);
    const neg = r < 0n;
    const abs = neg ? -r : r;
    const main = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '’');
    return `${neg ? '−' : ''}${String(currency || '').toUpperCase()} ${main}.${(abs % 100n).toString().padStart(2, '0')}`;
  }

  function dateOf(value) {
    if (value === null || value === undefined || value === '') return '–';
    const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    return Number.isNaN(d.getTime()) ? '–' : dateFmt.format(d);
  }

  function dateKeyLabel(key) {
    const [y, m, d] = key.split('-').map(Number);
    return `${d}.${m}.${y}`;
  }

  function bytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '–';
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
    return `${(v / 1024 ** 2).toFixed(1)} MB`;
  }

  const ORIGIN = { live: 'live', estimated: 'geschätzt', manual: 'manuell', unavailable: 'nicht verfügbar' };

  // ---------- Zustand ----------

  const state = {
    view: 'overview',
    period: 'month',
    data: null,
    loading: false,
    loadError: null,
    config: null,
    keys: null,
    keyResults: {},
  };

  let refreshTimer = null;

  function toast(text) {
    const t = h('div', { class: 'toast', role: 'status' }, text);
    document.body.append(t);
    setTimeout(() => t.remove(), 3200);
  }

  async function applyTheme() {
    try {
      const theme = await hq.theme();
      document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
    } catch {
      document.documentElement.dataset.theme = 'dark';
    }
  }

  // Aktivität melden (für die automatische Sperre), höchstens alle 30 Sekunden.
  let lastPing = 0;
  function ping() {
    const now = Date.now();
    if (now - lastPing > 30_000 && document.body.dataset.screen === 'app') {
      lastPing = now;
      hq.activity().catch(() => {});
    }
  }
  for (const ev of ['mousemove', 'keydown', 'mousedown', 'wheel']) window.addEventListener(ev, ping, { passive: true });

  hq.onLocked(() => {
    stopRefresh();
    state.data = null;
    state.keys = null;
    showLogin('Gesperrt nach Inaktivität.');
  });

  // ---------- Anmelden / Einrichten ----------

  function screen(name, node) {
    document.body.dataset.screen = name;
    root.replaceChildren(node);
  }

  function showSetup() {
    const err = h('div', { class: 'form-error', role: 'alert' });
    const user = h('input', { type: 'text', id: 'u', autocomplete: 'username', required: true });
    const pw = h('input', { type: 'password', id: 'p', autocomplete: 'new-password', required: true });
    const pw2 = h('input', { type: 'password', id: 'p2', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Zugang einrichten');
    const form = h(
      'form',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          if (pw.value !== pw2.value) {
            err.textContent = 'Die Passwörter stimmen nicht überein.';
            return;
          }
          btn.disabled = true;
          btn.textContent = 'Wird eingerichtet …';
          try {
            await hq.auth.setup(user.value, pw.value);
            pw.value = '';
            pw2.value = '';
            await enterApp();
          } catch (e2) {
            err.textContent = cleanError(e2);
            btn.disabled = false;
            btn.textContent = 'Zugang einrichten';
          }
        },
      },
      h('label', { for: 'u' }, 'Benutzername'),
      user,
      h('label', { for: 'p' }, 'Passwort (mindestens 10 Zeichen)'),
      pw,
      h('label', { for: 'p2' }, 'Passwort wiederholen'),
      pw2,
      err,
      h('div', { class: 'actions' }, btn),
    );
    screen(
      'setup',
      h(
        'div',
        { class: 'gate' },
        h(
          'div',
          { class: 'gate-inner' },
          h('h1', {}, 'Buddy HQ'),
          h('p', { class: 'lede' }, 'Leg Benutzername und Passwort fest. Damit werden auch deine Keys verschlüsselt. Ohne Passwort lassen sie sich nicht wiederherstellen.'),
          form,
        ),
      ),
    );
    user.focus();
  }

  function showLogin(message) {
    const err = h('div', { class: 'form-error', role: 'alert' }, message || '');
    const user = h('input', { type: 'text', id: 'u', autocomplete: 'username', required: true });
    const pw = h('input', { type: 'password', id: 'p', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Anmelden');
    const form = h(
      'form',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          btn.disabled = true;
          btn.textContent = 'Prüfe …';
          try {
            const r = await hq.auth.login(user.value, pw.value);
            pw.value = '';
            if (r.ok) {
              await enterApp();
              return;
            }
            err.textContent = r.error;
          } catch (e2) {
            err.textContent = cleanError(e2);
          }
          btn.disabled = false;
          btn.textContent = 'Anmelden';
        },
      },
      h('label', { for: 'u' }, 'Benutzername'),
      user,
      h('label', { for: 'p' }, 'Passwort'),
      pw,
      err,
      h('div', { class: 'actions' }, btn),
    );
    const forgot = h(
      'div',
      { class: 'forgot' },
      h(
        'button',
        {
          class: 'link',
          type: 'button',
          onclick: async () => {
            const ok = window.confirm(
              'Passwort vergessen?\n\nDabei werden ALLE gespeicherten Keys und dein Zugang gelöscht. Danach richtest du alles neu ein und trägst die Keys erneut ein.\n\nFortfahren?',
            );
            if (!ok) return;
            await hq.auth.forgot();
            showSetup();
          },
        },
        'Passwort vergessen – alle Keys löschen und neu einrichten',
      ),
    );
    screen('login', h('div', { class: 'gate' }, h('div', { class: 'gate-inner' }, h('h1', {}, 'Buddy HQ'), h('p', { class: 'lede' }, 'Melde dich an.'), form, forgot)));
    user.focus();
  }

  async function enterApp() {
    state.config = await hq.config.get();
    state.period = state.config.period || 'month';
    document.documentElement.dataset.theme = state.config.theme === 'light' ? 'light' : 'dark';
    document.body.dataset.screen = 'app';
    state.view = 'overview';
    render();
    await load();
    startRefresh();
  }

  function startRefresh() {
    stopRefresh();
    refreshTimer = setInterval(() => load({ quiet: true }), 10 * 60_000);
  }

  function stopRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  async function load({ quiet = false } = {}) {
    state.loading = true;
    state.loadError = null;
    if (!quiet) render();
    try {
      state.data = await hq.data.load(state.period);
    } catch (e) {
      state.loadError = cleanError(e);
    }
    state.loading = false;
    render();
  }

  // ---------- Grundgerüst ----------

  const SIDEBAR = [
    { id: 'stripe', name: 'Stripe' },
    { id: 'supabase', name: 'Supabase' },
    { id: 'railway', name: 'Railway' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'claude', name: 'Claude' },
    { id: 'github', name: 'GitHub' },
    { id: 'resend', name: 'Resend' },
    { id: 'domain', name: 'Domain' },
  ];

  function svc(id) {
    return state.data ? state.data.services.find((x) => x.id === id) : null;
  }

  function claudeEntry() {
    const list = (state.config && state.config.manualCosts) || [];
    return list.find((m) => /claude/i.test(m.name)) || null;
  }

  function dotFor(id) {
    if (id === 'claude') return claudeEntry() ? 'dot' : 'dot off';
    const x = svc(id);
    if (!x) return 'dot none';
    if (x.status === 'live') return 'dot';
    if (x.status === 'partial' || x.status === 'nokey') return 'dot off';
    return 'dot bad';
  }

  function statusText(id) {
    const x = svc(id);
    if (!x) return state.loading ? 'Lädt …' : 'Noch nicht geladen';
    if (x.status === 'live') return 'Verbunden';
    if (x.status === 'nokey') return 'Kein Key eingetragen';
    if (x.status === 'partial') return x.error || 'Teilweise geladen';
    return `Fehler: ${x.error}`;
  }

  function navButton(id, label, dotClass) {
    return h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          'aria-current': state.view === id ? 'page' : null,
          onclick: () => {
            state.view = id;
            render();
          },
        },
        dotClass ? h('span', { class: dotClass, 'aria-hidden': 'true' }) : null,
        label,
      ),
    );
  }

  function sidebar() {
    const manual = ((state.config && state.config.manualCosts) || []).filter((m) => !/claude/i.test(m.name));
    return h(
      'nav',
      { class: 'side', 'aria-label': 'Dienste' },
      h('div', { class: 'brand' }, 'Buddy HQ'),
      h(
        'ul',
        { class: 'nav' },
        navButton('overview', 'Reingewinn', null),
        h('li', { class: 'sep', 'aria-hidden': 'true' }),
        SIDEBAR.map((x) => navButton(x.id, x.name, dotFor(x.id))),
        manual.length ? h('li', { class: 'sep', 'aria-hidden': 'true' }) : null,
        manual.map((m) => navButton(`manual:${m.id}`, m.name, 'dot')),
        navButton('add', '+ Dienst', null),
      ),
      h(
        'ul',
        { class: 'nav bottom' },
        navButton('settings', 'Einstellungen', null),
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              onclick: async () => {
                stopRefresh();
                await hq.auth.lock();
                state.data = null;
                showLogin('Gesperrt.');
              },
            },
            'Sperren',
          ),
        ),
      ),
    );
  }

  function render() {
    if (document.body.dataset.screen !== 'app') return;
    const main = h('main', { class: 'main', id: 'main' }, page());
    const prevScroll = document.getElementById('main') ? document.getElementById('main').scrollTop : 0;
    root.replaceChildren(h('div', { class: 'shell' }, sidebar(), main));
    main.scrollTop = prevScroll;
  }

  function page() {
    const v = state.view;
    if (v === 'overview') return overviewPage();
    if (v === 'settings') return settingsPage();
    if (v === 'add') return manualFormPage(null);
    if (v.startsWith('manual:')) return manualDetailPage(v.slice(7));
    return detailPage(v);
  }

  function pageHead(title, sub, ...actions) {
    return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null), h('div', { class: 'row' }, actions));
  }

  function refreshButton() {
    return h('button', { class: 'btn', type: 'button', disabled: state.loading, onclick: () => load() }, state.loading ? 'Lädt …' : 'Aktualisieren');
  }

  // ---------- Startansicht: Reingewinn ----------

  function periodTitle(d) {
    const id = state.period;
    if (id === 'month' && d) return `im ${monthFmt.format(new Date(`${d.period.startKey}T00:00:00Z`))}`;
    if (id === 'year' && d) return `im Jahr ${d.period.startKey.slice(0, 4)}`;
    if (id === '7d') return 'der letzten 7 Tage';
    if (id === '30d') return 'der letzten 30 Tage';
    return '';
  }

  function periodSwitch() {
    const opts = [
      ['7d', '7 Tage'],
      ['30d', '30 Tage'],
      ['month', 'Monat'],
      ['year', 'Jahr'],
    ];
    return h(
      'div',
      { class: 'periods', role: 'group', 'aria-label': 'Zeitraum' },
      opts.map(([id, label]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': state.period === id ? 'true' : 'false',
            onclick: async () => {
              if (state.period === id) return;
              state.period = id;
              hq.config.update({ period: id }).catch(() => {});
              await load();
            },
          },
          label,
        ),
      ),
    );
  }

  function overviewPage() {
    const d = state.data;
    const head = h('div', { class: 'row', 'aria-label': 'Steuerung' }, periodSwitch(), h('span', { class: 'faint' }, d ? `Stand ${dateTimeFmt.format(new Date(d.loadedAt))}` : ''), refreshButton());
    head.classList.add('page-top');

    if (!d) {
      return h(
        'div',
        { class: 'page' },
        head,
        h('div', { class: 'hero' }, h('div', { class: 'label' }, `Reingewinn ${periodTitle(null)}`), h('div', { class: 'figure none' }, state.loading ? '…' : '–')),
        state.loadError ? h('div', { class: 'notice' }, `Laden fehlgeschlagen: ${state.loadError}`) : null,
      );
    }

    const p = d.profit;
    const profit = p.profitRappen;
    const cls = profit === null ? 'none' : BigInt(profit) < 0n ? 'loss' : 'gain';
    const rev = p.revenue;

    const hero = h(
      'div',
      { class: 'hero' },
      h('div', { class: 'label' }, `Reingewinn ${periodTitle(d)}${p.complete ? '' : ', unvollständig'}`),
      h('div', { class: `figure ${cls}` }, profit === null ? 'nicht berechenbar' : chf(profit)),
      h(
        'p',
        { class: 'equation' },
        rev.netRappen !== null
          ? [h('span', { class: 'num' }, chf(rev.netRappen)), ' Einnahmen nach Gebühren und Rückerstattungen, minus ', h('span', { class: 'num' }, chf(p.totalCostsRappen)), ' Kosten.']
          : ['Ohne Stripe-Einnahmen lässt sich kein Gewinn berechnen. Bekannte Kosten: ', h('span', { class: 'num' }, chf(p.totalCostsRappen)), '.'],
      ),
      !p.complete
        ? h(
            'div',
            { class: 'notice', role: 'note' },
            h('strong', {}, 'Unvollständig. '),
            'Diese Posten fehlen in der Rechnung und zählen nicht als 0:',
            h(
              'ul',
              {},
              p.missing.map((m) => h('li', {}, `${m.name}: ${m.reason}`)),
            ),
          )
        : null,
      h(
        'div',
        { class: 'meta-line' },
        p.fx ? `Kurs ${p.fx.currency}→CHF ${p.fx.rate} vom ${dateKeyLabel(p.fx.rateDate)}, ${p.fx.source}.` : d.fxStatus.latest ? `Letzter Kurs vom ${dateKeyLabel(d.fxStatus.latest)} (EZB).` : 'Noch kein Wechselkurs geladen.',
        d.fxStatus.error ? ` Kurs-Abruf fehlgeschlagen: ${d.fxStatus.error}` : '',
      ),
    );

    return h(
      'div',
      { class: 'page' },
      head,
      hero,
      h('section', {}, h('h2', {}, 'Einnahmen und Kosten pro Tag'), chartLegend(), dailyChart(p.daily)),
      h('section', {}, h('h2', {}, 'Die 5 grössten Kostenposten'), topCostsTable(p.topCosts)),
      h('section', {}, h('h2', {}, 'Kosten nach Dienst'), costsTable(p.costs)),
      rev.status === 'live'
        ? h(
            'section',
            {},
            h('h2', {}, 'Einnahmen im Detail'),
            factList([
              ['Verkäufe brutto', h('span', { class: 'num' }, chf(rev.grossRappen))],
              ['Stripe-Gebühren', h('span', { class: 'num' }, chf(-BigInt(rev.feesRappen)))],
              ['Rückerstattungen', h('span', { class: 'num' }, chf(rev.refundsRappen))],
              BigInt(rev.otherRappen) !== 0n ? ['Übrige (z. B. Disputes)', h('span', { class: 'num' }, chf(rev.otherRappen))] : null,
              ['Netto', h('span', { class: 'num' }, chf(rev.netRappen))],
              ['Buchungen', h('span', { class: 'num' }, nf.format(rev.count))],
            ]),
          )
        : null,
    );
  }

  function chartLegend() {
    return h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'rev' }), 'Einnahmen netto'), h('span', {}, h('i', { class: 'cost' }), 'Kosten'));
  }

  function dailyChart(daily) {
    const W = 960;
    const H = 190;
    const padL = 0;
    const padB = 22;
    const vals = daily.flatMap((d) => [Number(d.revenueRappen || 0), Number(d.costsRappen || 0)]);
    const max = Math.max(1, ...vals);
    const min = Math.min(0, ...vals);
    const span = max - min;
    const plotH = H - padB - 8;
    const y = (v) => 8 + ((max - v) / span) * plotH;
    const n = daily.length;
    const slot = (W - padL) / n;
    const bw = Math.max(1, Math.min(10, slot / 2 - 1));
    const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Einnahmen und Kosten pro Tag' });
    svg.append(s('line', { class: 'axis', x1: 0, x2: W, y1: y(0), y2: y(0) }));
    daily.forEach((d, i) => {
      const x = padL + i * slot + slot / 2;
      const r = Number(d.revenueRappen || 0);
      const c = Number(d.costsRappen || 0);
      const title = `${dateKeyLabel(d.date)}: Einnahmen ${chf(d.revenueRappen)}, Kosten ${chf(d.costsRappen)}`;
      if (r !== 0) svg.append(s('rect', { class: 'bar-rev', x: x - bw - 0.5, y: Math.min(y(r), y(0)), width: bw, height: Math.max(1, Math.abs(y(r) - y(0))) }, s('title', {}, title)));
      if (c !== 0) svg.append(s('rect', { class: 'bar-cost', x: x + 0.5, y: y(c), width: bw, height: Math.max(1, y(0) - y(c)) }, s('title', {}, title)));
    });
    svg.append(s('text', { x: 0, y: H - 4 }, dateKeyLabel(daily[0].date)));
    svg.append(s('text', { x: W, y: H - 4, 'text-anchor': 'end' }, dateKeyLabel(daily[n - 1].date)));
    svg.append(s('text', { x: W, y: 18, 'text-anchor': 'end' }, chf(BigInt(Math.round(max)))));
    return svg;
  }

  function topCostsTable(items) {
    if (!items.length) return h('p', { class: 'muted' }, 'Im Zeitraum keine Kosten erfasst.');
    return h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Posten'), h('th', {}, 'Dienst'), h('th', {}, 'Herkunft'), h('th', { class: 'r' }, 'Betrag'))),
      h(
        'tbody',
        {},
        items.map((i) => h('tr', {}, h('td', {}, i.label), h('td', { class: 'muted' }, i.name), h('td', { class: `origin ${i.status}` }, ORIGIN[i.status] || i.status), h('td', { class: 'r num' }, chf(i.rappen)))),
      ),
    );
  }

  function costsTable(costs) {
    if (!costs.length) {
      return h('p', { class: 'muted' }, 'Noch keine Kosten eingerichtet. Trag Keys in den Einstellungen ein oder füge Fixkosten mit «+ Dienst» hinzu.');
    }
    return h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Dienst'), h('th', {}, 'Herkunft'), h('th', { class: 'r' }, 'Betrag'))),
      h(
        'tbody',
        {},
        costs.map((c) =>
          h(
            'tr',
            {},
            h('td', {}, c.name, c.error ? h('div', { class: 'faint' }, c.error) : null),
            h('td', { class: `origin ${c.status}` }, ORIGIN[c.status] || c.status),
            h('td', { class: 'r num' }, c.rappen === null ? '–' : chf(c.rappen)),
          ),
        ),
      ),
    );
  }

  function factList(rows) {
    return h(
      'dl',
      { class: 'facts' },
      rows.filter(Boolean).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v === null || v === undefined || v === '' ? '–' : v)]),
    );
  }

  // ---------- Detailseiten ----------

  function openButton(url) {
    if (!url) return null;
    return h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => hq.open(url).catch((e) => toast(cleanError(e))),
      },
      'Im Dashboard öffnen',
    );
  }

  function testButton(id) {
    return h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          b.textContent = 'Teste …';
          const r = await hq.keys.test(id).catch((err) => ({ ok: false, message: cleanError(err) }));
          toast(r.message);
          b.disabled = false;
          b.textContent = 'Verbindung testen';
        },
      },
      'Verbindung testen',
    );
  }

  function costOf(id) {
    return state.data ? state.data.profit.costs.find((c) => c.id === id) : null;
  }

  function detailPage(id) {
    if (id === 'claude') return claudePage();
    const x = svc(id);
    const meta = SIDEBAR.find((m) => m.id === id);
    const name = meta ? meta.name : id;
    const head = pageHead(name, statusText(id), refreshButton(), testButton(id), openButton(x && x.dashboardUrl));
    const det = x && x.detail;
    let body;
    if (!x) body = h('p', { class: 'muted' }, state.loading ? 'Lädt …' : 'Noch keine Daten.');
    else if (x.status === 'nokey') body = noKeyHint();
    else if (!det) body = h('div', { class: 'notice' }, x.error || 'Keine Daten.');
    else body = renderers[id] ? renderers[id](det, x) : h('pre', {}, JSON.stringify(det, null, 2));
    return h('div', { class: 'page' }, head, body);
  }

  function noKeyHint() {
    return h(
      'div',
      {},
      h('p', {}, 'Für diesen Dienst ist noch kein Key eingetragen.'),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: () => {
            state.view = 'settings';
            render();
          },
        },
        'Zu den Einstellungen',
      ),
    );
  }

  const renderers = {
    stripe(det) {
      const rev = state.data.profit.revenue;
      return [
        factList([
          ['Verkäufe brutto', h('span', { class: 'num' }, chf(rev.grossRappen))],
          ['Gebühren', h('span', { class: 'num' }, rev.feesRappen === null ? '–' : chf(-BigInt(rev.feesRappen)))],
          ['Rückerstattungen', h('span', { class: 'num' }, chf(rev.refundsRappen))],
          ['Netto im Zeitraum', h('span', { class: 'num' }, chf(rev.netRappen))],
          [
            'Nächste Auszahlung',
            det.nextPayout ? h('span', {}, h('span', { class: 'num' }, minor(det.nextPayout.minor, det.nextPayout.currency)), ` am ${dateOf(det.nextPayout.arrivalDate)}`) : 'Keine geplant',
          ],
          ['Guthaben verfügbar', det.balance.available.map((b) => minor(b.minor, b.currency)).join(', ') || '–'],
          ['Guthaben ausstehend', det.balance.pending.map((b) => minor(b.minor, b.currency)).join(', ') || '–'],
        ]),
        h(
          'section',
          {},
          h('h2', {}, 'Letzte Zahlungen'),
          det.recentPayments.length
            ? h(
                'table',
                {},
                h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', {}, 'Status'), h('th', { class: 'r' }, 'Betrag'))),
                h(
                  'tbody',
                  {},
                  det.recentPayments.map((c) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, dateOf(c.created)),
                      h('td', { class: 'muted' }, c.refunded ? 'rückerstattet' : c.status === 'succeeded' ? 'bezahlt' : c.status),
                      h('td', { class: 'r num' }, minor(c.minor, c.currency)),
                    ),
                  ),
                ),
              )
            : h('p', { class: 'muted' }, 'Noch keine Zahlungen.'),
        ),
      ];
    },

    supabase(det) {
      return [
        factList([
          ['Projekt', det.project ? `${det.project.name} (${det.ref})` : det.ref],
          ['Status', det.services.length ? (det.allHealthy ? 'Alle Dienste laufen' : det.services.filter((x) => !x.healthy).map((x) => `${x.name}: ${x.status}`).join(', ')) : '–'],
          ['Region', det.project ? det.project.region : '–'],
          ['Nutzer', det.stats ? nf.format(Number(det.stats.users)) : det.statsError || '–'],
          ['Datenbankgrösse', det.stats ? bytes(det.stats.dbBytes) : '–'],
          ['Plan', det.planNote],
        ]),
        det.services.length
          ? h(
              'section',
              {},
              h('h2', {}, 'Dienste'),
              h(
                'table',
                {},
                h('tbody', {}, det.services.map((x) => h('tr', {}, h('td', {}, x.name), h('td', { class: 'muted' }, x.healthy ? 'läuft' : x.status)))),
              ),
            )
          : null,
      ];
    },

    railway(det, x) {
      const hc = det.health;
      return [
        x.status === 'partial' ? h('div', { class: 'notice' }, x.error) : null,
        factList([
          ['Health-Check /health', hc ? (hc.ok ? `erreichbar (${hc.status}) in ${hc.ms} ms` : `nicht erreichbar: ${hc.error}`) : 'keine Adresse eingetragen'],
          ['Projekt', det.project ? det.project.name : '–'],
          ['Services', det.project ? det.project.services.join(', ') || '–' : '–'],
          ['Letzter Deploy', det.deployments[0] ? `${det.deployments[0].status}, ${dateOf(det.deployments[0].createdAt)}` : '–'],
          ['Kosten', det.costNote || '–'],
        ]),
        det.deployments.length
          ? h(
              'section',
              {},
              h('h2', {}, 'Letzte Deploys'),
              h(
                'table',
                {},
                h('tbody', {}, det.deployments.map((d) => h('tr', {}, h('td', {}, dateTimeFmt.format(new Date(d.createdAt))), h('td', { class: 'muted' }, d.status)))),
              ),
            )
          : null,
      ];
    },

    openai(det) {
      const c = costOf('openai');
      return [
        factList([
          ['Kosten im Zeitraum', c ? (c.rappen === null ? `nicht verfügbar: ${c.error}` : h('span', { class: 'num' }, chf(c.rappen))) : 'Kostenquelle ausgeschaltet'],
          ['Guthaben', det.balanceNote],
          ['Hinweis', det.utcNote],
        ]),
        h(
          'section',
          {},
          h('h2', {}, 'Tokens pro Modell'),
          det.tokens && det.tokens.length
            ? h(
                'table',
                {},
                h('thead', {}, h('tr', {}, h('th', {}, 'Modell'), h('th', { class: 'r' }, 'Eingabe'), h('th', { class: 'r' }, 'Ausgabe'), h('th', { class: 'r' }, 'Anfragen'))),
                h(
                  'tbody',
                  {},
                  det.tokens.map((t) => h('tr', {}, h('td', {}, t.model), h('td', { class: 'r num' }, nf.format(t.input)), h('td', { class: 'r num' }, nf.format(t.output)), h('td', { class: 'r num' }, nf.format(t.requests)))),
                ),
              )
            : h('p', { class: 'muted' }, det.tokensError ? `Nicht verfügbar: ${det.tokensError}` : 'Keine Nutzung im Zeitraum.'),
        ),
      ];
    },

    github(det) {
      const c = costOf('github');
      return [
        h('section', { class: 'first' }, h('h2', {}, 'Commits'), activityBlock(det.activity), repoPicker(det)),
        h(
          'section',
          {},
          h('h2', {}, det.repo),
          factList([
            ['Letzter CI-Lauf', det.runs[0] ? `${det.runs[0].name}: ${det.runs[0].conclusion || det.runs[0].status} (${det.runs[0].branch}, ${dateOf(det.runs[0].createdAt)})` : '–'],
            ['Letztes Release', det.releases[0] ? `${det.releases[0].tag}, ${dateOf(det.releases[0].publishedAt)}` : '–'],
            ['Actions-Kosten im Zeitraum', c ? (c.rappen === null ? `nicht verfügbar: ${c.error}` : h('span', { class: 'num' }, chf(c.rappen))) : 'Kostenquelle ausgeschaltet'],
          ]),
        ),
        det.releases.length
          ? h(
              'section',
              {},
              h('h2', {}, 'Releases'),
              h('table', {}, h('tbody', {}, det.releases.map((r) => h('tr', {}, h('td', {}, r.tag), h('td', { class: 'muted' }, r.draft ? 'Entwurf' : dateOf(r.publishedAt)))))),
            )
          : null,
        h(
          'section',
          {},
          h('h2', {}, 'Repos'),
          h('table', {}, h('tbody', {}, det.repos.map((r) => h('tr', {}, h('td', {}, r.name), h('td', { class: 'muted' }, r.private ? 'privat' : 'öffentlich'), h('td', { class: 'r faint' }, dateOf(r.pushedAt)))))),
        ),
      ];
    },

    resend(det) {
      const LABELS = { delivered: 'zugestellt', sent: 'versendet', bounced: 'unzustellbar', opened: 'geöffnet', clicked: 'geklickt', complained: 'als Spam gemeldet', delivery_delayed: 'verzögert', scheduled: 'geplant', failed: 'fehlgeschlagen', canceled: 'abgebrochen', queued: 'in Warteschlange' };
      return [
        factList([['Mails im Zeitraum', h('span', { class: 'num' }, nf.format(det.total))]]),
        det.note ? h('div', { class: 'notice' }, det.note) : null,
        h(
          'section',
          {},
          h('h2', {}, 'Nach letztem Status'),
          Object.keys(det.counts).length
            ? h(
                'table',
                {},
                h('tbody', {}, Object.entries(det.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('tr', {}, h('td', {}, LABELS[k] || k), h('td', { class: 'r num' }, nf.format(v))))),
              )
            : h('p', { class: 'muted' }, 'Keine Mails im Zeitraum.'),
        ),
      ];
    },

    domain(det) {
      return factList([
        ['Domain', det.domain],
        ['Läuft ab am', dateOf(det.expires)],
        ['Noch', det.daysLeft === null ? '–' : `${nf.format(det.daysLeft)} Tage`],
        ['Registrar', det.registrar || '–'],
        ['Quelle', det.source],
        ['Kosten', det.costNote],
      ]);
    },
  };

  // Commit-Raster: 53 Wochen × 7 Tage, wie bei GitHub (So oben).
  function activityBlock(a) {
    if (!a) return h('p', { class: 'muted' }, 'Keine Daten.');
    const counts = new Map(a.days.map((d) => [d.date, d.count]));
    const today = new Date();
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 7 * 52 - end.getUTCDay());
    const max = Math.max(0, ...a.days.map((d) => d.count));
    const level = (n) => (n <= 0 ? 0 : max <= 4 ? Math.min(4, n) : Math.min(4, Math.ceil((n / max) * 4)));
    const cell = 11;
    const gap = 3;
    const left = 26;
    const top = 16;
    const weeks = 53;
    const svg = s('svg', { width: left + weeks * (cell + gap), height: top + 7 * (cell + gap), role: 'img', 'aria-label': 'Commits pro Tag, letzte 12 Monate' });
    ['', 'Mo', '', 'Mi', '', 'Fr', ''].forEach((t, i) => t && svg.append(s('text', { x: 0, y: top + i * (cell + gap) + 9 }, t)));
    let total = 0;
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const day = new Date(start);
        day.setUTCDate(start.getUTCDate() + w * 7 + d);
        if (day > end) continue;
        const key = day.toISOString().slice(0, 10);
        const n = counts.get(key) || 0;
        total += n;
        if (d === 0 && day.getUTCMonth() !== lastMonth && day.getUTCDate() <= 7) {
          lastMonth = day.getUTCMonth();
          svg.append(s('text', { x: left + w * (cell + gap), y: 10 }, shortMonth.format(day)));
        }
        svg.append(
          s(
            'rect',
            { class: `c${level(n)}`, x: left + w * (cell + gap), y: top + d * (cell + gap), width: cell, height: cell, rx: 2 },
            s('title', {}, `${n === 1 ? '1 Commit' : `${nf.format(n)} Commits`} am ${dateKeyLabel(key)}`),
          ),
        );
      }
    }
    const repoLines = a.repos.map((r) =>
      h(
        'li',
        {},
        r.repo,
        ': ',
        r.status === 'ok' ? `${nf.format(r.total)} Commits` : r.status === 'pending' ? 'GitHub berechnet die Zahlen noch. In einer Minute nochmals aktualisieren.' : `Fehler: ${r.error}`,
      ),
    );
    return h(
      'div',
      {},
      h('p', {}, h('span', { class: 'num' }, nf.format(total)), ` Commits in den letzten 12 Monaten über ${a.repos.length === 1 ? '1 Repo' : `${a.repos.length} Repos`}.`),
      h('div', { class: 'activity' }, svg),
      h('div', { class: 'scale' }, 'weniger', [0, 1, 2, 3, 4].map((i) => h('span', { class: `sw c${i}` })), 'mehr'),
      h('ul', { class: 'muted' }, repoLines),
      h('p', { class: 'faint' }, a.note),
    );
  }

  function repoPicker(det) {
    const selected = new Set(state.config.activityRepos || []);
    const all = [...new Set([...(det.repos || []).map((r) => r.name), ...selected])].sort();
    const boxes = all.map((name) => {
      const input = h('input', { type: 'checkbox', value: name, checked: selected.has(name) });
      return h('label', { class: 'check' }, input, name);
    });
    const err = h('div', { class: 'form-error' });
    return h(
      'details',
      {},
      h('summary', {}, 'Repos auswählen'),
      h('p', { class: 'faint' }, 'Es erscheinen nur Repos, auf die dein GitHub-Token Zugriff hat.'),
      boxes,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: async () => {
              const list = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
              try {
                state.config = await hq.config.update({ activityRepos: list });
                toast('Repo-Auswahl gespeichert.');
                await load();
              } catch (e) {
                err.textContent = cleanError(e);
              }
            },
          },
          'Auswahl speichern',
        ),
      ),
      err,
    );
  }

  function claudePage() {
    const entry = claudeEntry();
    const head = pageHead('Claude', entry ? 'Pro-Abo, manuell erfasst' : 'Noch nicht erfasst', openButton('https://claude.ai/settings/billing'));
    if (!entry) {
      return h(
        'div',
        { class: 'page' },
        head,
        h('p', {}, 'Für Claude-Abos gibt es keine öffentliche Schnittstelle. Trag den Preis einmal ein, dann zählt er in den Kosten mit.'),
        manualForm({ name: 'Claude Pro', currency: 'USD', link: 'https://claude.ai/settings/billing' }),
      );
    }
    return h('div', { class: 'page' }, head, manualFacts(entry), h('section', {}, h('h2', {}, 'Bearbeiten'), manualForm(entry)));
  }

  function manualFacts(m) {
    const c = costOf(m.id);
    return factList([
      ['Kosten pro Monat', h('span', { class: 'num' }, `${m.currency} ${m.monthly}`)],
      ['Im gewählten Zeitraum', c && c.rappen !== null ? h('span', { class: 'num' }, chf(c.rappen)) : c ? `nicht verfügbar: ${c.error}` : '–'],
      ['Verlängerung', m.renews ? dateKeyLabel(m.renews) : '–'],
      ['Gültig', m.from || m.until ? `${m.from ? `ab ${dateKeyLabel(m.from)}` : ''} ${m.until ? `bis ${dateKeyLabel(m.until)}` : ''}`.trim() : 'laufend'],
      ['Notiz', m.note || '–'],
      ['Herkunft', 'manuell'],
    ]);
  }

  function manualDetailPage(id) {
    const m = ((state.config && state.config.manualCosts) || []).find((x) => x.id === id);
    if (!m) return h('div', { class: 'page' }, pageHead('Nicht gefunden', null));
    return h('div', { class: 'page' }, pageHead(m.name, 'Manueller Eintrag', openButton(m.link)), manualFacts(m), h('section', {}, h('h2', {}, 'Bearbeiten'), manualForm(m)));
  }

  const TEMPLATES = [
    { name: 'Claude Pro', currency: 'USD', link: 'https://claude.ai/settings/billing' },
    { name: 'Domain buddy-island.top', currency: 'CHF', note: 'Jahrespreis ÷ 12' },
    { name: 'Supabase-Plan', currency: 'USD', link: 'https://supabase.com/dashboard/org' },
    { name: 'Railway-Plan', currency: 'USD', link: 'https://railway.com/account/billing' },
    { name: 'GitHub-Plan', currency: 'USD', link: 'https://github.com/settings/billing' },
    { name: 'Resend-Plan', currency: 'USD', link: 'https://resend.com/settings/billing' },
  ];

  function manualFormPage() {
    let form = manualForm({ currency: 'CHF' });
    const holder = h('div', {}, form);
    return h(
      'div',
      { class: 'page' },
      pageHead('Dienst hinzufügen', 'Fixkosten, die keine API liefert. Sie werden tagesgenau auf den Zeitraum verteilt.'),
      h(
        'p',
        { class: 'muted' },
        'Vorlagen: ',
        TEMPLATES.map((t, i) => [
          i ? ', ' : '',
          h(
            'button',
            {
              class: 'link',
              type: 'button',
              onclick: () => {
                form = manualForm(t);
                holder.replaceChildren(form);
              },
            },
            t.name,
          ),
        ]),
      ),
      holder,
    );
  }

  function manualForm(entry) {
    const f = {
      name: h('input', { type: 'text', id: 'mn', value: entry.name || '', required: true }),
      monthly: h('input', { type: 'text', id: 'mm', value: entry.monthly || '', inputmode: 'decimal', placeholder: 'z. B. 18.50', required: true }),
      currency: h('select', { id: 'mc' }, ['CHF', 'USD', 'EUR'].map((c) => h('option', { value: c, selected: (entry.currency || 'CHF') === c }, c))),
      renews: h('input', { type: 'date', id: 'mr', value: entry.renews || '' }),
      link: h('input', { type: 'text', id: 'ml', value: entry.link || '', placeholder: 'https://…' }),
      from: h('input', { type: 'date', id: 'mf', value: entry.from || '' }),
      until: h('input', { type: 'date', id: 'mu', value: entry.until || '' }),
      note: h('input', { type: 'text', id: 'mo', value: entry.note || '' }),
    };
    const err = h('div', { class: 'form-error', role: 'alert' });
    return h(
      'form',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          try {
            const saved = await hq.manual.upsert({
              id: entry.id,
              name: f.name.value,
              monthly: f.monthly.value,
              currency: f.currency.value,
              renews: f.renews.value || null,
              link: f.link.value || null,
              from: f.from.value || null,
              until: f.until.value || null,
              note: f.note.value,
            });
            state.config = await hq.config.get();
            state.view = /claude/i.test(saved.name) ? 'claude' : `manual:${saved.id}`;
            toast('Gespeichert.');
            await load();
          } catch (e2) {
            err.textContent = cleanError(e2);
          }
        },
      },
      h('div', { class: 'grid-4' }, h('div', {}, h('label', { for: 'mn' }, 'Name'), f.name), h('div', {}, h('label', { for: 'mm' }, 'Kosten pro Monat'), f.monthly), h('div', {}, h('label', { for: 'mc' }, 'Währung'), f.currency), h('div', {}, h('label', { for: 'mr' }, 'Verlängerung'), f.renews)),
      h('div', { class: 'grid-4' }, h('div', {}, h('label', { for: 'ml' }, 'Link zum Dashboard'), f.link), h('div', {}, h('label', { for: 'mf' }, 'Gilt ab'), f.from), h('div', {}, h('label', { for: 'mu' }, 'Gilt bis'), f.until), h('div', {}, h('label', { for: 'mo' }, 'Notiz'), f.note)),
      err,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, entry.id ? 'Änderungen speichern' : 'Hinzufügen'),
        entry.id
          ? h(
              'button',
              {
                class: 'btn danger',
                type: 'button',
                onclick: async () => {
                  if (!window.confirm(`«${entry.name}» löschen?`)) return;
                  await hq.manual.remove(entry.id);
                  state.config = await hq.config.get();
                  state.view = 'overview';
                  await load();
                },
              },
              'Löschen',
            )
          : null,
      ),
    );
  }

  // ---------- Einstellungen ----------

  function linkify(text) {
    const parts = String(text).split(/(https:\/\/[^\s)]+)/g);
    return parts.map((p) =>
      p.startsWith('https://')
        ? h(
            'button',
            {
              class: 'link',
              type: 'button',
              onclick: () => hq.open(p.replace(/[.,]$/, '')).catch((e) => toast(cleanError(e))),
            },
            p,
          )
        : p,
    );
  }

  function settingsPage() {
    if (!state.keys) {
      hq.keys
        .overview()
        .then((k) => {
          state.keys = k;
          render();
        })
        .catch((e) => toast(cleanError(e)));
      return h('div', { class: 'page' }, pageHead('Einstellungen', null), h('p', { class: 'muted' }, 'Lädt …'));
    }
    const cfg = state.config;
    return h(
      'div',
      { class: 'page' },
      pageHead('Einstellungen', 'Keys werden verschlüsselt gespeichert und nie angezeigt, nur ihre letzten vier Zeichen.'),
      h('section', { class: 'first' }, h('h2', {}, 'Keys'), state.keys.map(keyRow)),
      h('section', {}, h('h2', {}, 'Kostenquellen'), costSourceToggles(cfg)),
      h('section', {}, h('h2', {}, 'Projekte und Adressen'), idsForm(cfg)),
      h('section', {}, h('h2', {}, 'Darstellung'), themeSwitch(cfg)),
      h('section', {}, h('h2', {}, 'Zugang'), accessBlock()),
    );
  }

  function keyRow(k) {
    const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: k.masked ? `gespeichert ${k.masked} – neuen Key einfügen zum Ersetzen` : 'Key einfügen', 'aria-label': `${k.label} einfügen` });
    const result = h('div', { class: 'result' }, state.keyResults[k.id] || '');
    const save = h(
      'button',
      {
        class: 'btn primary',
        type: 'button',
        onclick: async () => {
          if (!input.value.trim()) return;
          try {
            state.keys = await hq.keys.set(k.id, input.value);
            input.value = '';
            const r = await hq.keys.test(k.id);
            state.keyResults[k.id] = r.message;
            render();
            load({ quiet: true });
          } catch (e) {
            input.value = '';
            result.textContent = cleanError(e);
          }
        },
      },
      'Speichern',
    );
    const test = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        disabled: !k.masked,
        onclick: async () => {
          result.textContent = 'Teste …';
          const r = await hq.keys.test(k.id).catch((e) => ({ ok: false, message: cleanError(e) }));
          state.keyResults[k.id] = r.message;
          result.textContent = r.message;
          result.className = r.ok ? 'result' : 'result bad';
        },
      },
      'Verbindung testen',
    );
    const remove = h(
      'button',
      {
        class: 'btn danger',
        type: 'button',
        disabled: !k.masked,
        onclick: async () => {
          if (!window.confirm(`${k.label} löschen?`)) return;
          state.keys = await hq.keys.remove(k.id);
          delete state.keyResults[k.id];
          render();
          load({ quiet: true });
        },
      },
      'Löschen',
    );
    return h(
      'div',
      { class: 'key-row' },
      h('div', { class: 'head' }, h('strong', {}, k.label), h('span', { class: 'faint num' }, k.masked ? `gespeichert ${k.masked}` : 'nicht gesetzt')),
      h('div', { class: 'entry' }, input, save, test, remove),
      result,
      h('details', {}, h('summary', {}, 'So erstellst du diesen Key'), h('ol', {}, k.steps.map((st) => h('li', {}, linkify(st))))),
    );
  }

  function costSourceToggles(cfg) {
    const mk = (id, label) => {
      const input = h('input', {
        type: 'checkbox',
        checked: cfg.costSources[id],
        onchange: async (e) => {
          state.config = await hq.config.update({ costSources: { [id]: e.target.checked } });
          load({ quiet: true });
        },
      });
      return h('label', { class: 'check' }, input, label);
    };
    return h(
      'div',
      {},
      h('p', { class: 'muted' }, 'Ist eine Quelle eingeschaltet, aber nicht ladbar, gilt der Gewinn als unvollständig. Schalte sie aus, wenn du den Dienst nicht nutzt.'),
      mk('openai', 'OpenAI-Kosten (Costs API)'),
      mk('github', 'GitHub-Kosten (Actions, Billing-Report)'),
    );
  }

  function idsForm(cfg) {
    const fields = [
      ['supabaseRef', 'Supabase-Projekt (Ref)'],
      ['railwayProjectId', 'Railway-Projekt-ID'],
      ['healthUrl', 'Health-Check-Adresse'],
      ['githubOwner', 'GitHub-Konto'],
      ['githubRepo', 'GitHub-Repo für CI und Releases'],
      ['domain', 'Domain'],
    ];
    const inputs = Object.fromEntries(fields.map(([k]) => [k, h('input', { type: 'text', id: `cfg-${k}`, value: cfg[k] || '' })]));
    const err = h('div', { class: 'form-error', role: 'alert' });
    return h(
      'form',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          try {
            state.config = await hq.config.update(Object.fromEntries(fields.map(([k]) => [k, inputs[k].value])));
            toast('Gespeichert.');
            load({ quiet: true });
          } catch (e2) {
            err.textContent = cleanError(e2);
          }
        },
      },
      h('div', { class: 'grid-2' }, fields.map(([k, label]) => h('div', {}, h('label', { for: `cfg-${k}` }, label), inputs[k]))),
      err,
      h('button', { class: 'btn primary', type: 'submit' }, 'Speichern'),
    );
  }

  function themeSwitch(cfg) {
    const mk = (value, label) =>
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'radio',
          name: 'theme',
          value,
          checked: cfg.theme === value,
          onchange: async () => {
            state.config = await hq.config.update({ theme: value });
            document.documentElement.dataset.theme = value;
          },
        }),
        label,
      );
    return h('div', {}, mk('dark', 'Dunkel'), mk('light', 'Hell'));
  }

  function accessBlock() {
    const oldPw = h('input', { type: 'password', id: 'op', autocomplete: 'current-password' });
    const newPw = h('input', { type: 'password', id: 'np', autocomplete: 'new-password' });
    const err = h('div', { class: 'form-error', role: 'alert' });
    return h(
      'div',
      {},
      h(
        'form',
        {
          onsubmit: async (e) => {
            e.preventDefault();
            err.textContent = '';
            try {
              await hq.auth.changePassword(oldPw.value, newPw.value);
              oldPw.value = '';
              newPw.value = '';
              toast('Passwort geändert. Deine Keys bleiben erhalten.');
            } catch (e2) {
              err.textContent = cleanError(e2);
            }
          },
        },
        h('div', { class: 'grid-2' }, h('div', {}, h('label', { for: 'op' }, 'Bisheriges Passwort'), oldPw), h('div', {}, h('label', { for: 'np' }, 'Neues Passwort (mindestens 10 Zeichen)'), newPw)),
        err,
        h('button', { class: 'btn', type: 'submit' }, 'Passwort ändern'),
      ),
      h('p', { class: 'faint' }, 'Buddy HQ sperrt sich nach 15 Minuten ohne Eingabe und wenn du Windows sperrst.'),
    );
  }

  // ---------- Start ----------

  async function start() {
    await applyTheme();
    try {
      const st = await hq.auth.status();
      if (!st.setUp) showSetup();
      else showLogin(st.waitMs > 0 ? 'Zu viele Fehlversuche. Bitte kurz warten.' : '');
    } catch (e) {
      screen('error', h('div', { class: 'gate' }, h('div', { class: 'gate-inner' }, h('h1', {}, 'Buddy HQ'), h('p', {}, `Start fehlgeschlagen: ${cleanError(e)}`))));
    }
  }

  start();
})();
