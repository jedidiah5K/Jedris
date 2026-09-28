'use strict';

/* =========================================================================
 * ONLINE VERSUS (client side)
 * Each player simulates their own board locally. The server relays board
 * snapshots (for drawing the opponent), attacks, and decides rounds.
 * ========================================================================= */
const NET_SNAPSHOT_TICKS = 2; // send our board 30 times a second
const PLAYER_KEY = 'jedris.player.v1';

/** Read-only mirror of the opponent's board, rebuilt from network snapshots. */
class RemoteGame extends Game {
  constructor() {
    super({ mode: 'versus', sound: false, seed: 1 });
    this.queue = [];
    this.remote = true;
    this.stale = 0;
  }
  apply(s) {
    if (typeof s.b === 'string' && s.b.length === ROWS * COLS) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = s.b[y * COLS + x];
          this.board[y][x] = c === '.' ? null : c;
        }
      }
    }
    this.piece = Array.isArray(s.p) && SHAPES[s.p[0]] ? { type: s.p[0], rot: s.p[1] & 3, x: s.p[2] | 0, y: s.p[3] | 0 } : null;
    this.holdPiece = SHAPES[s.h] ? s.h : null;
    this.canHold = !!s.ch;
    this.queue = typeof s.q === 'string' ? [...s.q].filter(t => SHAPES[t]) : [];
    this.time = Number(s.tm) || 0;
    this.incoming = Array.isArray(s.i) ? s.i.map(([lines, readyIn]) => ({ lines: lines | 0, readyAt: this.time + (Number(readyIn) || 0) })) : [];
    if (['countdown', 'playing', 'over', 'done'].includes(s.ph)) {
      if (s.ph === 'playing' && this.phase === 'countdown') this.goTimer = 700;
      this.phase = s.ph;
    }
    this.countdown = Number(s.cd) || 0;
    this.lines = s.l | 0;
    this.score = s.sc | 0;
    this.pieces = s.pc | 0;
    this.attack = s.at | 0;
    this.combo = Number.isFinite(s.co) ? s.co : -1;
    this.b2b = Number.isFinite(s.bb) ? s.bb : -1;
    this.lockTimer = Number(s.lt) || 0;
    if (Array.isArray(s.st)) {
      [this.maxCombo, this.maxB2b, this.stats.quads, this.stats.tspins, this.stats.pcs] = s.st.map(n => n | 0);
    }
    if (Array.isArray(s.fx)) for (const ev of s.fx.slice(0, 32)) if (ev && typeof ev.type === 'string') this.emit(ev);
    if (Array.isArray(s.pp)) for (const [text, color, big] of s.pp.slice(0, 8)) this.popup(String(text).slice(0, 24), String(color).slice(0, 9), !!big);
    this.stale = 0;
  }
  // The opponent's own client runs the simulation; we only animate effects.
  tick() {
    this.updateEffects();
    this.stale++;
    if (this.phase === 'countdown' && this.countdown > 0) this.countdown -= TICK_MS;
  }
  input() {}
}

function snapshot(g) {
  let b = '';
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) b += g.board[y][x] || '.';
  const s = {
    b,
    p: g.piece ? [g.piece.type, g.piece.rot, g.piece.x, g.piece.y] : null,
    h: g.holdPiece, ch: g.canHold ? 1 : 0,
    q: g.queue.slice(0, NEXT_COUNT).join(''),
    i: g.incoming.map(x => [x.lines, Math.max(0, Math.round(x.readyAt - g.time))]),
    tm: Math.round(g.time), ph: g.phase, cd: Math.round(g.countdown),
    l: g.lines, sc: g.score, pc: g.pieces, at: g.attack, co: g.combo, bb: g.b2b, lt: Math.round(g.lockTimer),
    st: [g.maxCombo, g.maxB2b, g.stats.quads, g.stats.tspins, g.stats.pcs],
  };
  if (g.net.fx.length) { s.fx = g.net.fx; g.net.fx = []; }
  if (g.net.popups.length) { s.pp = g.net.popups; g.net.popups = []; }
  return s;
}

