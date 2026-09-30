'use strict';

/* =========================================================================
 * UI / APP (menus, settings, match flow, main loop)
 * ========================================================================= */
const MODE_NAMES = { sprint: '40 Lines', blitz: 'Blitz', zen: 'Zen', versus: 'Local Versus', online: 'Online Versus', cpu: 'VS CPU' };
const MODE_SUBS = { sprint: 'CLEAR 40 LINES', blitz: '2 MINUTE SCORE ATTACK', zen: 'ENDLESS', versus: '' };
const MODE_ACCENTS = { sprint: '#38e8ff', blitz: '#ff9a3c', zen: '#4dff9a', versus: '#ff4fd8' };
const $ = (id) => document.getElementById(id);
const screens = ['menu', 'welcome', 'account', 'install', 'leaderboard', 'settings', 'help', 'online', 'pause', 'results'];
function showScreen(id) { for (const s of screens) $(s).classList.toggle('hidden', s !== id); }

const App = {
  state: 'menu', // menu | playing | ending | results
  mode: null,
  games: [],
  wins: [0, 0],
  round: 0,
  paused: false,
  endTimer: 0,

  inGame() { return this.state === 'playing' || this.state === 'ending'; },
  /** Two boards on this device, decided round by round (Local Versus and VS CPU). */
  isLocalMatch() { return this.mode === 'versus' || this.mode === 'cpu'; },

  start(mode, cpuLevel) {
    Sound.unlock();
    this.mode = mode;
    if (cpuLevel) this.cpuLevel = cpuLevel;
    this.wins = [0, 0];
    this.round = 0;
    this.newRound();
  },

  newRound() {
    this.round++;
    this.paused = false;
    this.endTimer = 0;
    hideBanner();
    showScreen(null);
    if (this.mode === 'versus') {
      const seed = randomSeed(); // both players get the same pieces
      const a = new Game({ mode: 'versus', seed, name: 'P1' });
      const b = new Game({ mode: 'versus', seed, name: 'P2', sound: false });
      a.sendGarbage = (n) => b.receiveGarbage(n);
      b.sendGarbage = (n) => a.receiveGarbage(n);
      this.games = [a, b];
      Input.bind([{ game: a, keys: settings.keys.p1 }, { game: b, keys: settings.keys.p2 }]);
    } else if (this.mode === 'cpu') {
      const seed = randomSeed(); // same pieces for you and the bot
      const a = new Game({ mode: 'versus', seed, name: 'YOU' });
      const b = new Game({ mode: 'versus', seed, name: 'CPU', sound: false });
      a.sendGarbage = (n) => b.receiveGarbage(n);
      b.sendGarbage = (n) => a.receiveGarbage(n);
      this.games = [a, b];
      this.cpu = new CpuPlayer(b, this.cpuLevel || CPU_LEVELS[1]);
      Input.bind([{ game: a, keys: settings.keys.p1 }]);
    } else {
      const g = new Game({ mode: this.mode, seed: randomSeed() });
      this.games = [g];
      Input.bind([{ game: g, keys: settings.keys.p1 }]);
    }
    this.state = 'playing';
  },

  tick() {
    if (this.mode === 'online') {
      if (!this.inGame()) return;
      for (const g of this.games) g.tick();
      Online.tick();
      return;
    }
    if (!this.inGame() || this.paused) return;
    if (this.mode === 'cpu' && this.cpu && this.state === 'playing') this.cpu.update(TICK_MS);
    for (const g of this.games) g.tick();
    if (this.state === 'playing') {
      if (this.isLocalMatch()) {
        const over = this.games.map(g => g.phase === 'over');
        if (over[0] || over[1]) {
          for (const g of this.games) if (g.phase === 'playing') g.phase = 'done';
          let msg;
          if (over[0] && over[1]) msg = 'DRAW';
          else {
            const w = over[0] ? 1 : 0;
            this.wins[w]++;
            this.lastWinner = w;
            msg = this.mode === 'cpu' ? (w === 0 ? 'YOU WIN THE ROUND' : 'CPU WINS THE ROUND') : `PLAYER ${w + 1} WINS THE ROUND`;
          }
          const decided = Math.max(...this.wins) >= VERSUS_WINS;
          showBanner(msg, decided ? '' : `Score ${this.wins[0]} – ${this.wins[1]}`);
          this.state = 'ending';
          this.endTimer = 2200;
        }
      } else {
        const g = this.games[0];
        if (g.phase === 'over' || g.phase === 'done') { this.state = 'ending'; this.endTimer = 1300; }
      }
    } else if (this.state === 'ending') {
      this.endTimer -= TICK_MS;
      if (this.endTimer <= 0) {
        if (this.isLocalMatch() && Math.max(...this.wins) < VERSUS_WINS) this.newRound();
        else this.showResults();
      }
    }
  },

  setPaused(p) {
    this.paused = p;
    Input.releaseAll();
    const online = this.mode === 'online';
    $('pause-title').textContent = online ? 'Match Menu' : 'Paused';
    $('btn-restart').classList.toggle('hidden', online);
    $('btn-quit').textContent = online ? 'Forfeit & Leave' : 'Main Menu';
    showScreen(p ? 'pause' : null);
  },

  /* ---------- online versus (rounds are decided by the server) ---------- */
  startOnlineRound(seed) {
    const m = Online.match;
    this.mode = 'online';
    this.round = m.round;
    this.wins = Online.toLocalOrder(m.wins);
    this.paused = false;
    clearTimeout(this.onlineTimer);
    hideBanner();
    showScreen(null);
    const me = new Game({ mode: 'versus', seed, name: 'YOU' });
    me.net = { fx: [], popups: [] };
    me.sendGarbage = (n) => Online.send({ t: 'attack', n });
    const opp = new RemoteGame();
    this.games = [me, opp];
    Input.bind([{ game: me, keys: settings.keys.p1 }]);
    this.state = 'playing';
  },

  onlineRoundEnd(won) {
    const [me, opp] = this.games;
    this.wins = Online.match.wins.slice();
    if (me && me.phase !== 'over') { me.phase = 'done'; me.piece = null; }
    if (opp && won) opp.phase = 'over';
    this.state = 'ending';
    const decided = Math.max(...this.wins) >= VERSUS_WINS;
    Sound.play(won ? 'win' : 'topout');
    showBanner(won ? 'YOU WIN THE ROUND' : 'ROUND LOST', decided ? '' : `${this.wins[0]} – ${this.wins[1]}`);
  },

  onlineMatchEnd() {
    clearTimeout(this.onlineTimer);
    this.onlineTimer = setTimeout(() => { if (this.mode === 'online' && this.state !== 'menu') this.showResults(); }, 2200);
  },

  onlineOpponentLeft(connectionLost, forfeit) {
    clearTimeout(this.onlineTimer);
    this.onlineNotice = connectionLost ? 'CONNECTION TO THE SERVER WAS LOST'
      : forfeit ? 'YOUR OPPONENT LEFT · YOU WIN BY FORFEIT' : 'YOUR OPPONENT LEFT THE MATCH';
    if (this.state === 'menu' || this.state === 'online-lobby') return;
    this.showResults();
  },

  onEscape() {
    if (Input.capture) return;
    if (Touch.editing) { Touch.closeEditor(); return; }
    if (this.inGame()) this.setPaused(!this.paused);
    else if (this.state !== 'menu') this.toMenu();
    else if (this.menuView && this.menuView !== 'main') showMenuView(MENU_PARENT[this.menuView] || 'main');
  },

  /** Global shortcuts outside the per-player bindings. Returns true when handled. */
  onHotkey(code) {
    const soloMode = this.mode && !this.isLocalMatch();
    if (code === settings.keys.retry && soloMode && (this.inGame() || this.state === 'results')) {
      this.start(this.mode);
      return true;
    }
    if (code === 'Enter' && this.state === 'results') {
      $('btn-again').click();
      return true;
    }
    return false;
  },

  toMenu() {
    if (this.mode === 'online') Online.leave();
    clearTimeout(this.onlineTimer);
    this.mode = null;
    this.state = 'menu';
    this.games = [];
    this.cpu = null;
    this.paused = false;
    Input.bind([]);
    hideBanner();
    updateRecords();
    showScreen('menu');
    showMenuView(this.menuView || 'main');
  },

  showResults() {
    this.state = 'results';
    hideBanner();
    const tbl = $('res-table');
    tbl.innerHTML = '';
    let sub = '';
    if (this.mode === 'online') {
      const left = this.onlineNotice;
      this.onlineNotice = null;
      $('res-title').textContent = 'ONLINE MATCH';
      $('res-big').textContent = left ? (left.startsWith('YOUR') ? 'VICTORY' : 'DISCONNECTED') : (this.wins[0] > this.wins[1] ? 'VICTORY' : 'DEFEAT');
      sub = left || `${this.wins[0]} – ${this.wins[1]} VS ${Online.opponentName().toUpperCase()}`;
      if (!left && this.wins[0] > this.wins[1]) Sound.play('win');
      const [a, b] = this.games;
      if (a && b) {
        const rb = statRows(b);
        tbl.innerHTML = statRows(a).map((r, i) =>
          `<div class="stat-card"><div class="k">${r[0].toUpperCase()}</div><div class="v v2"><span>${r[1]}</span><span>${rb[i][1]}</span></div></div>`).join('');
      }
      $('btn-again').disabled = !!left;
    } else if (this.isLocalMatch()) {
      const w = this.wins[0] > this.wins[1] ? 0 : 1;
      if (this.mode === 'cpu') {
        const lvl = this.cpuLevel || CPU_LEVELS[1];
        $('res-title').textContent = `VS CPU · ${lvl.name}`;
        $('res-big').textContent = w === 0 ? 'VICTORY' : 'DEFEAT';
        sub = `Rounds ${this.wins[0]} – ${this.wins[1]} · final round stats`;
        if (w === 0) {
          Sound.play('win');
          const rec = loadRecords();
          const idx = CPU_LEVELS.indexOf(lvl);
          if (!(rec.cpu >= idx)) { rec.cpu = idx; saveRecords(rec); sub = `YOU BEAT ${lvl.name} · NEW BEST`; }
        }
      } else {
        $('res-title').textContent = 'MATCH OVER';
        $('res-big').textContent = `PLAYER ${w + 1} WINS`;
        sub = `Rounds ${this.wins[0]} – ${this.wins[1]} · final round stats`;
        Sound.play('win');
      }
      const [a, b] = this.games;
      const rb = statRows(b);
      tbl.innerHTML = statRows(a).map((r, i) =>
        `<div class="stat-card"><div class="k">${r[0].toUpperCase()}</div><div class="v v2"><span>${r[1]}</span><span>${rb[i][1]}</span></div></div>`).join('');
    } else {
      const g = this.games[0];
      const rec = loadRecords();
      $('res-title').textContent = MODE_NAMES[this.mode].toUpperCase();
      if (this.mode === 'sprint') {
        if (g.phase === 'done') {
          Account.submitRecord('sprint', g.time);
          $('res-big').textContent = fmtTime(g.time);
          if (!rec.sprint || g.time < rec.sprint) { rec.sprint = g.time; sub = 'NEW PERSONAL BEST'; }
          else sub = `Best ${fmtTime(rec.sprint)}`;
        } else { $('res-big').textContent = 'TOPPED OUT'; sub = `${g.lines} / ${SPRINT_LINES} lines`; }
      } else if (this.mode === 'blitz') {
        $('res-big').textContent = g.score.toLocaleString();
        if (g.score > 0) Account.submitRecord('blitz', g.score);
        if (!rec.blitz || g.score > rec.blitz) { rec.blitz = g.score; sub = 'NEW PERSONAL BEST'; }
        else sub = `Best ${rec.blitz.toLocaleString()}`;
      } else {
        $('res-big').textContent = `${g.lines} lines`;
      }
      saveRecords(rec);
      tbl.innerHTML = statRows(g).map(r =>
        `<div class="stat-card"><div class="k">${r[0].toUpperCase()}</div><div class="v">${r[1]}</div></div>`).join('');
    }
    $('res-sub').textContent = sub;
    $('res-sub').classList.toggle('best', sub.startsWith('NEW') || sub.endsWith('NEW BEST'));
    if (this.mode !== 'online') $('btn-again').disabled = false;
    $('btn-again').textContent = this.isLocalMatch() || this.mode === 'online' ? 'Rematch' : 'Play Again';
    $('res-hint').innerHTML = this.isLocalMatch() || this.mode === 'online'
      ? '<kbd>ENTER</kbd> REMATCH · <kbd>ESC</kbd> MENU'
      : `<kbd>ENTER</kbd> or <kbd>${keyLabel(settings.keys.retry)}</kbd> RETRY · <kbd>ESC</kbd> MENU`;
    showScreen('results');
  },
};

