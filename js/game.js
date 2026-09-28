'use strict';

/* =========================================================================
 * GAME STATE (one instance per player; board logic lives here)
 * ========================================================================= */
class Game {
  /**
   * @param {object} o
   *   mode: 'sprint' | 'blitz' | 'zen' | 'versus'
   *   seed: number, name: string
   *   sendGarbage(lines): called with outgoing attack after cancellation
   *   sound: boolean, whether this instance plays sound effects
   */
  constructor(o = {}) {
    this.mode = o.mode || 'zen';
    this.name = o.name || '';
    this.rng = mulberry32(o.seed ?? randomSeed());
    this.sendGarbage = o.sendGarbage || null;
    this.soundOn = o.sound !== false;

    this.board = Game.emptyBoard();
    this.bag = [];
    this.queue = [];
    this.fillQueue();
    this.holdPiece = null;
    this.canHold = true;
    this.piece = null;

    this.phase = 'countdown'; // countdown | playing | over | done
    this.countdown = o.countdownMs ?? COUNTDOWN_MS;
    this.time = 0;
    this.lines = 0;
    this.score = 0;
    this.pieces = 0;
    this.attack = 0;
    this.level = 1;
    this.combo = -1;
    this.b2b = -1;
    this.maxCombo = 0;
    this.maxB2b = 0;
    this.stats = { quads: 0, tspins: 0, pcs: 0, garbageReceived: 0, garbageCancelled: 0 };

    this.incoming = []; // [{lines, hole, readyAt}]

    // Input / handling state
    this.events = [];
    this.held = { left: false, right: false, soft: false };
    this.lastDir = null;
    this.dasTimer = 0;
    this.arrAcc = 0;
    this.gravAcc = 0;

    // Lock / spin state
    this.lockTimer = 0;
    this.lockResets = 0;
    this.touchedGround = false;
    this.lastMoveRotate = false;
    this.lastKick = 0;
    this.lastRotate180 = false;

    // Visual effects
    this.popups = [];
    this.shake = 0;
    this.goTimer = 0;
    this.lastCountShown = 0;
    this.fx = []; // visual events consumed by the renderer
    this.net = null; // online play: { fx, popups } mirrored to the opponent
    this.ticksAlive = 0;
  }

