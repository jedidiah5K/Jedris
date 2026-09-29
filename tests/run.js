// Headless test runner: game-logic suite (tests/index.html) + UI smoke test (index.html).
// Usage: npm install && npm test
const { chromium } = require('playwright');
const path = require('path');

const root = path.resolve(__dirname, '..');
const url = (p) => 'file://' + path.join(root, p);

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let failures = 0;
  const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };
  const pass = (msg) => console.log(`PASS  ${msg}`);

  // 1) Game logic
  const logic = await browser.newPage();
  const logicErrors = [];
  logic.on('pageerror', e => logicErrors.push(e.message));
  await logic.goto(url('tests/index.html'));
  const results = await logic.evaluate(() => window.__results || []);
  if (!results.length) fail('logic suite did not run ' + JSON.stringify(logicErrors));
  for (const r of results) r.ok ? pass(r.name) : fail(`${r.name} ${JSON.stringify(r.info)}`);

  // 2) UI smoke test
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    // Web fonts are optional; ignore network failures loading them.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto(url('index.html'));
  const check = async (name, fn) => { try { (await fn()) ? pass(name) : fail(name); } catch (e) { fail(`${name}: ${e.message}`); } };
  const state = () => page.evaluate(() => {
    const { App } = window.Jedris;
    return { state: App.state, round: App.round, wins: App.wins.slice(), mode: App.mode, paused: App.paused,
      pieces: App.games.map(g => g.pieces), incoming: App.games.map(g => g.incomingTotal()) };
  });
  const visible = (id) => page.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);

  await check('menu visible on load', () => visible('menu'));

  await page.click('#btn-help');
  await check('how to play opens', () => visible('help'));
  await check('how to play lists controls', () => page.evaluate(() => document.querySelectorAll('#help-keys tr').length >= 9));
  await page.keyboard.press('Escape');
  await check('esc returns to menu', () => visible('menu'));

  await page.click('[data-mode="versus"]');
  await page.waitForFunction(() => window.Jedris.App.games.every(g => g.phase === 'playing'), null, { timeout: 10000 }); // countdown
  await page.keyboard.press('KeyW');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  await check('versus: both players take keyboard input', async () => (await state()).pieces.join() === '1,1');
  await page.evaluate(() => window.Jedris.App.games[0].sendGarbage(6));
  await check('versus: attacks reach the opponent', async () => (await state()).incoming[1] === 6);
  await page.evaluate(() => window.Jedris.App.games[0].topOut());
  await page.waitForTimeout(2600);
  await check('versus: round 2 starts after a top out', async () => { const s = await state(); return s.round === 2 && s.wins[1] === 1; });
  await page.evaluate(() => window.Jedris.App.games[0].topOut());
  await page.waitForTimeout(2600);
  await check('versus: results after 2 round wins', async () => (await visible('results')) &&
    (await page.textContent('#res-big')) === 'PLAYER 2 WINS');
  await page.keyboard.press('Enter');
  await check('enter on results starts a rematch', async () => (await state()).state === 'playing' && (await state()).round === 1);

  await page.keyboard.press('Escape');
  await page.click('#btn-quit');
  await page.click('[data-mode="sprint"]');
  await page.waitForFunction(() => window.Jedris.App.games.every(g => g.phase === 'playing'), null, { timeout: 10000 }); // countdown
  for (let i = 0; i < 6; i++) { await page.keyboard.press(i % 2 ? 'KeyA' : 'KeyD'); await page.keyboard.press('KeyW'); }
  await page.waitForFunction(() => window.Jedris.App.games[0].pieces === 6, null, { timeout: 3000 }).catch(() => {});
  await check('sprint: pieces placed from keyboard', async () => (await state()).pieces[0] === 6);
  await page.keyboard.press('Backquote');
  await check('quick retry restarts the run', async () => { const s = await state(); return s.pieces[0] === 0 && s.state === 'playing'; });
  await page.keyboard.press('Escape');
  await check('esc pauses', async () => (await state()).paused && (await visible('pause')));
  await page.click('#btn-quit');

  await page.click('#btn-settings');
  await page.click('#binds tr:nth-child(2) td:nth-child(2) button');
  await page.keyboard.press('KeyJ');
  await check('rebinding persists to localStorage', () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('jedris.settings.v1')).keys.p1.left === 'KeyJ'));
  await page.click('#btn-reset-settings');

  if (errors.length) fail('page errors: ' + JSON.stringify(errors)); else pass('no page errors');

  // 3) Touch controller on a phone-sized screen
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const tp = await phone.newPage();
  const touchErrors = [];
  tp.on('pageerror', e => touchErrors.push(e.message));
  await tp.goto(url('index.html'));
  const tstate = () => tp.evaluate(() => {
    const g = window.Jedris.App.games[0];
    return { pieces: g && g.pieces, hold: g && g.holdPiece, paused: window.Jedris.App.paused };
  });
  await check('touch: local versus is hidden on phones', async () => !(await tp.isVisible('[data-mode="versus"]')));
  await tp.tap('[data-mode="sprint"]');
  await tp.waitForFunction(() => !document.getElementById('pad').classList.contains('hidden'), null, { timeout: 2000 }).catch(() => {});
  await check('touch: pad appears in game', () => tp.isVisible('#pad-dpad'));
  await tp.waitForFunction(() => window.Jedris.App.games[0].phase === 'playing', null, { timeout: 10000 });
  const dpad = await tp.locator('#pad-dpad').boundingBox();
  await tp.touchscreen.tap(dpad.x + dpad.width / 2, dpad.y + dpad.height * 0.1);
  await tp.waitForTimeout(150);
  await check('touch: the d-pad has no hard drop', async () => (await tstate()).pieces === 0);
  await tp.tap('#pad-drop');
  await tp.waitForFunction(() => window.Jedris.App.games[0].pieces === 1, null, { timeout: 2000 }).catch(() => {});
  await check('touch: DROP button hard drops', async () => (await tstate()).pieces === 1);
  await check('touch: DROP sits between the d-pad and HOLD', () => tp.evaluate(() => {
    const r = (id) => document.querySelector(id).getBoundingClientRect();
    const d = r('#pad-drop'), arms = r('#pad-dpad .down'), hold = r('#pad-face .bottom');
    return d.left >= arms.right && d.right <= hold.left && d.bottom <= innerHeight;
  }));
  await tp.tap('#pad-face .bottom');
  await tp.waitForFunction(() => !!window.Jedris.App.games[0].holdPiece, null, { timeout: 2000 }).catch(() => {});
  await check('touch: hold button holds the piece', async () => !!(await tstate()).hold);
  // Swap in a T so the rotation is visible whatever the bag dealt.
  await tp.evaluate(() => { const g = window.Jedris.App.games[0]; g.piece = { type: 'T', rot: 0, x: 3, y: g.piece.y }; });
  await tp.tap('#pad-face .right');
  await tp.waitForFunction(() => window.Jedris.App.games[0].piece.rot === 1, null, { timeout: 2000 }).catch(() => {});
  await check('touch: rotate button rotates', () => tp.evaluate(() => window.Jedris.App.games[0].piece.rot === 1));
  await check('touch: board fits above the pad', () => tp.evaluate(() => {
    const L = window.Jedris.App.games[0]._L;
    return L.by + L.bh <= document.getElementById('pad').getBoundingClientRect().top;
  }));
  await tp.tap('#pad-menu');
  await tp.waitForFunction(() => document.getElementById('pad').classList.contains('hidden'), null, { timeout: 2000 }).catch(() => {});
  await check('touch: menu button pauses and hides the pad', async () => (await tstate()).paused && !(await tp.isVisible('#pad')));
  if (touchErrors.length) fail('touch page errors: ' + JSON.stringify(touchErrors)); else pass('touch: no page errors');
  await phone.close();

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
