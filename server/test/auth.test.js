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