function loadPlayer() {
  try {
    const p = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null');
    if (p && typeof p.name === 'string') return p;
  } catch (e) {}
  return { name: '' };
}
function savePlayer(p) {
  try { localStorage.setItem(PLAYER_KEY, JSON.stringify(p)); } catch (e) {}
}

const Online = {
  ws: null,
  status: 'offline', // offline | connecting | online | unavailable
  onlineCount: 0,
  player: loadPlayer(),
  lobby: 'idle',     // idle | room | queued
  code: null,
  match: null,       // { you, names, wins, round, sentDead, over, rematchSent }
  retryTimer: null,

  /** WebSocket URL next to the page (works under a sub-path too). */
  url() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    const dir = location.pathname.replace(/[^/]*$/, '');
    return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${dir}ws`;
  },

  connect() {
    const url = this.url();
    if (!url) { this.setStatus('unavailable'); return; }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus('connecting');
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.setStatus('offline'); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.setStatus('online');
      this.hello();
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('offline');
      if (this.match && !this.match.over) this.onMessage({ t: 'disconnected' });
      this.lobby = 'idle';
      updateLobby();
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => { if (App.state === 'online-lobby') this.connect(); }, 3000);
    };
  },

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  },

  setStatus(s) {
    this.status = s;
    updateOnlineStatus();
  },

  /** Tell the server who we are: an account (by session token) or a guest name. */
  hello() {
    this.send({ t: 'hello', name: this.player.name || 'Player', token: Account.signedIn() ? Account.token : undefined });
  },
  /** Called after signing in or out. */
  reidentify() {
    if (this.lobby === 'idle' && !this.match) this.hello();
    updateNameField();
  },

  setName(name) {
    this.player.name = name;
    savePlayer(this.player);
    this.hello();
  },

  onMessage(m) {
    switch (m.t) {
      case 'hello':
        this.myName = m.name;
        updateNameField();
        break;
      case 'welcome':
      case 'pong':
        this.onlineCount = m.online | 0;
        updateOnlineStatus();
        break;
      case 'room':
        this.lobby = 'room';
        this.code = m.code;
        updateLobby();
        break;
      case 'queued':
        this.lobby = 'queued';
        updateLobby();
        break;
      case 'error':
        this.lobby = 'idle';
        updateLobby(m.message);
        break;
      case 'match':
        this.lobby = 'idle';
        this.match = { you: m.you, names: m.names, wins: [0, 0], round: 0, sentDead: false, over: false, rematchSent: false };
        break;
      case 'round':
        if (!this.match) return;
        this.match.round = m.round;
        this.match.wins = m.wins;
        this.match.sentDead = false;
        App.startOnlineRound(m.seed);
        break;
      case 'opp':
        if (App.mode === 'online' && App.games[1] && m.s) App.games[1].apply(m.s);
        break;
      case 'garbage':
        if (App.mode === 'online' && App.games[0]) App.games[0].receiveGarbage(m.n | 0);
        break;
      case 'roundEnd':
        if (!this.match) return;
        this.match.wins = this.toLocalOrder(m.wins);
        App.onlineRoundEnd(this.match.you === m.winner);
        break;
      case 'matchEnd':
        if (!this.match) return;
        this.match.over = true;
        this.match.wins = this.toLocalOrder(m.wins);
        App.onlineMatchEnd(this.match.you === m.winner);
        break;
      case 'rematchAsk':
        $('res-sub').textContent = 'OPPONENT WANTS A REMATCH';
        break;
      case 'opponentLeft':
      case 'disconnected':
        if (!this.match) return;
        this.match.over = true;
        App.onlineOpponentLeft(m.t === 'disconnected');
        break;
    }
  },

  /** Server reports wins as [player0, player1]; we always draw ourselves on the left. */
  toLocalOrder(wins) {
    return this.match.you === 0 ? wins.slice() : [wins[1], wins[0]];
  },
  opponentName() {
    return this.match ? this.match.names[1 - this.match.you] : 'OPPONENT';
  },

  tick() {
    const m = this.match;
    const [me] = App.games;
    if (!m || !me) return;
    if (me.ticksAlive % NET_SNAPSHOT_TICKS === 0 || me.net.fx.length > 8) this.send({ t: 'state', s: snapshot(me) });
    if (me.phase === 'over' && !m.sentDead) {
      m.sentDead = true;
      this.send({ t: 'state', s: snapshot(me) });
      this.send({ t: 'dead', round: m.round });
    }
  },

  leave() {
    this.send({ t: 'leave' });
    this.match = null;
    this.lobby = 'idle';
  },
};

/* ---------- lobby UI ---------- */
function updateOnlineStatus() {
  const el = $('net-status');
  if (!el) return;
  const s = Online.status;
  el.dataset.state = s;
  el.textContent = s === 'online' ? `ONLINE · ${Online.onlineCount} CONNECTED`
    : s === 'connecting' ? 'CONNECTING…'
    : s === 'unavailable' ? 'OFFLINE COPY' : 'SERVER OFFLINE';
  const ready = s === 'online';
  for (const id of ['btn-quick', 'btn-create', 'btn-join']) $(id).disabled = !ready || Online.lobby !== 'idle';
  $('net-help').classList.toggle('hidden', s !== 'unavailable' && s !== 'offline');
  $('net-help').textContent = s === 'unavailable'
    ? 'Online play needs the Jedris server. Open the game from its website (or run "npm start" and visit http://localhost:51920) instead of the file on disk.'
    : 'Can\'t reach the Jedris server. Retrying…';
}

function updateLobby(error) {
  const wait = $('lobby-wait');
  const lobby = Online.lobby;
  wait.classList.toggle('hidden', lobby === 'idle');
  if (lobby === 'room') {
    $('lobby-wait-title').textContent = 'ROOM CODE';
    $('lobby-code').textContent = Online.code;
    $('lobby-code').classList.remove('hidden');
    $('lobby-wait-sub').textContent = 'Share this code with your opponent. Waiting for them to join…';
  } else if (lobby === 'queued') {
    $('lobby-wait-title').textContent = 'QUICK MATCH';
    $('lobby-code').classList.add('hidden');
    $('lobby-wait-sub').textContent = 'Searching for an opponent…';
  }
  $('lobby-error').textContent = error || '';
  updateOnlineStatus();
}

function updateNameField() {
  const input = $('net-name');
  const signedIn = Account.signedIn();
  input.disabled = signedIn;
  $('net-name-label').textContent = signedIn ? 'PLAYING AS' : 'GUEST NAME';
  if (signedIn) input.value = Account.user.username;
  else if (document.activeElement !== input) input.value = Online.player.name || '';
  const note = $('net-name-note');
  note.textContent = !signedIn && Account.available
    ? 'Sign in from the main menu to play under your account name.'
    : '';
  if (!signedIn && Online.myName === 'Guest' && Online.player.name && Online.player.name !== 'Guest') {
    note.textContent = 'That name belongs to an account, so you\'ll show up as Guest. Pick another or sign in.';
  }
}

function openOnlineLobby() {
  Sound.unlock();
  App.state = 'online-lobby';
  Online.lobby = 'idle';
  updateNameField();
  showScreen('online');
  updateLobby();
  Online.connect();
}

$('btn-online').addEventListener('click', openOnlineLobby);
$('net-name').addEventListener('change', (e) => {
  const v = e.target.value.trim().replace(/[^A-Za-z0-9 _.\-]/g, '').slice(0, 16);
  e.target.value = v;
  Online.setName(v);
});
$('btn-quick').addEventListener('click', () => { Online.send({ t: 'quick' }); });
$('btn-create').addEventListener('click', () => { Online.send({ t: 'create' }); });
$('btn-join').addEventListener('click', () => {
  const code = $('net-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) { updateLobby('Enter the 4-character room code.'); return; }
  Online.send({ t: 'join', code });
});
$('net-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-lobby-cancel').addEventListener('click', () => { Online.send({ t: 'cancel' }); Online.lobby = 'idle'; updateLobby(); });
$('btn-lobby-back').addEventListener('click', () => { Online.send({ t: 'cancel' }); App.toMenu(); });

// Keep the "connected" count fresh while the lobby is open.
setInterval(() => { if (App.state === 'online-lobby') Online.send({ t: 'ping' }); }, 5000);
