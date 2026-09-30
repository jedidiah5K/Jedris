'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Hub, cleanName } = require('../hub');
const { createServer } = require('../index');
const WebSocket = require('ws');

function fakeTimers() {
  const pending = [];
  return {
    setTimeout: (fn) => { pending.push(fn); return pending.length; },
    clearTimeout: (id) => { pending[id - 1] = null; },
    flush: () => { const fns = pending.splice(0); fns.forEach(f => f && f()); },
  };
}
function makeClient(hub) {
  const inbox = [];
  const c = hub.connect(m => inbox.push(m));
  c.inbox = inbox;
  c.last = (t) => [...inbox].reverse().find(m => m.t === t);
  return c;
}

test('cleanName accepts sane names and falls back otherwise', () => {
  assert.equal(cleanName('  Job  '), 'Job');
  assert.equal(cleanName('<script>'), 'Player');
  assert.equal(cleanName('x'.repeat(40)), 'Player');
  assert.equal(cleanName(42), 'Player');
});

test('room code: create, join, rounds, match end, rematch', () => {
  const timers = fakeTimers();
  const hub = new Hub(timers);
  const a = makeClient(hub), b = makeClient(hub);
  hub.message(a, { t: 'hello', name: 'Alice' });
  hub.message(b, { t: 'hello', name: 'Bob' });
  hub.message(a, { t: 'create' });
  const code = a.last('room').code;
  assert.match(code, /^[A-Z2-9]{4}$/);

  hub.message(b, { t: 'join', code: code.toLowerCase() });
  assert.deepEqual(a.last('match').names, ['Alice', 'Bob']);
  assert.equal(a.last('match').you, 0);
  assert.equal(b.last('match').you, 1);
  assert.equal(a.last('round').round, 1);
  assert.equal(typeof b.last('round').seed, 'number');
  assert.equal(a.last('round').seed, b.last('round').seed, 'both players get the same pieces');
  assert.equal(hub.rooms.size, 0);

  // relays
  hub.message(a, { t: 'state', s: { l: 3 } });
  assert.deepEqual(b.last('opp').s, { l: 3 });
  hub.message(a, { t: 'attack', n: 4 });
  assert.equal(b.last('garbage').n, 4);
  hub.message(a, { t: 'attack', n: 999 });
  assert.equal(b.inbox.filter(m => m.t === 'garbage').length, 1, 'absurd attacks are dropped');

  // round 1: Bob tops out
  hub.message(b, { t: 'dead', round: 1 });
  assert.deepEqual(a.last('roundEnd').wins, [1, 0]);
  hub.message(a, { t: 'attack', n: 2 });
  assert.equal(b.inbox.filter(m => m.t === 'garbage').length, 1, 'no attacks between rounds');
  hub.message(a, { t: 'dead', round: 1 });
  assert.deepEqual(b.last('roundEnd').wins, [1, 0], 'second death in the same round is ignored');
  timers.flush();
  assert.equal(a.last('round').round, 2);

  // stale death from round 1 ignored
  hub.message(b, { t: 'dead', round: 1 });
  assert.equal(a.last('roundEnd').round, 1);

  // round 2: Bob tops out again -> Alice wins the match
  hub.message(b, { t: 'dead', round: 2 });
  assert.equal(a.last('matchEnd').winner, 0);
  assert.deepEqual(b.last('matchEnd').wins, [2, 0]);

  // rematch needs both players
  hub.message(b, { t: 'rematch' });
  assert.ok(a.last('rematchAsk'));
  const matchesBefore = a.inbox.filter(m => m.t === 'match').length;
  hub.message(a, { t: 'rematch' });
  assert.equal(a.inbox.filter(m => m.t === 'match').length, matchesBefore + 1);
  assert.equal(a.last('round').round, 1);
  assert.deepEqual(a.last('round').wins, [0, 0]);
});

