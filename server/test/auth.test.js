'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../index');
const { Store } = require('../store');
const { Hub } = require('../hub');
const { resetPassword } = require('../auth');

async function withServer(fn, opts = { dataFile: null }) {
  const s = createServer(opts);
  await new Promise(r => s.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.server.address().port}/api`;
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  try { await fn(call, s); } finally { await new Promise(r => s.server.close(r)); }
}

const JOB = { dcismId: 's23105047', username: 'Job', password: 'hunter22!' };

test('sign up with a DCISM ID, then sign in with ID or display name', () => withServer(async (call) => {
  const up = await call('POST', '/auth/signup', { ...JOB, dcismId: 'S23105047' });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.body.user.dcismId, 's23105047');
  assert.strictEqual(up.body.user.username, 'Job');
  assert.ok(!('passHash' in up.body.user));

  const me = await call('GET', '/auth/me', null, up.body.token);
  assert.strictEqual(me.body.user.username, 'Job');

  assert.strictEqual((await call('POST', '/auth/login', { login: 's23105047', password: JOB.password })).status, 200);
  assert.strictEqual((await call('POST', '/auth/login', { login: 'job', password: JOB.password })).status, 200);
  assert.strictEqual((await call('POST', '/auth/login', { login: 's23105047', password: 'wrong-pass' })).status, 401);
}));

test('sign up rejects bad IDs, short passwords and duplicates', () => withServer(async (call) => {
  assert.strictEqual((await call('POST', '/auth/signup', { ...JOB, dcismId: 'job@gmail.com' })).body.field, 'dcismId');
  assert.strictEqual((await call('POST', '/auth/signup', { ...JOB, username: 'a b' })).body.field, 'username');
  assert.strictEqual((await call('POST', '/auth/signup', { ...JOB, password: 'short' })).body.field, 'password');
  assert.strictEqual((await call('POST', '/auth/signup', JOB)).status, 200);
  const dupId = await call('POST', '/auth/signup', { ...JOB, username: 'Other' });
  assert.strictEqual(dupId.status, 409);
  assert.strictEqual(dupId.body.field, 'dcismId');
  const dupName = await call('POST', '/auth/signup', { ...JOB, dcismId: 's11111111', username: 'JOB' });
  assert.strictEqual(dupName.status, 409);
  assert.strictEqual(dupName.body.field, 'username');
}));

test('logout ends the session; password change signs out other devices', () => withServer(async (call) => {
  const { token } = (await call('POST', '/auth/signup', JOB)).body;
  const other = (await call('POST', '/auth/login', { login: JOB.dcismId, password: JOB.password })).body.token;
  assert.strictEqual((await call('POST', '/auth/password', { current: 'nope-nope', password: 'newpass123' }, token)).status, 401);
  const changed = await call('POST', '/auth/password', { current: JOB.password, password: 'newpass123' }, token);
  assert.strictEqual(changed.status, 200);
  assert.strictEqual((await call('GET', '/auth/me', null, other)).status, 401);
  assert.strictEqual((await call('GET', '/auth/me', null, changed.body.token)).status, 200);
  await call('POST', '/auth/logout', null, changed.body.token);
  assert.strictEqual((await call('GET', '/auth/me', null, changed.body.token)).status, 401);
  assert.strictEqual((await call('POST', '/auth/login', { login: JOB.dcismId, password: 'newpass123' })).status, 200);
}));

test('records keep the best sprint time and blitz score', () => withServer(async (call) => {
  const { token } = (await call('POST', '/auth/signup', JOB)).body;
  assert.strictEqual((await call('POST', '/records', { mode: 'sprint', value: 60000 })).status, 401);
  await call('POST', '/records', { mode: 'sprint', value: 60000 }, token);
  await call('POST', '/records', { mode: 'sprint', value: 70000 }, token);
  await call('POST', '/records', { mode: 'blitz', value: 5000 }, token);
  const r = await call('POST', '/records', { mode: 'blitz', value: 9000 }, token);
  assert.deepStrictEqual(r.body.records, { sprint: 60000, blitz: 9000 });
  assert.strictEqual((await call('POST', '/records', { mode: 'zen', value: 1 }, token)).status, 400);
}));

test('accounts survive a restart and the reset script sets a new password', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jedris-'));
  const dataFile = path.join(dir, 'accounts.json');
  await withServer(async (call, s) => {
    await call('POST', '/auth/signup', JOB);
    s.store.flush();
  }, { dataFile });
  resetPassword(new Store(dataFile), 's23105047', 'reset-pass-1');
  await withServer(async (call) => {
    assert.strictEqual((await call('POST', '/auth/login', { login: JOB.dcismId, password: JOB.password })).status, 401);
    assert.strictEqual((await call('POST', '/auth/login', { login: JOB.dcismId, password: 'reset-pass-1' })).status, 200);
  }, { dataFile });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub: signed-in players use their account name, guests cannot borrow it', () => {
  const users = { tok: { username: 'Job' } };
  const hub = new Hub({ auth: { userForToken: t => users[t] || null, isAccountName: n => n.toLowerCase() === 'job' } });
  const sent = [[], []];
  const a = hub.connect(m => sent[0].push(m));
  const b = hub.connect(m => sent[1].push(m));
  hub.message(a, { t: 'hello', name: 'whatever', token: 'tok' });
  hub.message(b, { t: 'hello', name: 'JOB' });
  assert.strictEqual(a.name, 'Job');
  assert.strictEqual(a.guest, false);
  assert.strictEqual(b.name, 'Guest');
  assert.strictEqual(b.guest, true);
  hub.message(a, { t: 'quick' });
  hub.message(b, { t: 'quick' });
  const match = sent[1].find(m => m.t === 'match');
  assert.deepStrictEqual(match.names, ['Job', 'Guest']);
  assert.deepStrictEqual(match.guests, [false, true]);
});

test('settings follow the account', () => withServer(async (call) => {
  const { token } = (await call('POST', '/auth/signup', JOB)).body;
  const mine = { das: 90, arr: 30, keys: { p1: { left: 'KeyJ' } }, v: 2 };
  assert.strictEqual((await call('PUT', '/settings', { settings: mine })).status, 401);
  assert.strictEqual((await call('PUT', '/settings', { settings: 'nope' }, token)).status, 400);
  assert.strictEqual((await call('PUT', '/settings', { settings: { junk: 'x'.repeat(5000) } }, token)).status, 400);
  assert.strictEqual((await call('PUT', '/settings', { settings: mine }, token)).status, 200);
  const other = (await call('POST', '/auth/login', { login: JOB.dcismId, password: JOB.password })).body;
  assert.deepStrictEqual(other.user.settings, mine);
}));

test('leaderboard counts wins between two different accounts', () => withServer(async (call, s) => {
  const job = (await call('POST', '/auth/signup', JOB)).body.user;
  const ana = (await call('POST', '/auth/signup', { dcismId: 's11111111', username: 'Ana', password: 'password1' })).body.user;
  const cy = (await call('POST', '/auth/signup', { dcismId: 's22222222', username: 'Cyd', password: 'password1' })).body.user;
  s.auth.recordMatch(job.id, ana.id);
  s.auth.recordMatch(job.id, cy.id);
  s.auth.recordMatch(ana.id, cy.id);
  s.auth.recordMatch(job.id, job.id); // same account on both sides
  s.auth.recordMatch(job.id, null);   // guest opponent
  const lb = (await call('GET', '/leaderboard')).body.players;
  assert.deepStrictEqual(lb, [
    { username: 'Job', wins: 2, losses: 0 },
    { username: 'Ana', wins: 1, losses: 1 },
  ]);
  const me = (await call('POST', '/auth/login', { login: 'Cyd', password: 'password1' })).body.user;
  assert.strictEqual(me.losses, 2);
}));

test('hub records the match winner for signed-in players', () => {
  const users = { ta: { id: '1', username: 'Job' }, tb: { id: '2', username: 'Ana' } };
  const recorded = [];
  const hub = new Hub({
    setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {},
    auth: { userForToken: t => users[t] || null, isAccountName: () => false, recordMatch: (w, l) => recorded.push([w, l]) },
  });
  const a = hub.connect(() => {}), b = hub.connect(() => {});
  hub.message(a, { t: 'hello', token: 'ta' });
  hub.message(b, { t: 'hello', token: 'tb' });
  hub.message(a, { t: 'quick' });
  hub.message(b, { t: 'quick' });
  hub.message(a, { t: 'dead', round: 1 });
  assert.deepStrictEqual(recorded, []);
  hub.message(a, { t: 'dead', round: 2 });
  assert.deepStrictEqual(recorded, [['2', '1']]);
});
