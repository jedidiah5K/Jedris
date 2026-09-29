'use strict';

/* Game-logic test suite. Runs in the browser against the real game scripts.
 * Open tests/index.html to run it by hand; tests/run.js runs it headlessly. */
function runJedrisSpec() {
  const saved = JSON.stringify(settings);
  const out = [];
  const check = (name, cond, info) => out.push({ name, ok: !!cond, info });
  const mk = (mode = 'zen', extra = {}) => {
    const g = new Game({ mode, countdownMs: 0, sound: false, seed: 42, ...extra });
    g.tick(); // countdown ends -> spawn
    return g;
  };
  const run = (g, n) => { for (let i = 0; i < n; i++) g.tick(); };

  // shapes
  check('SRS I state R is column 2', JSON.stringify(SHAPES.I.states[1]) === '[[2,0],[2,1],[2,2],[2,3]]');

  // 7-bag
  {
    const g = new Game({ seed: 7, sound: false });
    const seq = [];
    for (let i = 0; i < 700; i++) { seq.push(g.queue.shift()); g.fillQueue(); }
    let ok = true;
    for (let i = 0; i < 700; i += 7) if (new Set(seq.slice(i, i + 7)).size !== 7) ok = false;
    check('7-bag: every bag has all 7 pieces', ok);
    const a = new Game({ seed: 1 }), b = new Game({ seed: 2 });
    check('independent bags differ', a.queue.join('') !== b.queue.join(''));
  }

  // spawn
  {
    const g = mk();
    check('playing after countdown', g.phase === 'playing' && !!g.piece);
    check('spawn position + one-row drop', g.piece.y === 1 && g.piece.x === (g.piece.type === 'O' ? 4 : 3), g.piece);
    check('next queue length >= 5', g.queue.length >= 5);
  }

  // TSD
  {
    const g = mk();
    g.board = Game.emptyBoard();
    for (let x = 0; x < 10; x++) { if (x !== 4) g.board[21][x] = 'G'; if (x < 3 || x > 5) g.board[20][x] = 'G'; }
    g.board[19][3] = 'G';
    g.piece = { type: 'T', rot: 1, x: 3, y: 19 };
    const rotated = g.rotate(1);
    g.hardDrop();
    check('TSD rotation ok', rotated);
    check('TSD attack 4 lines 2', g.attack === 4 && g.lines === 2, { attack: g.attack, lines: g.lines, popups: g.popups.map(p => p.text) });
    check('TSD popup', g.popups.some(p => p.text === 'T-SPIN DOUBLE'));
    check('b2b started', g.b2b === 0);
  }

  // mini vs full via corners
  {
    const g = mk();
    g.board = Game.emptyBoard();
    g.piece = { type: 'T', rot: 0, x: 3, y: 18 };
    g.board[20][3] = 'G'; g.board[20][5] = 'G'; g.board[18][3] = 'G';
    g.lastMoveRotate = true; g.lastKick = 0; g.lastRotate180 = false;
    check('mini detected (3 corners, 1 front)', g.detectSpin() === 'mini');
    g.lastKick = 4;
    check('kick 4 upgrades to full', g.detectSpin() === 'full');
    g.lastKick = 0; g.board[18][5] = 'G';
    check('full detected (both front)', g.detectSpin() === 'full');
    g.lastMoveRotate = false;
    check('no spin without rotation last', g.detectSpin() === null);
  }

  // L-spin: rotated into a spot it can't leave
  {
    const g = mk();
    g.board = Game.emptyBoard();
    const p = { type: 'L', rot: 0, x: 3, y: 19 };
    const cells = SHAPES.L.states[0].map(([cx, cy]) => `${p.x + cx},${p.y + cy}`);
    for (let y = 18; y < 22; y++) for (let x = 0; x < 10; x++) {
      if (cells.includes(`${x},${y}`)) continue;
      if ((y === 18 || y === 21) && x === 9) continue;
      g.board[y][x] = 'G';
    }
    g.piece = { ...p };
    g.lastMoveRotate = true;
    check('L-spin detected when stuck', g.detectSpin() === 'spin');
    g.lastMoveRotate = false;
    check('no L-spin without rotation last', g.detectSpin() === null);
    g.lastMoveRotate = true;
    g.hardDrop();
    check('L-spin double: 3 attack', g.attack === 3 && g.lines === 2, { attack: g.attack, lines: g.lines });
    check('L-SPIN DOUBLE popup', g.popups.some(q => q.text === 'L-SPIN DOUBLE'), g.popups.map(q => q.text));
    check('L-spin starts back-to-back', g.b2b === 0);
    const free = mk();
    free.board = Game.emptyBoard();
    free.piece = { type: 'J', rot: 0, x: 3, y: 18 };
    free.lastMoveRotate = true;
    check('no spin when the piece can still move', free.detectSpin() === null);
  }

  // Same seed -> same pieces, even when only one side takes garbage
  {
    const a = new Game({ seed: 99, sound: false }), b = new Game({ seed: 99, sound: false });
    b.receiveGarbage(4); b.receiveGarbage(2);
    const seq = (g) => { const out = []; for (let i = 0; i < 50; i++) { out.push(g.queue.shift()); g.fillQueue(); } return out.join(''); };
    check('garbage does not change the piece order', seq(a) === seq(b));
  }

  // Settings: old fast defaults move to the calmer ones, custom values stay
  {
    const old = mergeSettings({ das: 133, arr: 10 });
    check('old default DAS/ARR migrate', old.das === DEFAULT_SETTINGS.das && old.arr === DEFAULT_SETTINGS.arr, old);
    const v2 = mergeSettings({ das: 120, arr: 120, v: 2 });
    check('v2 default DAS/ARR migrate', v2.das === 167 && v2.arr === 33, v2);
    const mine = mergeSettings({ das: 133, arr: 10, v: 3 });
    check('chosen DAS/ARR are kept', mine.das === 133 && mine.arr === 10);
    const custom = mergeSettings({ das: 90, arr: 30, keys: { p1: { left: 'KeyJ', bogus: 1 } } });
    check('custom handling and keys merge', custom.das === 90 && custom.keys.p1.left === 'KeyJ' && custom.keys.p1.right === 'KeyD' && !('bogus' in custom.keys.p1));
  }

  // Wall kick: I piece next to wall
  {
    const g = mk();
    g.board = Game.emptyBoard();
    g.piece = { type: 'I', rot: 1, x: -2, y: 10 }; // vertical at column 0
    const ok = g.rotate(1); // R->2 should kick right
    check('I kick off left wall', ok && g.piece.rot === 2 && g.piece.x >= 0, g.piece);
  }

  // B2B quads + combo + PC
  {
    const g = mk();
    g.board = Game.emptyBoard();
    for (let y = 18; y < 22; y++) for (let x = 1; x < 10; x++) g.board[y][x] = 'G';
    g.piece = { type: 'I', rot: 1, x: -2, y: 5 };
    g.hardDrop();
    check('quad = 4 atk + PC 10', g.attack === 14 && g.stats.pcs === 1, { atk: g.attack });
    g.board = Game.emptyBoard();
    for (let y = 18; y < 22; y++) for (let x = 1; x < 10; x++) g.board[y][x] = 'G';
    g.board[17][5] = 'G';
    g.piece = { type: 'I', rot: 1, x: -2, y: 5 };
    g.hardDrop();
    // second quad: 4 + b2b 1 + combo(1)=0 -> 5
    check('b2b quad adds +1', g.attack === 19 && g.b2b === 1, { atk: g.attack, b2b: g.b2b, combo: g.combo });
    check('combo tracked', g.combo === 1);
  }

  // combo table
  {
    check('combo table', [0,1,2,3,4,5,6,10,11,20].map(comboAttack).join() === '0,0,1,1,2,2,3,4,5,5');
  }

  // Garbage: delay, same hole, cancellation
  {
    const g = mk();
    g.board = Game.emptyBoard();
    g.receiveGarbage(3);
    g.piece = { type: 'O', rot: 0, x: 0, y: 5 };
    g.hardDrop(); // immediately: garbage not ready yet
    check('garbage waits 500ms', g.incomingTotal() === 3 && !g.board[21].some(c => c === 'G'));
    run(g, 31);
    g.piece = { type: 'O', rot: 0, x: 0, y: 5 };
    g.hardDrop();
    const gRows = g.board.filter(r => r.filter(c => c === 'G').length === 9);
    const holes = gRows.map(r => r.indexOf(null));
    check('3 garbage rows with same hole', gRows.length === 3 && new Set(holes).size === 1, holes);
    check('meter emptied', g.incomingTotal() === 0);

    const h = mk();
    h.board = Game.emptyBoard();
    h.receiveGarbage(5);
    for (let y = 18; y < 22; y++) for (let x = 1; x < 10; x++) h.board[y][x] = 'G';
    h.board[17][5] = 'G';
    let sent = 0; h.sendGarbage = n => sent += n;
    h.piece = { type: 'I', rot: 1, x: -2, y: 5 };
    h.hardDrop();
    check('quad cancels 4 of 5 incoming', h.incomingTotal() === 1 && sent === 0, { inc: h.incomingTotal(), sent });
  }

  // DAS / ARR / last pressed wins
  {
    settings.das = 133; settings.arr = 0;
    const g = mk();
    g.board = Game.emptyBoard();
    g.piece = { type: 'T', rot: 0, x: 3, y: 5 }; g.gravAcc = -999;
    g.input('down', 'right'); g.tick();
    check('tap moves 1', g.piece.x === 4, g.piece.x);
    run(g, 6);
    check('no autoshift before DAS', g.piece.x === 4, g.piece.x);
    run(g, 2);
    check('ARR 0 -> wall after DAS', g.piece.x === 7, g.piece.x);
    g.input('down', 'left'); g.tick();
    check('last pressed (left) wins', g.piece.x === 6, g.piece.x);
    g.input('up', 'left'); g.tick();
    check('release left -> right resumes', g.lastDir === 'right');
    g.input('up', 'right'); g.tick();

    settings.arr = 10;
    g.piece = { type: 'T', rot: 0, x: 0, y: 5 }; g.gravAcc = -999; g.lockTimer = 0;
    g.input('down', 'right'); g.tick(); // x=1
    run(g, 7); // dasTimer = 133.3 -> first autoshift
    const afterDas = g.piece.x;
    g.tick();
    check('ARR 10 autoshift pace', afterDas === 2 && (g.piece.x === 3 || g.piece.x === 4), { afterDas, x: g.piece.x });
    g.input('up', 'right'); g.tick();
    settings.arr = 10;
  }

  // Lock delay and max resets
  {
    const g = mk();
    g.board = Game.emptyBoard();
    g.piece = { type: 'T', rot: 0, x: 3, y: 20 };
    const before = g.pieces;
    run(g, 29);
    check('not locked before 500ms', g.pieces === before);
    run(g, 2);
    check('locked after 500ms', g.pieces === before + 1);

    const h = mk();
    h.board = Game.emptyBoard();
    h.piece = { type: 'T', rot: 0, x: 3, y: 20 };
    const b2 = h.pieces;
    let locked = -1;
    for (let i = 0; i < 400; i++) {
      h.input('down', i % 2 ? 'left' : 'right'); h.input('up', i % 2 ? 'left' : 'right');
      run(h, 5);
      if (h.pieces > b2) { locked = i; break; }
    }
    check('max 15 lock resets then locks', locked > 10 && locked < 25, locked);
  }

  // Soft drop instant
  {
    settings.sdfInstant = true;
    const g = mk();
    g.board = Game.emptyBoard();
    g.piece = { type: 'T', rot: 0, x: 3, y: 1 };
    g.input('down', 'soft'); g.tick();
    check('instant soft drop to floor', g.piece && g.piece.y === 20, g.piece);
    settings.sdfInstant = false;
  }

  // Hold once per piece
  {
    const g = mk();
    const first = g.piece.type;
    g.input('down', 'hold'); g.tick();
    const second = g.piece.type;
    g.input('down', 'hold'); g.tick();
    check('hold swaps & only once', g.holdPiece === first && g.piece.type === second && !g.canHold);
  }

  // Top out on spawn overlap; zen resets
  {
    const g = mk('sprint');
    for (let y = 0; y < 22; y++) for (let x = 0; x < 9; x++) g.board[y][x] = 'G';
    g.spawn();
    check('top out on spawn overlap', g.phase === 'over');
    const z = mk('zen');
    for (let y = 0; y < 22; y++) for (let x = 0; x < 9; x++) z.board[y][x] = 'G';
    z.spawn();
    check('zen never ends (board resets)', z.phase === 'playing' && !!z.piece);
  }

  // Sprint finish
  {
    const g = mk('sprint');
    g.lines = 39;
    g.board = Game.emptyBoard();
    for (let x = 0; x < 6; x++) g.board[21][x] = 'G';
    g.piece = { type: 'I', rot: 0, x: 6, y: 5 };
    g.hardDrop();
    check('sprint finishes at 40', g.phase === 'done', g.phase);
  }

  // Blitz timer and gravity
  {
    const g = mk('blitz');
    g.time = 119990; run(g, 2);
    check('blitz ends at 2 minutes', g.phase === 'done');
    check('gravity increases', gravityForLevel(5) > gravityForLevel(1) && gravityForLevel(20) >= 1);
  }
  Object.assign(settings, JSON.parse(saved));
  return out;
}
