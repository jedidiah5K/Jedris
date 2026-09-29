'use strict';

/* =========================================================================
 * CPU OPPONENT
 * A bot that plays a normal Game through the same moves a player makes
 * (hold, rotate, shift, hard drop), so it follows the same rules, spins,
 * garbage and piece order.
 *
 * For each piece it tries every rotation and column for the current piece
 * (and the held one, on levels that use hold), scores the board it would
 * leave, then plays the best one, one move at a time at the level's speed.
 * Lower levels are slower and sometimes pick a worse spot on purpose.
 * ========================================================================= */
const CPU_LEVELS = [
  { id: 'noob',   name: 'NOOB',   desc: 'Slow and sloppy. Good for learning.', pps: 0.55, stepMs: 150, mistake: 0.45, hold: false, greed: 0, color: '#4dff9a' },
  { id: 'normal', name: 'NORMAL', desc: 'A steady player who clears lines.',   pps: 1.0,  stepMs: 95,  mistake: 0.15, hold: false, greed: 0, color: '#38e8ff' },
  { id: 'hard',   name: 'HARD',   desc: 'Quick, clean and uses hold.',          pps: 1.7,  stepMs: 60,  mistake: 0.04, hold: true,  greed: 0.6, color: '#ffd93d' },
  { id: 'master', name: 'MASTER', desc: 'Fast stacking that hunts for quads.',  pps: 2.5,  stepMs: 38,  mistake: 0,    hold: true,  greed: 1, color: '#ff9a3c' },
  { id: 'legend', name: 'LEGEND', desc: 'Relentless. Good luck.',               pps: 3.6,  stepMs: 22,  mistake: 0,    hold: true,  greed: 1.4, color: '#ff4d6a' },
];

class CpuPlayer {
  /**
   * @param {Game} game   the board this bot controls
   * @param {object} level one of CPU_LEVELS
   * @param {() => number} [rng]
   */
  constructor(game, level, rng = Math.random) {
    this.game = game;
    this.level = level;
    this.rng = rng;
    this.plan = null;
    this.wait = 0;
    this.pieceSeen = -1;
  }

  /** Called every tick with the elapsed time in ms. */
  update(dt) {
    const g = this.game;
    if (g.phase !== 'playing' || !g.piece) { this.plan = null; return; }
    if (this.pieceSeen !== g.pieces || !this.plan) {
      this.pieceSeen = g.pieces;
      this.plan = this.makePlan();
      // Spread the moves over the level's pieces-per-second budget.
      const budget = 1000 / this.level.pps;
      this.wait = Math.max(this.level.stepMs, budget - this.plan.steps * this.level.stepMs);
    }
    this.wait -= dt;
    while (this.wait <= 0 && this.plan && g.phase === 'playing' && g.piece) {
      const piecesBefore = g.pieces;
      this.step();
      this.wait += this.level.stepMs;
      if (g.pieces !== piecesBefore) { this.plan = null; break; }
    }
  }

  step() {
    const g = this.game, p = this.plan;
    if (p.hold) {
      p.hold = false;
      g.hold();
      if (!g.piece || g.piece.type !== p.type) this.plan = this.makePlan(false);
      return;
    }
    if (p.rotations > 0) {
      p.rotations = 0;
      g.rotate(p.rotDir);
      return;
    }
    const dx = Math.sign(p.x - g.piece.x);
    if (dx !== 0 && g.shift(dx, 1)) return;
    g.hardDrop();
  }

  /** Picks where the current (or held) piece should go. */
  makePlan(allowHold = true) {
    const g = this.game;
    const options = [{ type: g.piece.type, hold: false, x0: g.piece.x, y0: g.piece.y }];
    if (allowHold && this.level.hold && g.canHold) {
      const alt = g.holdPiece || g.queue[0];
      if (alt && alt !== g.piece.type) options.push({ type: alt, hold: true, x0: alt === 'O' ? 4 : 3, y0: 1 });
    }
    const cands = [];
    for (const o of options) {
      const rots = o.type === 'O' ? [0] : [0, 1, 2, 3];
      for (const rot of rots) {
        for (let x = -3; x < COLS; x++) {
          const c = this.place(o, rot, x);
          if (c) cands.push(c);
        }
      }
    }
    if (!cands.length) return { hold: false, type: g.piece.type, rotations: 0, rotDir: 1, x: g.piece.x, steps: 1 };
    cands.sort((a, b) => b.score - a.score);
    let pick = cands[0];
    if (this.rng() < this.level.mistake) {
      const pool = Math.max(1, Math.floor(cands.length * (this.level.mistake > 0.3 ? 0.6 : 0.25)));
      pick = cands[Math.floor(this.rng() * pool)];
    }
    const turn = pick.rot; // from spawn rotation 0
    const rotDir = turn === 1 ? 1 : turn === 3 ? -1 : 2;
    const steps = (pick.hold ? 1 : 0) + (turn ? 1 : 0) + Math.abs(pick.x - pick.x0) + 1;
    return { hold: pick.hold, type: pick.type, rotations: turn ? 1 : 0, rotDir, x: pick.x, x0: pick.x0, steps };
  }

  /** Drops a piece at (rot, x) on a copy of the board; null if it can't get there. */
  place(o, rot, x) {
    const g = this.game;
    const y0 = o.y0;
    if (g.collides(o.type, rot, x, y0)) return null;
    // The path along the top row must be clear.
    const dir = Math.sign(x - o.x0);
    for (let cx = o.x0; cx !== x; cx += dir) if (g.collides(o.type, rot, cx, y0)) return null;
    let y = y0;
    while (!g.collides(o.type, rot, x, y + 1)) y++;
    const board = g.board.map(r => r.map(Boolean));
    for (const [cx, cy] of SHAPES[o.type].states[rot]) board[y + cy][x + cx] = true;
    return { type: o.type, hold: o.hold, rot, x, x0: o.x0, score: this.evaluate(board, y) };
  }

  evaluate(board, landY) {
    let lines = 0;
    const rows = board.filter(r => { const full = r.every(Boolean); if (full) lines++; return !full; });
    while (rows.length < ROWS) rows.unshift(Array(COLS).fill(false));
    const heights = [];
    let holes = 0;
    for (let x = 0; x < COLS; x++) {
      let top = ROWS;
      for (let y = 0; y < ROWS; y++) if (rows[y][x]) { top = y; break; }
      heights.push(ROWS - top);
      for (let y = top + 1; y < ROWS; y++) if (!rows[y][x]) holes++;
    }
    const greed = this.level.greed;
    // Greedy levels keep the right column open as a well and wait for an I
    // piece to clear four lines at once (a quad sends the most garbage).
    const well = greed > 0 ? COLS - 1 : -1;
    let agg = 0, bump = 0, maxH = 0;
    for (let x = 0; x < COLS; x++) {
      agg += heights[x];
      maxH = Math.max(maxH, heights[x]);
      if (x && x !== well && x - 1 !== well) bump += Math.abs(heights[x] - heights[x - 1]);
    }
    const safe = maxH < 11;
    const building = well >= 0 && safe;
    let score = (building ? -0.51 + 0.3 * Math.min(1, greed) : -0.51) * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump;
    if (building) {
      const others = Math.min(...heights.filter((_, x) => x !== well));
      score -= Math.max(0, heights[well] - others + 1) * 0.9 * greed; // don't fill the well
      score += greed * [0, -1.2, -1, 0.8, 7][lines];
    }
    if (maxH > 12) score -= (maxH - 12) * 1.5;
    score -= (ROWS - landY) * 0.02;
    return score;
  }
}