test('joining an unknown room reports an error', () => {
  const hub = new Hub(fakeTimers());
  const a = makeClient(hub);
  hub.message(a, { t: 'join', code: 'ZZZZ' });
  assert.match(a.last('error').message, /doesn't exist/);
});

test('quick match pairs the first two players', () => {
  const hub = new Hub(fakeTimers());
  const a = makeClient(hub), b = makeClient(hub), c = makeClient(hub);
  hub.message(a, { t: 'quick' });
  assert.ok(a.last('queued'));
  hub.message(a, { t: 'cancel' });
  hub.message(b, { t: 'quick' });
  hub.message(c, { t: 'quick' });
  assert.ok(b.last('match') && c.last('match'));
  assert.equal(a.last('match'), undefined, 'cancelled player is not matched');
});

test('leaving or disconnecting mid-match notifies the opponent', () => {
  const timers = fakeTimers();
  const hub = new Hub(timers);
  const a = makeClient(hub), b = makeClient(hub);
  hub.message(a, { t: 'quick' });
  hub.message(b, { t: 'quick' });
  hub.message(a, { t: 'dead', round: 1 });
  hub.disconnect(a);
  assert.ok(b.last('opponentLeft'));
  timers.flush(); // pending next round must not start
  assert.equal(b.inbox.filter(m => m.t === 'round').length, 1);
  assert.equal(b.match, null);
});

test('quitting an unfinished match counts as a loss for the quitter', () => {
  const recorded = [];
  const hub = new Hub({ ...fakeTimers(), auth: { recordMatch: (w, l) => recorded.push([w, l]) } });
  const a = makeClient(hub), b = makeClient(hub);
  a.userId = 'u-a'; b.userId = 'u-b';
  hub.message(a, { t: 'quick' });
  hub.message(b, { t: 'quick' });
  hub.message(b, { t: 'leave' });
  assert.deepEqual(recorded, [['u-a', 'u-b']]);
  assert.equal(a.last('opponentLeft').forfeit, true);
});

test('leaving after a match is over records nothing extra', () => {
  const recorded = [];
  const timers = fakeTimers();
  const hub = new Hub({ ...timers, auth: { recordMatch: (w, l) => recorded.push([w, l]) } });
  const a = makeClient(hub), b = makeClient(hub);
  a.userId = 'u-a'; b.userId = 'u-b';
  hub.message(a, { t: 'quick' });
  hub.message(b, { t: 'quick' });
  hub.message(a, { t: 'dead', round: 1 });
  timers.flush();
  hub.message(a, { t: 'dead', round: 2 });
  hub.message(a, { t: 'leave' });
  assert.deepEqual(recorded, [['u-b', 'u-a']]);
});

test('websocket server: health endpoint, static files and a relayed match', async () => {
  const { server } = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.ok, true);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.match(await page.text(), /JEDRIS/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/server/index.js`)).status, 404, 'server code is not served');
    assert.equal((await fetch(`http://127.0.0.1:${port}/package.json`)).status, 404);

    const open = () => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.inbox = [];
      ws.waiters = [];
      ws.on('message', d => {
        const m = JSON.parse(d);
        ws.inbox.push(m);
        ws.waiters = ws.waiters.filter(w => (w.t === m.t ? (w.resolve(m), false) : true));
      });
      ws.next = (t) => new Promise(res => {
        const found = ws.inbox.find(m => m.t === t && !m.seen);
        if (found) { found.seen = true; res(found); } else ws.waiters.push({ t, resolve: res });
      });
      ws.put = (o) => ws.send(JSON.stringify(o));
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
    const a = await open(), b = await open();
    a.put({ t: 'hello', name: 'A' });
    b.put({ t: 'hello', name: 'B' });
    a.put({ t: 'create' });
    const { code } = await a.next('room');
    b.put({ t: 'join', code });
    const round = await b.next('round');
    assert.equal(round.round, 1);
    a.put({ t: 'attack', n: 3 });
    assert.equal((await b.next('garbage')).n, 3);
    b.put({ t: 'dead', round: 1 });
    const end = await a.next('roundEnd');
    assert.deepEqual(end.wins, [1, 0]);
    a.close(); b.close();
  } finally {
    await new Promise(r => server.close(r));
  }
});