function statRows(g) {
  return [
    ['Time', fmtTime(g.time)],
    ['Score', g.score.toLocaleString()],
    ['Lines', g.lines],
    ['Pieces', g.pieces],
    ['PPS', g.pps.toFixed(2)],
    ['APM', g.apm.toFixed(1)],
    ['Attack', g.attack],
    ['Max combo', g.maxCombo],
    ['Max B2B', Math.max(0, g.maxB2b)],
    ['Quads', g.stats.quads],
    ['Spins', g.stats.spins],
    ['Perfect clears', g.stats.pcs],
  ];
}

function showBanner(text, small) {
  const b = $('banner');
  b.innerHTML = '';
  b.append(text);
  if (small) { const el = document.createElement('small'); el.textContent = small; b.append(el); }
  b.classList.remove('hidden');
}
function hideBanner() { $('banner').classList.add('hidden'); }

function updateRecords() {
  const rec = loadRecords();
  $('rec-sprint').innerHTML = rec.sprint ? `<small>BEST</small>${fmtTime(rec.sprint)}` : '';
  $('rec-blitz').innerHTML = rec.blitz ? `<small>BEST</small>${rec.blitz.toLocaleString()}` : '';
  $('rec-cpu').innerHTML = rec.cpu >= 0 && CPU_LEVELS[rec.cpu] ? `<small>BEATEN</small>${CPU_LEVELS[rec.cpu].name}` : '';
  for (const b of document.querySelectorAll('#cpu-levels .tile')) {
    const i = Number(b.dataset.level);
    b.querySelector('.t-rec').innerHTML = rec.cpu >= i ? '<small>BEATEN</small>✓' : '';
  }
}

