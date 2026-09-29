'use strict';

/* =========================================================================
 * MATCHMAKING HUB
 * Transport-agnostic room / quick-match / round logic for online versus.
 * Each client simulates its own board; the hub relays board snapshots and
 * attacks between the two players and decides rounds when someone tops out.
 * ========================================================================= */

const WINS_NEEDED = 2;          // best of 3
const ROUND_BREAK_MS = 3000;    // pause between rounds
const MAX_ATTACK = 40;
const NAME_RE = /^[A-Za-z0-9 _.\-]{1,16}$/;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function cleanName(name) {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  return NAME_RE.test(n) ? n : 'Player';
}

class Hub {
  /**
   * @param {object} [opts]
   *   setTimeout/clearTimeout: injectable timers (tests)
   *   random: () => [0,1)
   *   auth: { userForToken(token), isAccountName(name), recordMatch(winnerId, loserId) } for signed-in players
   */
  constructor(opts = {}) {
    this.setTimeout = opts.setTimeout || setTimeout;
    this.clearTimeout = opts.clearTimeout || clearTimeout;
    this.random = opts.random || Math.random;
    this.auth = opts.auth || null;
    this.clients = new Set();
    this.rooms = new Map();   // code -> room (waiting for a second player)
    this.queue = [];          // clients waiting for quick match
    this.nextId = 1;
  }

  /** Register a client. `send(obj)` delivers a message to it. */
  connect(send) {
    const client = { id: this.nextId++, name: 'Player', guest: true, userId: null, send, room: null, match: null, queued: false };
    this.clients.add(client);
    send({ t: 'welcome', id: client.id, online: this.clients.size });
    return client;
  }

  disconnect(client) {
    this.leave(client);
    this.clients.delete(client);
  }

  message(client, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'hello': this.hello(client, msg); break;
      case 'ping': client.send({ t: 'pong', c: msg.c, online: this.clients.size }); break;
      case 'create': this.create(client); break;
      case 'join': this.join(client, msg.code); break;
      case 'quick': this.quick(client); break;
      case 'cancel': this.leave(client); break;
      case 'leave': this.leave(client); break;
      case 'state': this.relayState(client, msg.s); break;
      case 'attack': this.attack(client, msg.n); break;
      case 'dead': this.dead(client, msg.round); break;
      case 'rematch': this.rematch(client); break;
    }
  }

  /** Signed-in players play under their account name; guests pick any name that isn't one. */
  hello(client, msg) {
    const user = this.auth && msg.token ? this.auth.userForToken(msg.token) : null;
    if (user) {
      client.name = user.username;
      client.guest = false;
      client.userId = user.id;
    } else {
      let name = cleanName(msg.name);
      if (this.auth && this.auth.isAccountName(name)) name = 'Guest';
      client.name = name;
      client.guest = true;
      client.userId = null;
    }
    client.send({ t: 'hello', name: client.name, guest: client.guest });
  }

  /* ---------- lobby ---------- */
  newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(this.random() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  create(client) {
    this.leave(client);
    const code = this.newCode();
    this.rooms.set(code, { code, host: client });
    client.room = code;
    client.send({ t: 'room', code });
  }

  join(client, rawCode) {
    const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
    const room = this.rooms.get(code);
    if (!room) { client.send({ t: 'error', message: `Room ${code || '?'} doesn't exist.` }); return; }
    if (room.host === client) return;
    this.leave(client);
    this.rooms.delete(code);
    room.host.room = null;
    this.startMatch(room.host, client, code);
  }

  quick(client) {
    this.leave(client);
    this.queue = this.queue.filter(c => this.clients.has(c) && c.queued);
    const other = this.queue.shift();
    if (other) {
      other.queued = false;
      this.startMatch(other, client, null);
    } else {
      client.queued = true;
      this.queue.push(client);
      client.send({ t: 'queued' });
    }
  }

  /** Leave whatever the client is doing (room, queue or match). */
  leave(client) {
    if (client.queued) {
      client.queued = false;
      this.queue = this.queue.filter(c => c !== client);
    }
    if (client.room) {
      this.rooms.delete(client.room);
      client.room = null;
    }
    const m = client.match;
    if (m) {
      client.match = null;
      if (m.timer) this.clearTimeout(m.timer);
      m.state = 'closed';
      const other = m.players.find(p => p !== client);
      if (other && other.match === m) {
        other.match = null;
        other.send({ t: 'opponentLeft', wins: m.wins.slice(), you: m.players.indexOf(other) });
      }
    }
  }

  /* ---------- match flow ---------- */
  startMatch(a, b, code) {
    const m = { players: [a, b], wins: [0, 0], round: 0, dead: [false, false], state: 'starting', rematch: [false, false], timer: null, code };
    a.match = m;
    b.match = m;
    m.players.forEach((p, i) => p.send({ t: 'match', you: i, names: [a.name, b.name], guests: [a.guest, b.guest], code }));
    this.startRound(m);
  }

  startRound(m) {
    if (m.state === 'closed') return;
    m.timer = null;
    m.round++;
    m.dead = [false, false];
    m.state = 'playing';
    const seed = Math.floor(this.random() * 4294967296) >>> 0; // same pieces for both players
    m.players.forEach((p, i) => p.send({ t: 'round', round: m.round, you: i, wins: m.wins.slice(), seed }));
  }

  relayState(client, s) {
    const m = client.match;
    if (!m || m.state === 'closed' || !s || typeof s !== 'object') return;
    const other = m.players.find(p => p !== client);
    other.send({ t: 'opp', s });
  }

  attack(client, n) {
    const m = client.match;
    if (!m || m.state !== 'playing') return;
    const lines = Math.floor(Number(n));
    if (!(lines >= 1 && lines <= MAX_ATTACK)) return;
    const other = m.players.find(p => p !== client);
    other.send({ t: 'garbage', n: lines });
  }

  dead(client, round) {
    const m = client.match;
    if (!m || m.state !== 'playing') return;
    if (round != null && round !== m.round) return; // stale message from a previous round
    const i = m.players.indexOf(client);
    m.dead[i] = true;
    const winner = 1 - i;
    m.wins[winner]++;
    m.state = 'between';
    const decided = m.wins[winner] >= WINS_NEEDED;
    for (const p of m.players) p.send({ t: 'roundEnd', round: m.round, winner, wins: m.wins.slice() });
    if (decided) {
      m.state = 'over';
      m.rematch = [false, false];
      if (this.auth && this.auth.recordMatch) this.auth.recordMatch(m.players[winner].userId, m.players[1 - winner].userId);
      for (const p of m.players) p.send({ t: 'matchEnd', winner, wins: m.wins.slice() });
    } else {
      m.timer = this.setTimeout(() => this.startRound(m), ROUND_BREAK_MS);
    }
  }

  rematch(client) {
    const m = client.match;
    if (!m || m.state !== 'over') return;
    const i = m.players.indexOf(client);
    m.rematch[i] = true;
    const other = m.players[1 - i];
    if (m.rematch[0] && m.rematch[1]) {
      m.players.forEach(p => { p.match = null; });
      this.startMatch(m.players[0], m.players[1], m.code);
    } else {
      other.send({ t: 'rematchAsk' });
    }
  }
}

module.exports = { Hub, WINS_NEEDED, ROUND_BREAK_MS, cleanName };
