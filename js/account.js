'use strict';

/* =========================================================================
 * ACCOUNTS (client side)
 * Sign in with a DCISM ID and your own password, or play as a guest.
 * Accounts only exist when the game is served by the Jedris server; opened
 * straight from disk, everyone plays as a guest.
 * ========================================================================= */
const ACCOUNT_KEY = 'jedris.account.v1';
const GUEST_KEY = 'jedris.guest.v1';

const Account = {
  token: null,
  user: null,
  available: location.protocol === 'http:' || location.protocol === 'https:',
  view: 'signin',

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null');
      if (saved && typeof saved.token === 'string') { this.token = saved.token; this.user = saved.user || null; }
    } catch (e) {}
  },
  persist() {
    try {
      if (this.token) localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ token: this.token, user: this.user }));
      else localStorage.removeItem(ACCOUNT_KEY);
    } catch (e) {}
  },
  signedIn() { return !!(this.token && this.user); },
  guestChosen() { try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { return false; } },
  setGuestChosen(v) { try { v ? localStorage.setItem(GUEST_KEY, '1') : localStorage.removeItem(GUEST_KEY); } catch (e) {} },

  /** JSON request to the server's /api (relative to the page, so sub-paths work). */
  async api(method, url, body) {
    const headers = { 'content-type': 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let res;
    try {
      res = await fetch(`api/${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      return { status: 0, body: { error: "Can't reach the Jedris server. Check your connection and try again." } };
    }
    let data = {};
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, body: data };
  },

  signInWith({ token, user }) {
    this.token = token;
    this.user = user;
    this.persist();
    this.setGuestChosen(false);
    this.syncRecords();
    this.syncSettings();
    updateAccountChip();
    Online.reidentify();
  },

  async signOut() {
    await this.api('POST', 'auth/logout');
    this.token = null;
    this.user = null;
    this.persist();
    updateAccountChip();
    Online.reidentify();
  },

  /** On load: confirm the saved session, or greet first-time visitors. */
  async init() {
    if (!this.available) return;
    this.load();
    updateAccountChip();
    if (this.token) {
      const r = await this.api('GET', 'auth/me');
      if (r.status === 200) { this.user = r.body.user; this.persist(); this.syncRecords(); this.syncSettings(); }
      else if (r.status === 401) { this.token = null; this.user = null; this.persist(); }
      updateAccountChip();
    }
    if (!this.signedIn() && !this.guestChosen() && App.state === 'menu') {
      // Only greet when the server answers; a static copy stays guest-only.
      const health = await this.api('GET', 'health');
      if (health.status === 200 && App.state === 'menu') openWelcome();
    }
  },

  /** Merge personal bests: upload local ones, keep the better of each. */
  async syncRecords() {
    if (!this.signedIn()) return;
    const local = loadRecords();
    let server = this.user.records || {};
    for (const mode of ['sprint', 'blitz']) {
      if (local[mode] && local[mode] !== server[mode]) {
        const r = await this.api('POST', 'records', { mode, value: local[mode] });
        if (r.status === 200) server = r.body.records;
      }
    }
    this.user.records = server;
    this.persist();
    const merged = { ...local };
    if (server.sprint && (!merged.sprint || server.sprint < merged.sprint)) merged.sprint = server.sprint;
    if (server.blitz && (!merged.blitz || server.blitz > merged.blitz)) merged.blitz = server.blitz;
    saveRecords(merged);
    if (App.state === 'menu') updateRecords();
  },

  /**
   * Controls and handling follow the account: signing in loads the saved copy
   * (or uploads this browser's copy the first time), and every change is saved back.
   */
  syncSettings() {
    if (!this.signedIn()) return;
    if (this.user.settings) {
      applySettings(this.user.settings);
      saveSettings(true);
      if (App.state === 'settings') buildSettings();
    } else {
      this.pushSettings();
    }
  },
  pushSettings() {
    if (!this.signedIn()) return;
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => {
      const copy = { ...settings, v: SETTINGS_VERSION };
      this.api('PUT', 'settings', { settings: copy }).then(r => {
        if (r.status === 200 && this.user) { this.user.settings = copy; this.persist(); }
      });
    }, 400);
  },

  submitRecord(mode, value) {
    if (!this.signedIn()) return;
    this.api('POST', 'records', { mode, value }).then(r => {
      if (r.status === 200 && this.user) { this.user.records = r.body.records; this.persist(); }
    });
  },
};

onSettingsSaved = () => Account.pushSettings();

/* ---------- screens ---------- */
function updateAccountChip() {
  const chip = $('btn-account');
  chip.classList.toggle('hidden', !Account.available);
  chip.classList.toggle('guest', !Account.signedIn());
  chip.textContent = Account.signedIn() ? `◆ ${Account.user.username}` : 'GUEST · SIGN IN';
}

function openWelcome() {
  App.state = 'welcome';
  showScreen('welcome');
}

function openAccount(view) {
  Sound.unlock();
  App.state = 'account';
  showAccountView(view || (Account.signedIn() ? 'profile' : 'signin'));
  showScreen('account');
  if (Account.signedIn()) {
    // Refresh wins and records, which change on the server after online matches.
    Account.api('GET', 'auth/me').then(r => {
      if (r.status !== 200) return;
      Account.user = r.body.user;
      Account.persist();
      if (App.state === 'account' && Account.view === 'profile') renderProfileStats(Account.user);
    });
  }
}

function renderProfileStats(u) {
  const rec = u.records || {};
  $('prof-records').innerHTML =
    `<div class="stat-card"><div class="k">40 LINES BEST</div><div class="v">${rec.sprint ? fmtTime(rec.sprint) : '—'}</div></div>` +
    `<div class="stat-card"><div class="k">BLITZ BEST</div><div class="v">${rec.blitz ? rec.blitz.toLocaleString() : '—'}</div></div>` +
    `<div class="stat-card"><div class="k">ONLINE WINS</div><div class="v">${u.wins || 0}</div></div>` +
    `<div class="stat-card"><div class="k">ONLINE LOSSES</div><div class="v">${u.losses || 0}</div></div>`;
}

function showAccountView(view) {
  Account.view = view;
  $('form-signin').classList.toggle('hidden', view !== 'signin');
  $('form-signup').classList.toggle('hidden', view !== 'signup');
  $('view-profile').classList.toggle('hidden', view !== 'profile');
  $('btn-account-guest').classList.toggle('hidden', view === 'profile');
  $('btn-account-back').textContent = 'Back';
  for (const el of document.querySelectorAll('#account .form-error')) el.textContent = '';
  if (view === 'profile') {
    const u = Account.user;
    $('prof-name').textContent = u.username;
    $('prof-id').textContent = `SIGNED IN AS ${u.dcismId.toUpperCase()}`;
    renderProfileStats(u);
    $('form-password').reset();
  } else {
    const first = view === 'signin' ? $('in-login') : $('in-dcism');
    setTimeout(() => first.focus(), 0);
  }
}

/* ---------- leaderboard ---------- */
async function openLeaderboard() {
  Sound.unlock();
  App.state = 'leaderboard';
  const body = $('lb-body');
  body.innerHTML = '<div class="lb-empty">Loading…</div>';
  showScreen('leaderboard');
  const r = Account.available ? await Account.api('GET', 'leaderboard') : { status: 0 };
  if (App.state !== 'leaderboard') return;
  if (r.status !== 200) {
    body.innerHTML = `<div class="lb-empty">The leaderboard needs the Jedris server. ${Account.available ? 'Check your connection and try again.' : ''}</div>`;
    return;
  }
  const players = r.body.players || [];
  if (!players.length) {
    body.innerHTML = '<div class="lb-empty">No wins yet. Sign in and win an online match to take first place.</div>';
    return;
  }
  const me = Account.signedIn() ? Account.user.username : null;
  const table = document.createElement('table');
  table.className = 'lb';
  table.innerHTML = '<thead><tr><th>#</th><th>PLAYER</th><th>WINS</th><th>LOSSES</th></tr></thead>';
  const tbody = document.createElement('tbody');
  players.forEach((p, i) => {
    const tr = document.createElement('tr');
    if (p.username === me) tr.className = 'me';
    for (const v of [i + 1, p.username, p.wins, p.losses]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.innerHTML = '';
  body.appendChild(table);
}

/** Wires a form to an API call; shows the server's error next to the form. */
function accountForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const errEl = form.querySelector('.form-error');
    const data = Object.fromEntries(new FormData(form));
    errEl.textContent = '';
    btn.disabled = true;
    try {
      const err = await handler(data);
      if (err) {
        errEl.textContent = err.error || err;
        const field = err.field && form.querySelector(`[name="${err.field}"]`);
        if (field) field.focus();
      }
    } finally {
      btn.disabled = false;
    }
  });
}

accountForm($('form-signin'), async ({ login, password }) => {
  if (!login.trim() || !password) return 'Enter your DCISM ID and password.';
  const r = await Account.api('POST', 'auth/login', { login: login.trim(), password });
  if (r.status !== 200) return r.body;
  Account.signInWith(r.body);
  $('form-signin').reset();
  App.toMenu();
});

accountForm($('form-signup'), async ({ dcismId, username, password, confirm }) => {
  if (password !== confirm) return { error: "The passwords don't match.", field: 'confirm' };
  const r = await Account.api('POST', 'auth/signup', { dcismId: dcismId.trim(), username: username.trim(), password });
  if (r.status !== 200) return r.body;
  Account.signInWith(r.body);
  $('form-signup').reset();
  App.toMenu();
});

accountForm($('form-password'), async ({ current, password }) => {
  const r = await Account.api('POST', 'auth/password', { current, password });
  if (r.status !== 200) return r.body;
  Account.signInWith(r.body);
  $('form-password').reset();
  $('form-password').querySelector('.form-error').textContent = '';
  $('form-password').closest('details').open = false;
});

document.querySelectorAll('#account [data-view]').forEach(b =>
  b.addEventListener('click', () => showAccountView(b.dataset.view)));
$('btn-account').addEventListener('click', () => openAccount());
$('btn-leaderboard').addEventListener('click', openLeaderboard);
$('btn-lb-back').addEventListener('click', () => App.toMenu());
$('btn-signout').addEventListener('click', async () => { await Account.signOut(); showAccountView('signin'); });
$('btn-account-back').addEventListener('click', () => App.toMenu());
const playAsGuest = () => { Account.setGuestChosen(true); App.toMenu(); };
$('btn-account-guest').addEventListener('click', playAsGuest);
$('btn-welcome-guest').addEventListener('click', playAsGuest);
$('btn-welcome-signin').addEventListener('click', () => openAccount('signin'));
$('btn-welcome-signup').addEventListener('click', () => openAccount('signup'));
