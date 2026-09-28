'use strict';

/* =========================================================================
 * PIECE DATA & KICKS
 * Coordinates are (x right, y down). Rotation states: 0 spawn, 1 R, 2 180, 3 L.
 * ========================================================================= */
const PIECE_TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
const PIECE_COLORS = {
  I: '#2de2ff', J: '#4466ff', L: '#ff8a2d', O: '#ffd93d',
  S: '#3dff8a', T: '#b44dff', Z: '#ff3d6a', G: '#48526a',
};
const BASE_SHAPES = {
  I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
};
// Rotating each shape around its bounding-box centre yields the SRS states.
const SHAPES = {};
for (const t of PIECE_TYPES) {
  const { n, cells } = BASE_SHAPES[t];
  const states = [cells];
  for (let r = 1; r < 4; r++) states.push(states[r - 1].map(([x, y]) => [n - 1 - y, x]));
  SHAPES[t] = { n, states };
}

// Kick tables written in the usual SRS notation (y up) and converted to y down.
const flipY = (table) => {
  const out = {};
  for (const k in table) out[k] = table[k].map(([x, y]) => [x, -y]);
  return out;
};
const KICKS_JLSTZ = flipY({
  '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
});
const KICKS_I = flipY({
  '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
});
// 180° kicks (modern SRS+ style table), used for every piece.
const KICKS_180 = flipY({
  '02': [[0, 0], [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]],
  '20': [[0, 0], [0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]],
  '13': [[0, 0], [1, 0], [1, 2], [1, 1], [0, 2], [0, 1]],
  '31': [[0, 0], [-1, 0], [-1, 2], [-1, 1], [0, 2], [0, 1]],
});

/* =========================================================================
 * SCORING & ATTACK TABLES
 * ========================================================================= */
const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];
const ATTACK_NORMAL = [0, 0, 1, 2, 4];
const ATTACK_TSPIN = [0, 2, 4, 6];
const ATTACK_TSPIN_MINI = [0, 0, 1, 2];
const ATTACK_B2B = 1;
const ATTACK_PC = 10;
const COMBO_TABLE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5]; // indexed by combo count (0 = first clear)
const SCORE_NORMAL = [0, 100, 300, 500, 800];
const SCORE_TSPIN = [400, 800, 1200, 1600];
const SCORE_TSPIN_MINI = [100, 200, 400, 400];
const SCORE_PC = [0, 800, 1200, 1800, 2000];
const SCORE_PC_B2B_QUAD = 3200;

function comboAttack(combo) {
  if (combo < 0) return 0;
  return combo < COMBO_TABLE.length ? COMBO_TABLE[combo] : COMBO_TABLE[COMBO_TABLE.length - 1];
}
function gravityForLevel(level) {
  // Guideline curve: seconds per row = (0.8 - (L-1) * 0.007)^(L-1); returned as rows per tick.
  const L = Math.max(1, Math.min(20, level));
  const secPerRow = Math.pow(0.8 - (L - 1) * 0.007, L - 1);
  return (TICK_MS / 1000) / secPerRow;
}

/* =========================================================================
 * RANDOM
 * ========================================================================= */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randomSeed = () => (Math.random() * 4294967296) >>> 0;