  static emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }

  sfx(name, arg) { if (this.soundOn) Sound.play(name, arg); }
  emit(ev) {
    if (this.fx.length < 64) this.fx.push(ev);
    if (this.net && this.net.fx.length < 64) this.net.fx.push(ev);
  }
  pieceCells(p = this.piece) { return SHAPES[p.type].states[p.rot].map(([cx, cy]) => ({ x: p.x + cx, y: p.y + cy })); }

  /* ---------- randomizer ---------- */
  fillQueue() {
    while (this.queue.length < NEXT_COUNT + 1) {
      if (this.bag.length === 0) {
        this.bag = PIECE_TYPES.slice();
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      }
      this.queue.push(this.bag.shift());
    }
  }

  /* ---------- board logic ---------- */
  collides(type, rot, x, y) {
    for (const [cx, cy] of SHAPES[type].states[rot]) {
      const bx = x + cx, by = y + cy;
      if (bx < 0 || bx >= COLS || by < 0 || by >= ROWS) return true;
      if (this.board[by][bx]) return true;
    }
    return false;
  }
  fits(dx, dy) {
    const p = this.piece;
    return !!p && !this.collides(p.type, p.rot, p.x + dx, p.y + dy);
  }
  grounded() { return !this.fits(0, 1); }
  ghostY() {
    const p = this.piece;
    let y = p.y;
    while (!this.collides(p.type, p.rot, p.x, y + 1)) y++;
    return y;
  }
  clearLines() {
    const rows = [];
    for (let y = 0; y < ROWS; y++) if (this.board[y].every(Boolean)) rows.push(y);
    if (rows.length) this.emit({ type: 'clear', rows: rows.map(y => ({ y, cells: this.board[y].slice() })) });
    for (const y of rows) {
      this.board.splice(y, 1);
      this.board.unshift(Array(COLS).fill(null));
    }
    return rows;
  }
  boardEmpty() { return this.board.every(r => r.every(c => !c)); }
  stackHeight() {
    for (let y = 0; y < ROWS; y++) if (this.board[y].some(Boolean)) return ROWS - y;
    return 0;
  }

  /* ---------- piece lifecycle ---------- */
  spawn(type) {
    if (!type) { type = this.queue.shift(); this.fillQueue(); }
    const p = { type, rot: 0, x: type === 'O' ? 4 : 3, y: 0 };
    this.piece = p;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.touchedGround = false;
    this.lastMoveRotate = false;
    this.gravAcc = 0;
    if (this.collides(p.type, p.rot, p.x, p.y)) {
      if (!this.topOut()) return false;
    }
    // Guideline: drop one row straight away if there is room.
    if (!this.collides(p.type, p.rot, p.x, p.y + 1)) p.y++;
    return true;
  }

  /** Returns true if play continues (Zen clears the board instead of ending). */
  topOut() {
    if (this.mode === 'zen') {
      this.board = Game.emptyBoard();
      this.incoming = [];
      this.combo = -1;
      this.popup('BOARD RESET', '#8a93a8');
      this.sfx('garbage');
      return true;
    }
    this.phase = 'over';
    this.piece = null;
    this.sfx('topout');
    return false;
  }

  finish() {
    this.phase = 'done';
    this.piece = null;
    this.sfx('win');
  }

  afterMove(rotated) {
    this.lastMoveRotate = rotated;
    if (this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      if (this.touchedGround) this.lockResets++;
    }
  }

  shift(dx, maxSteps = 1) {
    let moved = 0;
    while (moved < maxSteps && this.fits(dx, 0)) { this.piece.x += dx; moved++; }
    if (moved) this.afterMove(false);
    return moved;
  }

  rotate(dir) {
    const p = this.piece;
    if (!p || p.type === 'O') return false;
    const to = (p.rot + (dir === 2 ? 2 : dir) + 4) % 4;
    const table = dir === 2 ? KICKS_180 : (p.type === 'I' ? KICKS_I : KICKS_JLSTZ);
    const kicks = table[`${p.rot}${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      if (!this.collides(p.type, to, p.x + kx, p.y + ky)) {
        p.x += kx; p.y += ky; p.rot = to;
        this.lastKick = i;
        this.lastRotate180 = dir === 2;
        this.afterMove(true);
        if (settings.dasCut) { this.dasTimer = 0; this.arrAcc = 0; }
        this.sfx('rotate');
        return true;
      }
    }
    return false;
  }

  softStep() {
    if (!this.fits(0, 1)) return false;
    this.piece.y++;
    this.lastMoveRotate = false;
    this.lockTimer = 0; // step reset: falling to a new row restarts the lock timer
    return true;
  }

  hardDrop() {
    const p = this.piece;
    if (!p) return;
    const target = this.ghostY();
    const dist = target - p.y;
    if (dist > 0) {
      const cols = {};
      for (const c of this.pieceCells()) {
        const col = cols[c.x] || (cols[c.x] = { x: c.x, y0: c.y, y1: c.y });
        col.y0 = Math.min(col.y0, c.y); col.y1 = Math.max(col.y1, c.y);
      }
      this.emit({ type: 'hard', piece: p.type, cells: Object.values(cols).map(c => ({ x: c.x, y0: c.y0, y1: c.y1 + dist })) });
      p.y = target;
      this.lastMoveRotate = false;
    }
    this.score += dist * 2;
    this.sfx('hard');
    this.shake = Math.max(this.shake, 0.08);
    this.lock();
  }

  hold() {
    if (!this.piece || !this.canHold) return;
    const cur = this.piece.type;
    const next = this.holdPiece;
    this.holdPiece = cur;
    this.canHold = false;
    this.sfx('hold');
    this.spawn(next || undefined);
  }

  /** 3-corner T-spin check. Returns null, 'mini' or 'full'. */
  detectSpin() {
    const p = this.piece;
    if (p.type !== 'T' || !this.lastMoveRotate) return null;
    const cx = p.x + 1, cy = p.y + 1;
    const occ = (x, y) => x < 0 || x >= COLS || y < 0 || y >= ROWS || !!this.board[y][x];
    const corners = [occ(cx - 1, cy - 1), occ(cx + 1, cy - 1), occ(cx + 1, cy + 1), occ(cx - 1, cy + 1)]; // TL TR BR BL
    if (corners.filter(Boolean).length < 3) return null;
    const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot];
    if (corners[front[0]] && corners[front[1]]) return 'full';
    // The last SRS kick (e.g. the "TST" kick) upgrades a mini to a full spin.
    if (!this.lastRotate180 && this.lastKick === 4) return 'full';
    return 'mini';
  }

  lock() {
    const p = this.piece;
    for (const [cx, cy] of SHAPES[p.type].states[p.rot]) this.board[p.y + cy][p.x + cx] = p.type;
    const spin = this.detectSpin();
    this.emit({ type: 'lock', cells: this.pieceCells() });
    const rows = this.clearLines();
    this.piece = null;
    this.pieces++;
    this.canHold = true;
    this.processClear(rows.length, spin);
    if (this.phase !== 'playing') return;
    if (rows.length === 0) {
      this.sfx('lock');
      this.applyGarbage();
      if (this.phase !== 'playing') return;
    }
    this.spawn();
  }

  processClear(n, spin) {
    const lvl = this.level;
    if (n === 0) {
      this.combo = -1;
      if (spin) {
        this.score += (spin === 'full' ? SCORE_TSPIN[0] : SCORE_TSPIN_MINI[0]) * lvl;
        this.popup(spin === 'full' ? 'T-SPIN' : 'T-SPIN MINI', PIECE_COLORS.T);
        this.emit({ type: 'spin' });
        this.sfx('spin');
      }
      return;
    }

    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const difficult = n === 4 || !!spin;
    if (difficult) this.b2b++; else this.b2b = -1;
    this.maxB2b = Math.max(this.maxB2b, this.b2b);
    const b2bBonus = difficult && this.b2b >= 1;

    let atk, base;
    if (spin === 'full') { atk = ATTACK_TSPIN[n]; base = SCORE_TSPIN[n]; this.stats.tspins++; }
    else if (spin === 'mini') { atk = ATTACK_TSPIN_MINI[n]; base = SCORE_TSPIN_MINI[n]; this.stats.tspins++; }
    else { atk = ATTACK_NORMAL[n]; base = SCORE_NORMAL[n]; }
    if (n === 4) this.stats.quads++;
    if (b2bBonus) { atk += ATTACK_B2B; base *= 1.5; }
    atk += comboAttack(this.combo);
    let score = base + 50 * this.combo;

    const pc = this.boardEmpty();
    if (pc) {
      atk += ATTACK_PC;
      score += (n === 4 && b2bBonus) ? SCORE_PC_B2B_QUAD : SCORE_PC[n];
      this.stats.pcs++;
    }
    this.score += Math.round(score * lvl);
    this.lines += n;

    // Popups
    const name = spin ? `T-SPIN ${spin === 'mini' ? 'MINI ' : ''}${CLEAR_NAMES[n]}` : CLEAR_NAMES[n];
    this.popup(name, spin ? PIECE_COLORS.T : (n === 4 ? PIECE_COLORS.I : '#e6e9f2'));
    if (b2bBonus) this.popup(`B2B ×${this.b2b}`, '#f2d544');
    if (this.combo >= 1) this.popup(`${this.combo} COMBO`, '#6ee7c8');
    if (pc) this.popup('PERFECT CLEAR', '#ffd36e', true);

    if (pc) this.emit({ type: 'pc' });
    if (spin) this.emit({ type: 'spin' });
    if (pc) this.sfx('pc');
    else if (spin) this.sfx('spin');
    this.sfx('clear', n);
    if (this.combo >= 1) this.sfx('combo', this.combo);

    // Attack: cancel incoming garbage first, send the rest.
    if (atk > 0) {
      this.attack += atk;
      let rem = atk;
      while (rem > 0 && this.incoming.length) {
        const g = this.incoming[0];
        const c = Math.min(g.lines, rem);
        g.lines -= c; rem -= c;
        this.stats.garbageCancelled += c;
        if (g.lines <= 0) this.incoming.shift();
      }
      if (rem > 0 && this.sendGarbage) this.sendGarbage(rem);
      this.emit({ type: 'attack', lines: atk, sent: this.sendGarbage ? rem : 0 });
      if (atk >= 4 && settings.shake) this.shake = Math.max(this.shake, Math.min(0.6, 0.15 + atk * 0.04));
    }

    // Mode progress
    if (this.mode === 'blitz') {
      const newLevel = Math.min(20, 1 + Math.floor(this.lines / BLITZ_LINES_PER_LEVEL));
      if (newLevel > this.level) { this.level = newLevel; this.popup(`LEVEL ${newLevel}`, '#8b7cf6'); }
    }
    if (this.mode === 'sprint' && this.lines >= SPRINT_LINES) this.finish();
  }

  /* ---------- garbage ---------- */
  receiveGarbage(lines) {
    if (lines <= 0 || this.phase === 'over' || this.phase === 'done') return;
    this.incoming.push({ lines, hole: Math.floor(this.rng() * COLS), readyAt: this.time + GARBAGE_DELAY });
    this.stats.garbageReceived += lines;
    this.emit({ type: 'garbage', lines });
    this.sfx('garbage');
  }
  incomingTotal() { return this.incoming.reduce((a, g) => a + g.lines, 0); }

  applyGarbage() {
    let cap = GARBAGE_CAP;
    let added = 0;
    while (cap > 0 && this.incoming.length && this.incoming[0].readyAt <= this.time) {
      const g = this.incoming[0];
      const n = Math.min(g.lines, cap);
      for (let i = 0; i < n; i++) {
        const top = this.board.shift();
        const row = Array(COLS).fill('G');
        row[g.hole] = null;
        this.board.push(row);
        if (top.some(Boolean)) { this.topOut(); return; }
      }
      added += n;
      g.lines -= n; cap -= n;
      if (g.lines <= 0) this.incoming.shift();
    }
    if (added && settings.shake) this.shake = Math.max(this.shake, 0.1 + added * 0.03);
  }

  /* ---------- input ---------- */
  input(type, action) { this.events.push({ type, action }); }
  releaseAll() {
    this.events = [];
    this.held = { left: false, right: false, soft: false };
    this.lastDir = null;
    this.dasTimer = 0;
    this.arrAcc = 0;
  }

  processEvents(active) {
    const evs = this.events;
    this.events = [];
    for (const { type, action } of evs) {
      if (type === 'down') {
        if (action === 'left' || action === 'right') {
          this.held[action] = true;
          this.lastDir = action; // last pressed direction wins
          this.dasTimer = 0;
          this.arrAcc = 0;
          if (active && this.piece && this.shift(action === 'left' ? -1 : 1)) this.sfx('move');
          continue;
        }
        if (action === 'soft') { this.held.soft = true; continue; }
        if (!active || !this.piece) continue;
        switch (action) {
          case 'hard': this.hardDrop(); break;
          case 'cw': this.rotate(1); break;
          case 'ccw': this.rotate(-1); break;
          case 'r180': this.rotate(2); break;
          case 'hold': this.hold(); break;
        }
        if (this.phase !== 'playing') return;
      } else {
        if (action === 'left' || action === 'right') {
          this.held[action] = false;
          if (this.lastDir === action) {
            const other = action === 'left' ? 'right' : 'left';
            this.lastDir = this.held[other] ? other : null;
            this.dasTimer = 0;
            this.arrAcc = 0;
          }
        } else if (action === 'soft') this.held.soft = false;
      }
    }
  }

  handleShift(active) {
    const dir = this.lastDir && this.held[this.lastDir] ? this.lastDir : null;
    if (!dir) return;
    const das = settings.das, arr = settings.arr;
    const prev = this.dasTimer;
    this.dasTimer += TICK_MS;
    if (!active || !this.piece || this.dasTimer < das) return;
    const dx = dir === 'left' ? -1 : 1;
    if (arr <= 0) { this.shift(dx, COLS); return; }
    // First auto-shift happens the moment DAS charges, then one every ARR ms.
    if (prev < das) this.arrAcc = arr + (this.dasTimer - das);
    else this.arrAcc += TICK_MS;
    const steps = Math.floor(this.arrAcc / arr);
    this.arrAcc -= steps * arr;
    if (steps > 0 && this.shift(dx, steps) < steps) this.arrAcc = 0;
  }

  handleGravity() {
    let g = this.mode === 'blitz' ? gravityForLevel(this.level) : gravityForLevel(1);
    const soft = this.held.soft;
    if (soft) g = settings.sdfInstant ? ROWS : g * Math.max(1, settings.sdf);
    this.gravAcc += g;
    while (this.gravAcc >= 1) {
      if (!this.softStep()) { this.gravAcc = 0; break; }
      this.gravAcc -= 1;
      if (soft) this.score += 1;
    }
  }

  handleLock() {
    if (!this.grounded()) return;
    this.touchedGround = true;
    this.lockTimer += TICK_MS;
    if (this.lockTimer >= LOCK_DELAY) this.lock();
  }

  /* ---------- fixed-timestep update ---------- */
  tick() {
    this.ticksAlive++;
    this.updateEffects();
    if (this.phase === 'countdown') {
      this.processEvents(false);
      this.handleShift(false); // DAS can be pre-charged during the countdown
      const shown = Math.ceil(this.countdown / 1000);
      if (shown !== this.lastCountShown) { this.lastCountShown = shown; this.sfx('count'); }
      this.countdown -= TICK_MS;
      if (this.countdown <= 0) {
        this.phase = 'playing';
        this.goTimer = 700;
        this.sfx('go');
        this.spawn();
      }
      return;
    }
    if (this.phase !== 'playing') return;
    this.time += TICK_MS;
    this.processEvents(true);
    if (this.phase === 'playing' && this.piece) this.handleShift(true);
    if (this.phase === 'playing' && this.piece) this.handleGravity();
    if (this.phase === 'playing' && this.piece) this.handleLock();
    if (this.phase === 'playing' && this.mode === 'blitz' && this.time >= BLITZ_MS) {
      this.time = BLITZ_MS;
      this.finish();
    }
  }

  updateEffects() {
    for (const p of this.popups) p.t += TICK_MS;
    this.popups = this.popups.filter(p => p.t < p.life);
    this.shake *= 0.86;
    if (this.shake < 0.01) this.shake = 0;
    if (this.goTimer > 0) this.goTimer -= TICK_MS;
  }

  popup(text, color, big = false) {
    this.popups.push({ text, color, big, t: 0, life: 1600 });
    if (this.net && this.net.popups.length < 16) this.net.popups.push([text, color, big ? 1 : 0]);
    if (this.popups.length > 6) this.popups.shift();
  }

  /* ---------- derived stats ---------- */
  get pps() { return this.time > 0 ? this.pieces / (this.time / 1000) : 0; }
  get apm() { return this.time > 0 ? this.attack / (this.time / 60000) : 0; }
}