/* ---------- menu views (main, solo, vs cpu, multiplayer) ---------- */
const MENU_VIEWS = ['main', 'solo', 'cpu', 'multi'];
const MENU_PARENT = { solo: 'main', multi: 'main', cpu: 'solo' };
function showMenuView(view) {
  App.menuView = view;
  $('menu').dataset.view = view; // the CSS shrinks the logo and pins the app banner by view
  for (const v of MENU_VIEWS) $(`view-${v}`).classList.toggle('hidden', v !== view);
  const first = $(`view-${view}`).querySelector('.tile, button');
  if (first && document.activeElement && document.activeElement !== document.body && !$('menu').contains(document.activeElement)) first.focus();
}
function buildCpuLevels() {
  const box = $('cpu-levels');
  box.innerHTML = '';
  CPU_LEVELS.forEach((lvl, i) => {
    const b = document.createElement('button');
    b.className = 'tile';
    b.dataset.level = i;
    b.style.setProperty('--c', lvl.color);
    b.innerHTML = `<span><span class="t-name">${lvl.name}</span><span class="t-desc">${lvl.desc} · ${lvl.pps.toFixed(1)} pieces/sec</span></span><span class="t-rec"></span>`;
    b.addEventListener('click', () => App.start('cpu', lvl));
    box.appendChild(b);
  });
}

