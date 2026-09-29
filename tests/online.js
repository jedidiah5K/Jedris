// End-to-end online versus test: starts the real server and plays a match between two browser pages.
// Usage: npm run test:online   (or as part of npm test)
const { chromium } = require('playwright');
const { createServer } = require('../server/index');

(async () => {
  const { server, wss } = createServer({ dataFile: null });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let failures = 0;
  const check = async (name, fn) => {
    let ok = false;
    try { ok = await fn(); } catch (e) { name += `: ${e.message}`; }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failures++;
  };
  const errors = [];
  const visible = (page, id) => page.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);
  const newPlayerPage = async (name) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    await page.goto(base);
    await page.waitForFunction(() => !document.getElementById('welcome').classList.contains('hidden'));
    return page;
  };
  const enterLobby = async (page, guestName) => {
    await page.click('#btn-online');
    if (guestName) {
      await page.fill('#net-name', guestName);
      await page.dispatchEvent('#net-name', 'change');
    }
    await page.waitForFunction(() => document.getElementById('net-status').dataset.state === 'online');
  };
  const game = (page) => page.evaluate(() => {
    const { App } = window.Jedris;
    const [me, opp] = App.games;
    return {
      state: App.state, mode: App.mode, round: App.round, wins: App.wins.slice(),
      me: me && { phase: me.phase, pieces: me.pieces, incoming: me.incomingTotal() },
      opp: opp && { phase: opp.phase, pieces: opp.pieces, board: opp.board.flat().filter(Boolean).length },
    };
  });

  try {
    // Accounts: Alpha signs up with a DCISM ID, Bravo plays as a guest.
    const a = await newPlayerPage('Alpha');
    await check('first visit offers sign in or guest', () => visible(a, 'welcome'));
    await a.click('#btn-welcome-signup');
    await a.fill('#in-dcism', 's23105047');
    await a.fill('#in-username', 'Alpha');
    await a.fill('#in-new-password', 'password123');
    await a.fill('#in-confirm', 'password12');
    await a.click('#form-signup button[type=submit]');
    await a.waitForFunction(() => document.querySelector('#form-signup .form-error').textContent !== '');
    await check('sign up catches mismatched passwords', async () => (await a.textContent('#form-signup .form-error')).includes("don't match"));
    await a.fill('#in-confirm', 'password123');
    await a.click('#form-signup button[type=submit]');
    await a.waitForFunction(() => window.Jedris.App.state === 'menu');
    await check('sign up signs you in', async () => (await a.textContent('#btn-account')).includes('Alpha'));
    await a.reload();
    await a.waitForTimeout(400);
    await check('session survives a reload without the welcome screen', async () =>
      (await visible(a, 'menu')) && (await a.textContent('#btn-account')).includes('Alpha'));

    await a.click('#btn-account');
    await a.click('#btn-signout');
    await a.waitForFunction(() => !window.Jedris.Account.signedIn());
    await check('sign out returns to the sign-in form', () => visible(a, 'form-signin'));
    await a.fill('#in-login', 's23105047');
    await a.fill('#in-password', 'wrongpass1');
    await a.click('#form-signin button[type=submit]');
    await a.waitForFunction(() => document.querySelector('#form-signin .form-error').textContent !== '');
    await check('wrong password is rejected', async () => (await a.textContent('#form-signin .form-error')).includes('Wrong'));
    await a.fill('#in-password', 'password123');
    await a.click('#form-signin button[type=submit]');
    await a.waitForFunction(() => window.Jedris.App.state === 'menu');
    await check('sign in with DCISM ID works', async () => (await a.textContent('#btn-account')).includes('Alpha'));

    // Config follows the account into a fresh browser (like a private tab).
    await a.evaluate(() => { const s = window.Jedris.settings; s.das = 77; s.keys.p1.hold = 'KeyC'; window.saveSettings(); });
    await a.waitForFunction(() => window.Jedris.Account.user.settings && window.Jedris.Account.user.settings.das === 77, null, { timeout: 3000 });
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const f = await fresh.newPage();
    f.on('pageerror', e => errors.push(`fresh: ${e.message}`));
    await f.goto(base);
    await f.waitForFunction(() => !document.getElementById('welcome').classList.contains('hidden'));
    await f.click('#btn-welcome-signin');
    await f.fill('#in-login', 's23105047');
    await f.fill('#in-password', 'password123');
    await f.click('#form-signin button[type=submit]');
    await f.waitForFunction(() => window.Jedris.App.state === 'menu');
    await check('config is restored after signing in elsewhere', () => f.evaluate(() =>
      window.Jedris.settings.das === 77 && window.Jedris.settings.keys.p1.hold === 'KeyC'));
    await f.click('#btn-settings');
    await check('config says it saves to the account', async () => (await f.textContent('#settings-sub')).includes('ACCOUNT'));
    await fresh.close();

    const b = await newPlayerPage('Bravo');
    await b.click('#btn-welcome-guest');
    await check('play as guest goes to the menu', () => visible(b, 'menu'));
    await enterLobby(a);
    await check('signed-in lobby uses the account name', async () =>
      (await a.inputValue('#net-name')) === 'Alpha' && await a.isDisabled('#net-name'));
    await enterLobby(b, 'alpha');
    await b.waitForFunction(() => window.Jedris.Online.myName === 'Guest');
    await check('guests cannot take an account name', async () => (await b.textContent('#net-name-note')).includes('belongs to an account'));
    await b.fill('#net-name', 'Bravo');
    await b.dispatchEvent('#net-name', 'change');
    await b.waitForFunction(() => window.Jedris.Online.myName === 'Bravo');
    await check('lobby shows online status', async () => (await a.textContent('#net-status')).startsWith('ONLINE'));

    await a.click('#btn-create');
    await a.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('lobby-code').textContent));
    const code = await a.textContent('#lobby-code');
    await check('room code shown to host', async () => /^[A-Z0-9]{4}$/.test(code));

    await b.fill('#net-code', code.toLowerCase());
    await b.click('#btn-join');
    await a.waitForFunction(() => window.Jedris.App.mode === 'online' && window.Jedris.App.state === 'playing');
    await b.waitForFunction(() => window.Jedris.App.mode === 'online');
    await check('both players enter the match', async () => (await game(a)).round === 1 && (await game(b)).round === 1);
    await check('players see each other\'s names', async () =>
      (await b.evaluate(() => window.Jedris.Online.opponentName())) === 'Alpha' &&
      (await a.evaluate(() => window.Jedris.Online.opponentName())) === 'Bravo');

    await a.waitForFunction(() => window.Jedris.App.games[0].phase === 'playing', null, { timeout: 10000 }); // countdown
    await b.waitForFunction(() => window.Jedris.App.games[0].phase === 'playing', null, { timeout: 10000 });
    const pieceOrder = (page) => page.evaluate(() => { const g = window.Jedris.App.games[0]; return [g.piece.type, ...g.queue.slice(0, 5)].join(''); });
    await check('both players get the same pieces', async () => (await pieceOrder(a)) === (await pieceOrder(b)));
    await a.keyboard.press('KeyW');
    await a.keyboard.press('KeyW');
    await a.waitForTimeout(400);
    await check('opponent sees my placed pieces', async () => {
      const gb = await game(b);
      return gb.opp.pieces === 2 && gb.opp.board >= 8;
    });

    await a.evaluate(() => window.Jedris.App.games[0].sendGarbage(5));
    await b.waitForTimeout(300);
    await check('attacks arrive as incoming garbage', async () => (await game(b)).me.incoming === 5);
    await check('opponent meter mirrors incoming garbage', async () => {
      const inc = await a.evaluate(() => window.Jedris.App.games[1].incomingTotal());
      return inc === 5;
    });

    // Bravo tops out twice -> Alpha wins 2-0
    await b.evaluate(() => window.Jedris.App.games[0].topOut());
    await a.waitForFunction(() => window.Jedris.App.wins[0] === 1);
    await check('round win is reported to both players', async () =>
      (await game(a)).wins.join() === '1,0' && (await game(b)).wins.join() === '0,1');
    await a.waitForFunction(() => window.Jedris.App.round === 2 && window.Jedris.App.state === 'playing', null, { timeout: 6000 });
    await check('round 2 starts automatically', async () => (await game(b)).round === 2);

    await b.waitForTimeout(500);
    await b.evaluate(() => window.Jedris.App.games[0].topOut());
    await a.waitForFunction(() => window.Jedris.App.state === 'results', null, { timeout: 6000 });
    await b.waitForFunction(() => window.Jedris.App.state === 'results', null, { timeout: 6000 });
    await check('winner sees VICTORY', async () => (await a.textContent('#res-big')) === 'VICTORY');
    await check('loser sees DEFEAT', async () => (await b.textContent('#res-big')) === 'DEFEAT');
    await check('wins against guests stay off the leaderboard', async () => {
      const r = await a.evaluate(() => window.Jedris.Account.api('GET', 'leaderboard'));
      return r.status === 200 && r.body.players.length === 0;
    });

    await a.click('#btn-again');
    await b.click('#btn-again');
    await a.waitForFunction(() => window.Jedris.App.state === 'playing' && window.Jedris.App.round === 1, null, { timeout: 5000 });
    await b.waitForTimeout(200);
    await check('rematch starts a fresh match', async () => { const g = await game(b); if (g.wins.join() !== '0,0' || g.state !== 'playing') console.log(g); return g.wins.join() === '0,0' && g.state === 'playing'; });

    await b.keyboard.press('Escape');
    await b.click('#btn-quit');
    await a.waitForFunction(() => window.Jedris.App.state === 'results', null, { timeout: 5000 });
    await check('opponent leaving ends the match for the other player', async () =>
      (await a.textContent('#res-sub')).includes('LEFT'));

    // Quick match
    await a.click('#btn-res-menu');
    await a.click('#btn-online');
    await b.click('#btn-online');
    await a.waitForFunction(() => document.getElementById('net-status').dataset.state === 'online');
    await b.waitForFunction(() => document.getElementById('net-status').dataset.state === 'online');
    await a.click('#btn-quick');
    await a.waitForFunction(() => !document.getElementById('lobby-wait').classList.contains('hidden'));
    await b.click('#btn-quick');
    await b.waitForFunction(() => window.Jedris.App.mode === 'online' && window.Jedris.App.state === 'playing');
    await check('quick match pairs two players', async () => (await game(a)).mode === 'online');

    await check('no page errors', async () => { if (errors.length) console.log(errors); return errors.length === 0; });
  } finally {
    await browser.close();
    for (const ws of wss.clients) ws.terminate();
    await new Promise(r => server.close(r));
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL ONLINE TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