/* ---------- install as an app ---------- */
let installPrompt = null; // Chrome/Android's install dialog, when the browser offers one
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('btn-install-now').classList.remove('hidden');
});
const isInstalled = () => (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
function showInstallTab(which) {
  $('steps-ios').classList.toggle('hidden', which !== 'ios');
  $('steps-android').classList.toggle('hidden', which !== 'android');
  $('tab-ios').classList.toggle('on', which === 'ios');
  $('tab-android').classList.toggle('on', which === 'android');
  $('tab-ios').setAttribute('aria-selected', which === 'ios');
  $('tab-android').setAttribute('aria-selected', which === 'android');
}
function openInstall() {
  Sound.unlock();
  App.state = 'install';
  const ua = navigator.userAgent || '';
  showInstallTab(/android/i.test(ua) ? 'android' : 'ios');
  const url = /^https?:/.test(location.protocol) ? location.host : 'jedris.dcism.org';
  $('install-url-ios').textContent = url;
  $('install-url-android').textContent = url;
  $('install-done').hidden = !isInstalled();
  showScreen('install');
}
$('btn-install').addEventListener('click', openInstall);
$('btn-install-back').addEventListener('click', () => App.toMenu());
$('tab-ios').addEventListener('click', () => showInstallTab('ios'));
$('tab-android').addEventListener('click', () => showInstallTab('android'));
$('btn-install-now').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('btn-install-now').classList.add('hidden');
});
if (isInstalled()) $('app-dock').classList.add('hidden');

/* ---------- how to play ---------- */
function buildHelp() {
  const rows = ACTIONS.map(a =>
    `<tr><td>${ACTION_LABELS[a]}</td><td><kbd>${keyLabel(settings.keys.p1[a])}</kbd></td><td><kbd>${keyLabel(settings.keys.p2[a])}</kbd></td></tr>`).join('');
  $('help-keys').innerHTML = `<tr><th>ACTION</th><th>PLAYER 1 / SOLO</th><th>PLAYER 2</th></tr>${rows}` +
    `<tr><td>Quick retry (solo)</td><td><kbd>${keyLabel(settings.keys.retry)}</kbd></td><td></td></tr>` +
    '<tr><td>Pause</td><td><kbd>Esc</kbd></td><td><kbd>Esc</kbd></td></tr>';
}

/* ---------- settings screen ---------- */
function buildSettings() {
  const handling = $('handling');
  const visuals = $('visuals');
  handling.innerHTML = '';
  visuals.innerHTML = '';

  const numberRow = (parent, key, label, hint, min, max, step = 1) => {
    const row = document.createElement('div');
    row.className = 'setting';
    row.innerHTML = `<label>${label}<small>${hint}</small></label><div class="ctrl"></div>`;
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', min, max, step, value: settings[key] });
    input.addEventListener('change', () => {
      let v = Number(input.value);
      if (!Number.isFinite(v)) v = DEFAULT_SETTINGS[key];
      v = Math.max(min, Math.min(max, v));
      input.value = v;
      settings[key] = v;
      saveSettings();
    });
    row.querySelector('.ctrl').append(input);
    parent.append(row);
    return row;
  };
  const toggleRow = (parent, key, label, hint) => {
    const row = document.createElement('div');
    row.className = 'setting';
    row.innerHTML = `<label>${label}<small>${hint}</small></label><div class="ctrl"></div>`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!settings[key];
    input.addEventListener('change', () => { settings[key] = input.checked; saveSettings(); });
    row.querySelector('.ctrl').append(input);
    parent.append(row);
    return input;
  };

  numberRow(handling, 'das', 'DAS (ms)', 'Delay before a held direction auto-repeats', 0, 500);
  numberRow(handling, 'arr', 'ARR (ms)', 'Auto-repeat interval; 0 moves instantly to the wall', 0, 200);
  const sdfRow = numberRow(handling, 'sdf', 'Soft drop factor (×)', 'Multiplier on gravity while soft dropping', 1, 100);
  const inst = document.createElement('label');
  inst.className = 'inline-check';
  const instBox = document.createElement('input');
  instBox.type = 'checkbox';
  instBox.checked = settings.sdfInstant;
  instBox.addEventListener('change', () => { settings.sdfInstant = instBox.checked; saveSettings(); });
  inst.append('INSTANT', instBox);
  sdfRow.querySelector('.ctrl').prepend(inst);
  toggleRow(handling, 'dasCut', 'DAS cut on rotate', 'Rotating resets the DAS charge');

  toggleRow(visuals, 'ghost', 'Ghost piece', 'Show where the piece will land');
  toggleRow(visuals, 'flash', 'Line clear flash', 'Flash cleared rows');
  toggleRow(visuals, 'shake', 'Screen shake', 'Shake the board on big attacks and incoming garbage');
  toggleRow(visuals, 'sound', 'Sound effects', 'Synthesized with Web Audio');
  const volRow = document.createElement('div');
  volRow.className = 'setting';
  volRow.innerHTML = '<label>Volume<small>Sound effect volume</small></label><div class="ctrl"></div>';
  const vol = document.createElement('input');
  Object.assign(vol, { type: 'range', min: 0, max: 1, step: 0.05, value: settings.volume });
  vol.addEventListener('input', () => { settings.volume = Number(vol.value); saveSettings(); });
  vol.addEventListener('change', () => { Sound.unlock(); Sound.play('rotate'); });
  volRow.querySelector('.ctrl').append(vol);
  visuals.append(volRow);

  Touch.describe();
  buildBinds();
}

function buildBinds() {
  const tbl = $('binds');
  const all = [];
  for (const p of ['p1', 'p2']) for (const a of ACTIONS) all.push(settings.keys[p][a]);
  const count = (code) => all.filter(c => c === code).length;
  all.push(settings.keys.retry);
  tbl.innerHTML = '<tr><th>ACTION</th><th>PLAYER 1 / SOLO</th><th>PLAYER 2</th></tr>';
  const bindButton = (code, assign) => {
    const btn = document.createElement('button');
    btn.textContent = keyLabel(code);
    if (count(code) > 1) { btn.classList.add('conflict'); btn.title = 'This key is bound more than once'; }
    btn.addEventListener('click', () => {
      btn.textContent = 'Press a key…';
      btn.classList.add('listening');
      Input.capture = (newCode) => {
        if (newCode !== 'Escape') { assign(newCode); saveSettings(); }
        buildBinds();
      };
    });
    return btn;
  };
  for (const a of ACTIONS) {
    const tr = document.createElement('tr');
    const th = document.createElement('td');
    th.textContent = ACTION_LABELS[a];
    tr.append(th);
    for (const p of ['p1', 'p2']) {
      const td = document.createElement('td');
      td.append(bindButton(settings.keys[p][a], (c) => { settings.keys[p][a] = c; }));
      tr.append(td);
    }
    tbl.append(tr);
  }
  const tr = document.createElement('tr');
  const label = document.createElement('td');
  label.textContent = 'Quick retry (solo)';
  const td = document.createElement('td');
  td.append(bindButton(settings.keys.retry, (c) => { settings.keys.retry = c; }));
  tr.append(label, td, document.createElement('td'));
  tbl.append(tr);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

/* ---------- wiring ---------- */
buildCpuLevels();
$('btn-solo').addEventListener('click', () => { Sound.unlock(); showMenuView('solo'); });
$('btn-multi').addEventListener('click', () => { Sound.unlock(); showMenuView('multi'); });
$('btn-cpu').addEventListener('click', () => { Sound.unlock(); showMenuView('cpu'); });
document.querySelectorAll('#menu [data-back]').forEach(b =>
  b.addEventListener('click', () => showMenuView(b.dataset.back || 'main')));
document.querySelectorAll('[data-mode]').forEach(btn =>
  btn.addEventListener('click', () => App.start(btn.dataset.mode)));
$('btn-settings').addEventListener('click', () => {
  Sound.unlock();
  App.state = 'settings';
  $('settings-sub').textContent = Account.signedIn() ? `SAVED TO YOUR ACCOUNT (${Account.user.username.toUpperCase()})` : 'SAVED AUTOMATICALLY TO THIS BROWSER';
  buildSettings();
  showScreen('settings');
});
$('btn-settings-back').addEventListener('click', () => { Input.capture = null; App.toMenu(); });
$('btn-reset-settings').addEventListener('click', () => {
  Object.assign(settings, clone(DEFAULT_SETTINGS));
  saveSettings();
  buildSettings();
});
$('btn-reset-records').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'Click again to confirm';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Clear records'; }, 3000);
    return;
  }
  saveRecords({});
  btn.dataset.armed = '';
  btn.textContent = 'Records cleared';
  updateRecords();
});
$('btn-help').addEventListener('click', () => { Sound.unlock(); App.state = 'help'; buildHelp(); showScreen('help'); });
$('btn-help-back').addEventListener('click', () => App.toMenu());
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
document.querySelectorAll('.tile').forEach(t => t.addEventListener('mouseenter', () => Sound.play('move')));
$('version').textContent = `v${VERSION}`;
$('btn-resume').addEventListener('click', () => App.setPaused(false));
$('btn-restart').addEventListener('click', () => App.start(App.mode));
$('btn-quit').addEventListener('click', () => App.toMenu());
$('btn-again').addEventListener('click', () => {
  if ($('btn-again').disabled) return;
  if (App.mode === 'online') {
    Online.send({ t: 'rematch' });
    $('btn-again').textContent = 'Waiting for opponent…';
    $('btn-again').disabled = true;
    return;
  }
  App.start(App.mode);
});
$('btn-res-menu').addEventListener('click', () => App.toMenu());

