'use strict';

/* =========================================================================
 * RENDERING
 * Layout units are cells; one player's area is UNIT_W x UNIT_H cells.
 * Blocks are pre-rendered into cached glow sprites so the neon look stays cheap.
 * ========================================================================= */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const UNIT_W = 21.8, UNIT_H = 24.4, UNIT_GAP = 3.2;
const HOLD_W = 5, METER_X = 5.4, METER_W = 0.42, BOARD_X = 6.2, NEXT_X = 16.8, BOARD_Y = 3.6;
const NEXT_SPACING = 2.35;
const FONT_D = '"Orbitron", "Segoe UI", system-ui, sans-serif';
const FONT_U = '"Rajdhani", "Segoe UI", system-ui, sans-serif';
const ACCENTS = ['#38e8ff', '#ff4fd8'];
const HAS_LETTER_SPACING = 'letterSpacing' in ctx;
let VIEW_W = innerWidth, VIEW_H = innerHeight;
const globalFx = []; // attack projectiles travelling between boards (screen space)
let globalParts = []; // comet sparks and impact bursts (screen space)

/* ---------- effects quality ---------- */
// Ultra / Standard / Minimal, chosen in Config. If frames stay slow for a couple of
// seconds in game, effects step down on their own for the rest of the session.
const FX_LEVELS = ['minimal', 'standard', 'ultra'];
const FX_PARTICLE_CAP = [80, 350, 700];
const FX_PARTICLE_MUL = [0.25, 0.6, 1];
let fxDownshift = 0, slowFor = 0, avgFrameMs = 16;
function fxLevel() {
  const i = FX_LEVELS.indexOf(settings.fx);
  return Math.max(0, (i < 0 ? 2 : i) - fxDownshift);
}
function trackFrameRate(rawMs, dt, inGame) {
  if (!inGame || rawMs > 100) return;
  avgFrameMs = avgFrameMs * 0.95 + rawMs * 0.05;
  slowFor = avgFrameMs > 22 ? slowFor + dt : 0;
  if (slowFor > 2 && fxLevel() > 0) { fxDownshift++; slowFor = 0; avgFrameMs = 16; }
}

/* Screen-wide reactions: a tinted flash, the floor grid pulse and the shared "energy". */
const screenFx = { flash: 0, flashColor: '#38e8ff', pulse: 0, energy: 0, gridPhase: 0, danger: 0 };
function screenFlash(color, strength) {
  if (!settings.flash || fxLevel() === 0) return;
  if (strength >= screenFx.flash) { screenFx.flash = Math.min(0.3, strength); screenFx.flashColor = color; }
}
// The pointer tilts the background a little on the menu.
const pointer = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5 };
window.addEventListener('pointermove', (e) => { pointer.x = e.clientX / VIEW_W; pointer.y = e.clientY / VIEW_H; }, { passive: true });

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  VIEW_W = innerWidth; VIEW_H = innerHeight;
  canvas.width = Math.round(VIEW_W * dpr);
  canvas.height = Math.round(VIEW_H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  spriteCache.clear();
}
const spriteCache = new Map();
window.addEventListener('resize', resizeCanvas);

/* ---------- small drawing helpers ---------- */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function chamfer(x, y, w, h, cut) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.closePath();
}
function setFont(weight, size, family, spacing = 0) {
  ctx.font = `${weight} ${size}px ${family}`;
  if (HAS_LETTER_SPACING) ctx.letterSpacing = `${spacing}px`;
}
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/* ---------- block sprites ---------- */
function blockSprite(type, size, glow) {
  const key = `${type}|${size}|${glow}`;
  let c = spriteCache.get(key);
  if (c) return c;
  if (spriteCache.size > 300) spriteCache.clear();
  const dpr = window.devicePixelRatio || 1;
  const pad = Math.ceil(size * 0.45);
  c = document.createElement('canvas');
  c.width = Math.ceil((size + pad * 2) * dpr);
  c.height = c.width;
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  const col = PIECE_COLORS[type];
  const inset = Math.max(0.5, size * 0.035);
  const r = size * 0.16;
  const w = size - inset * 2;
  x.save();
  if (glow && type !== 'G') { x.shadowColor = col; x.shadowBlur = size * (glow === 2 ? 0.75 : 0.32); }
  const grad = x.createLinearGradient(pad, pad, pad + size, pad + size);
  grad.addColorStop(0, shade(col, 0.4));
  grad.addColorStop(0.45, col);
  grad.addColorStop(1, shade(col, -0.45));
  x.fillStyle = grad;
  rr(x, pad + inset, pad + inset, w, w, r);
  x.fill();
  x.restore();
  // glossy top highlight
  const gloss = x.createLinearGradient(0, pad, 0, pad + size * 0.55);
  gloss.addColorStop(0, 'rgba(255,255,255,0.38)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gloss;
  rr(x, pad + inset * 2.5, pad + inset * 2.5, w - inset * 3, size * 0.46, r * 0.7);
  x.fill();
  // bright rim
  x.globalAlpha = 0.75;
  x.strokeStyle = shade(col, 0.65);
  x.lineWidth = Math.max(1, size * 0.05);
  rr(x, pad + inset + 0.5, pad + inset + 0.5, w - 1, w - 1, r);
  x.stroke();
  // tech "core" inlay
  x.globalAlpha = type === 'G' ? 0.15 : 0.32;
  x.strokeStyle = '#ffffff';
  x.lineWidth = Math.max(1, size * 0.04);
  const ci = size * 0.33;
  rr(x, pad + ci, pad + ci, size - ci * 2, size - ci * 2, size * 0.05);
  x.stroke();
  c._pad = pad;
  spriteCache.set(key, c);
  return c;
}
function drawBlock(x, y, s, type, alpha = 1, glow = 1) {
  const sp = blockSprite(type, s, glow);
  ctx.globalAlpha = alpha;
  ctx.drawImage(sp, x - sp._pad, y - sp._pad, s + sp._pad * 2, s + sp._pad * 2);
  ctx.globalAlpha = 1;
}
function drawGhostBlock(x, y, s, type) {
  const col = PIECE_COLORS[type];
  ctx.fillStyle = rgba(col, 0.13);
  ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
  ctx.strokeStyle = rgba(col, 0.7);
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeRect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8);
}
function drawMiniPiece(type, cx, cy, s, dim) {
  const cells = SHAPES[type].states[0];
  const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = (maxX - minX + 1) * s, h = (maxY - minY + 1) * s;
  for (const [x, y] of cells) {
    const px = Math.round(cx - w / 2 + (x - minX) * s), py = Math.round(cy - h / 2 + (y - minY) * s);
    if (dim) drawBlock(px, py, s, 'G', 0.55, 0);
    else drawBlock(px, py, s, type, 1, 1);
  }
}

/* ---------- animated background ---------- */
// Deep space: drifting aurora clouds, a parallax starfield, a neon floor grid that
// pulses and speeds up with play, and outlined pieces floating upward.
const STARS = Array.from({ length: 150 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), tw: Math.random() * 6.3 }));
const DEBRIS = Array.from({ length: 24 }, (_, i) => ({
  x: Math.random(), y: Math.random(), z: Math.random(), r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.4,
  type: PIECE_TYPES[i % 7],
}));
const AURORA = [
  { c: '#9a6bff', x: 0.18, y: 0.22, r: 0.6, sp: 0.05, ph: 0 },
  { c: '#38e8ff', x: 0.82, y: 0.18, r: 0.5, sp: 0.07, ph: 2 },
  { c: '#ff4fd8', x: 0.55, y: 0.52, r: 0.42, sp: 0.04, ph: 4 },
];
const GRID_CALM = [56, 232, 255], GRID_HOT = [255, 79, 216];
function drawBackground(t, inGame, dt) {
  const W = VIEW_W, H = VIEW_H;
  const lvl = fxLevel();
  const E = screenFx.energy;
  pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 3);
  pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 3);
  const px = inGame ? 0 : pointer.sx - 0.5, py = inGame ? 0 : pointer.sy - 0.5;
  const g = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, Math.max(W, H) * 0.85);
  g.addColorStop(0, '#0c1838');
  g.addColorStop(0.45, '#060b1d');
  g.addColorStop(1, '#010207');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const strength = inGame ? 0.45 : 1;
  const hz = H * 0.64;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Aurora clouds
  if (lvl > 0) {
    const R = Math.max(W, H);
    for (const a of AURORA) {
      const cx = (a.x + Math.sin(t * a.sp + a.ph) * 0.08 - px * 0.08) * W;
      const cy = (a.y + Math.cos(t * a.sp * 1.3 + a.ph) * 0.06 - py * 0.08) * H;
      const r = a.r * R;
      const ag = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      ag.addColorStop(0, rgba(a.c, (0.12 + E * 0.1) * strength));
      ag.addColorStop(1, rgba(a.c, 0));
      ctx.fillStyle = ag;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  // Stars in three depths, twinkling and drifting toward the horizon
  const nStars = lvl === 2 ? STARS.length : lvl === 1 ? 80 : 30;
  for (let i = 0; i < nStars; i++) {
    const st = STARS[i];
    const y = ((st.y + t * 0.006 * (0.3 + st.z)) % 1) * hz;
    const x = ((st.x - px * 0.05 * (0.3 + st.z)) % 1 + 1) % 1 * W;
    const a = (0.2 + 0.6 * st.z) * (0.55 + 0.45 * Math.sin(t * 2 + st.tw)) * (inGame ? 0.6 : 1);
    const sz = 0.6 + st.z * 1.7;
    ctx.fillStyle = `rgba(200,230,255,${a})`;
    ctx.fillRect(x, y, sz, sz);
  }
  ctx.restore();

  // Perspective grid floor scrolling towards the viewer; faster and hotter with energy
  screenFx.gridPhase = (screenFx.gridPhase + dt * (0.6 + E * 1.8)) % 1;
  const vx = W / 2 - px * W * 0.08;
  const col = GRID_CALM.map((v, i) => Math.round(v + (GRID_HOT[i] - v) * Math.min(1, E * 1.2))).join(',');
  const glow = Math.min(1, strength * (1 + screenFx.pulse * 0.9));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, hz, W, H - hz);
  ctx.clip();
  const fade = ctx.createLinearGradient(0, hz, 0, H);
  fade.addColorStop(0, `rgba(${col},0)`);
  fade.addColorStop(1, `rgba(${col},${0.35 * glow})`);
  ctx.strokeStyle = fade;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const near = W / 9;
  for (let i = -14; i <= 14; i++) {
    ctx.moveTo(vx + i * near * 0.06, hz);
    ctx.lineTo(W / 2 + i * near * 1.6, H);
  }
  const phase = screenFx.gridPhase;
  for (let k = 0; k < 26; k++) {
    const z = 1 + k - phase;
    const y = hz + (H - hz) * (1 / z) * 0.9;
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.restore();
  // Horizon glow
  const hg = ctx.createLinearGradient(0, 0, W, 0);
  hg.addColorStop(0, 'rgba(154,107,255,0)');
  hg.addColorStop(0.5, `rgba(${col},${0.55 * glow})`);
  hg.addColorStop(1, 'rgba(255,79,216,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, hz - 1, W, 2 + screenFx.pulse * 2);
  const haze = ctx.createLinearGradient(0, hz - H * 0.14, 0, hz);
  haze.addColorStop(0, 'rgba(154,107,255,0)');
  haze.addColorStop(1, `rgba(154,107,255,${0.12 * glow + E * 0.06})`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, hz - H * 0.14, W, H * 0.14);

  // Outlined pieces floating upward
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1;
  const nDebris = lvl === 0 ? 8 : DEBRIS.length;
  for (let i = 0; i < nDebris; i++) {
    const b = DEBRIS[i];
    const y = ((b.y - t * 0.012 * (0.3 + b.z)) % 1 + 1) % 1;
    const x = b.x + Math.sin(t * 0.2 + b.r * 4) * 0.01 - px * 0.06 * (0.3 + b.z);
    const cs = 3 + b.z * 7;
    ctx.save();
    ctx.translate(x * W, y * H - py * 30 * b.z);
    ctx.rotate(b.r + t * b.vr);
    ctx.strokeStyle = rgba(PIECE_COLORS[b.type], (0.07 + b.z * 0.2) * strength);
    for (const [cx, cy] of SHAPES[b.type].states[0]) ctx.strokeRect((cx - 1.5) * cs, (cy - 1) * cs, cs, cs);
    ctx.restore();
  }
  ctx.restore();
}

/* ---------- per-game visual effects (particles, trails, rings, titles) ---------- */
// Each board keeps an "energy" (0-1) that rises with clears, combos, B2B and attacks
// and decays slowly; it drives the frame light, the floor grid and the aurora.
function vfx(g) {
  if (!g._vfx) {
    g._vfx = {
      parts: [], trails: [], rings: [], bands: [], impacts: [], vortex: [], after: [],
      lockFlash: null, pc: 0, meterPulse: 0, energy: 0, title: null, pillar: 0, b2bArc: 0, comboMark: null,
      garbFlash: 0, wave: 0, spawnT: 1, spawnKey: '', lastPos: null, lastLock: null, lastPhase: null, lastLevel: 1, goFired: false,
    };
  }
  return g._vfx;
}
function addPart(V, p) {
  if (V.parts.length < FX_PARTICLE_CAP[fxLevel()]) V.parts.push(p);
}
/** n scaled by the effects level, rounded randomly so small counts still show up. */
function fxCount(n) {
  const m = n * FX_PARTICLE_MUL[fxLevel()];
  return Math.floor(m) + (Math.random() < m % 1 ? 1 : 0);
}
const COMBO_COLORS = ['#4dff9a', '#38e8ff', '#9a6bff', '#ff4fd8', '#ffd66e'];
const comboColor = (n) => COMBO_COLORS[Math.min(4, Math.floor((n - 1) / 3))];

function consumeFx(g, L) {
  const V = vfx(g);
  const s = L.s;
  const rowY = (r) => L.by + (r - HIDDEN_ROWS) * s;
  let cleared = 0, spin = false, pc = false;
  for (const ev of g.fx) {
    switch (ev.type) {
      case 'clear':
        for (const row of ev.rows || []) {
          cleared++;
          V.bands.push({ y: rowY(row.y), t: 0 });
          row.cells.forEach((type, c) => {
            if (!type) return;
            const color = PIECE_COLORS[type] || PIECE_COLORS.G;
            for (let k = fxCount(3); k > 0; k--) {
              addPart(V, {
                x: L.bx + (c + 0.5) * s, y: rowY(row.y) + s / 2,
                vx: ((c - 4.5) / 4.5) * rand(3, 10) * s + rand(-1.5, 1.5) * s, vy: rand(-7, -1) * s,
                life: rand(0.45, 0.9), max: 0.9, size: s * rand(0.12, 0.3), color, streak: k === 1,
              });
            }
          });
        }
        break;
      case 'hard': {
        const color = PIECE_COLORS[ev.piece] || PIECE_COLORS.G;
        V.trails.push({ cells: ev.cells, color, t: 0 });
        let x0 = COLS, x1 = 0, yb = 0;
        for (const c of ev.cells) {
          x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x + 1); yb = Math.max(yb, c.y1);
          for (let k = fxCount(4); k > 0; k--) {
            addPart(V, { x: L.bx + (c.x + rand(0.1, 0.9)) * s, y: rowY(c.y1) + s, vx: rand(-3, 3) * s, vy: rand(-5, -1) * s,
              life: rand(0.2, 0.45), max: 0.45, size: s * rand(0.08, 0.16), color });
          }
        }
        if (fxLevel() > 0) V.impacts.push({ x0, x1, y: yb + 1, color, t: 0 });
        break;
      }
      case 'lock':
        V.lockFlash = { cells: ev.cells, t: 0 };
        if (ev.cells && ev.cells.length) {
          V.lastLock = { x: ev.cells.reduce((a, c) => a + c.x, 0) / ev.cells.length, y: ev.cells.reduce((a, c) => a + c.y, 0) / ev.cells.length };
        }
        break;
      case 'pc':
        pc = true;
        V.pc = 1.9;
        for (let k = fxCount(110); k > 0; k--) {
          const a = rand(0, Math.PI * 2), sp = rand(3, 15) * s;
          addPart(V, { x: L.bx + L.bw / 2, y: L.by + L.bh / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: rand(0.6, 1.4), max: 1.4, size: s * rand(0.12, 0.3), color: PIECE_COLORS[PIECE_TYPES[k % 7]], streak: k % 3 === 0 });
        }
        V.rings.push({ t: 0, color: '#ffd66e', big: true });
        screenFlash('#ffd66e', 0.24);
        break;
      case 'spin':
        spin = true;
        V.rings.push({ t: 0, color: PIECE_COLORS[g.spinPiece] || PIECE_COLORS.T, big: false });
        if (V.lastLock && fxLevel() > 0) V.vortex.push({ x: V.lastLock.x, y: V.lastLock.y, color: PIECE_COLORS[g.spinPiece] || PIECE_COLORS.T, t: 0 });
        break;
      case 'attack': {
        V.energy = Math.min(1, V.energy + Math.min(0.3, (ev.lines || 0) * 0.04));
        if (ev.lines >= 4) V.rings.push({ t: 0, color: ev.lines >= 8 ? '#ffd66e' : '#38e8ff', big: true });
        const target = App.games.find(o => o !== g);
        if (target && ev.sent > 0) globalFx.push({ from: g, to: target, t: 0, lines: ev.sent, color: ACCENTS[App.games.indexOf(g)] || '#38e8ff' });
        break;
      }
      case 'garbage':
        V.meterPulse = 1;
        V.garbFlash = 1;
        break;
    }
  }
  g.fx.length = 0;
  if (cleared) onClear(g, V, cleared, spin, pc);
}
/** The big reactions to a line clear, scaled by how impressive it was. */
function onClear(g, V, n, spin, pc) {
  const combo = Math.max(0, g.combo | 0), b2b = Math.max(0, g.b2b | 0);
  V.energy = Math.min(1, V.energy + 0.08 * n + (spin ? 0.15 : 0) + combo * 0.03 + (b2b ? 0.08 : 0));
  screenFx.pulse = Math.min(1.6, screenFx.pulse + 0.2 * n + (spin ? 0.3 : 0) + combo * 0.05);
  if (combo >= 1) V.comboMark = { n: combo, t: 0 };
  if (combo >= 5) V.rings.push({ t: 0, color: comboColor(combo), big: false });
  if (b2b >= 1 && (n === 4 || spin)) V.b2bArc = 0.9;
  if (pc) return; // the perfect clear has its own title
  if (n === 4) {
    V.title = { text: 'QUAD', sub: b2b >= 1 ? `B2B ×${b2b}` : '', color: PIECE_COLORS.I, t: 0, life: 1.1 };
    V.pillar = 1;
    V.rings.push({ t: 0, color: '#38e8ff', big: true });
    screenFlash('#38e8ff', 0.18);
  } else if (spin && n >= 2) {
    const p = PIECE_COLORS[g.spinPiece] ? g.spinPiece : 'T';
    V.title = { text: `${p}-SPIN`, sub: CLEAR_NAMES[n], color: PIECE_COLORS[p], t: 0, life: 1.1 };
    screenFlash(PIECE_COLORS[p], 0.12);
  }
}
/** Spawns, moves, phase and level changes, noticed by comparing with last frame. */
function trackState(g, V, L) {
  const p = g.piece;
  if (p) {
    const key = `${g.pieces}|${p.type}`;
    if (key !== V.spawnKey) { V.spawnKey = key; V.spawnT = 0; V.lastPos = null; }
    // Afterimages when the piece moves sideways or rotates (Ultra, your own board)
    if (!g.remote && fxLevel() === 2) {
      const lp = V.lastPos;
      if (lp && (lp.x !== p.x || lp.rot !== p.rot) && V.after.length < 6) V.after.push({ type: p.type, rot: lp.rot, x: lp.x, y: lp.y, t: 0 });
      V.lastPos = { x: p.x, y: p.y, rot: p.rot };
    }
  }
  if (g.phase !== V.lastPhase) {
    if (g.phase === 'done' && V.lastPhase === 'playing' && fxLevel() > 0) {
      for (let k = fxCount(140); k > 0; k--) {
        addPart(V, { x: L.bx + rand(0, L.bw), y: L.by + rand(-2, 1) * L.s, vx: rand(-2, 2) * L.s, vy: rand(-2, 4) * L.s,
          life: rand(1.4, 2.4), max: 2.4, size: L.s * rand(0.15, 0.32), color: PIECE_COLORS[PIECE_TYPES[k % 7]], grav: 0.18 });
      }
      V.rings.push({ t: 0, color: '#4dff9a', big: true });
    }
    if (g.phase === 'countdown') V.goFired = false;
    V.lastPhase = g.phase;
  }
  if (g.goTimer > 0 && !V.goFired) { V.goFired = true; V.rings.push({ t: 0, color: '#4dff9a', big: true }); }
  if (g.level > V.lastLevel) V.wave = 1;
  V.lastLevel = g.level;
}
function updateVfx(g, dt, s) {
  const V = vfx(g);
  for (const p of V.parts) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 32 * s * dt * (p.grav || 1);
    p.vx *= 0.985;
    p.life -= dt;
  }
  V.parts = V.parts.filter(p => p.life > 0);
  for (const tr of V.trails) tr.t += dt;
  V.trails = V.trails.filter(tr => tr.t < 0.28);
  for (const r of V.rings) r.t += dt;
  V.rings = V.rings.filter(r => r.t < 0.7);
  for (const b of V.bands) b.t += dt;
  V.bands = V.bands.filter(b => b.t < 0.3);
  for (const im of V.impacts) im.t += dt;
  V.impacts = V.impacts.filter(im => im.t < 0.25);
  for (const v of V.vortex) v.t += dt;
  V.vortex = V.vortex.filter(v => v.t < 0.7);
  for (const a of V.after) a.t += dt;
  V.after = V.after.filter(a => a.t < 0.12);
  if (V.lockFlash) { V.lockFlash.t += dt; if (V.lockFlash.t > 0.15) V.lockFlash = null; }
  if (V.comboMark && (V.comboMark.t += dt) > 1.4) V.comboMark = null;
  if (V.title && (V.title.t += dt) > V.title.life) V.title = null;
  V.pc = Math.max(0, V.pc - dt);
  V.meterPulse = Math.max(0, V.meterPulse - dt * 2.5);
  V.pillar = Math.max(0, V.pillar - dt * 2.6);
  V.b2bArc = Math.max(0, V.b2bArc - dt);
  V.garbFlash = Math.max(0, V.garbFlash - dt * 3);
  V.wave = Math.max(0, V.wave - dt * 1.4);
  V.spawnT += dt;
  V.energy = Math.max(0, V.energy - dt * 0.12);
}

/* Chromatic-split title text: cyan and magenta ghosts either side of a white core. */
function drawSplitText(text, cx, cy, size, color, maxW, alpha, split) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(900, size, FONT_D, size * 0.08);
  ctx.globalAlpha = alpha;
  if (split > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(56,232,255,0.75)';
    ctx.fillText(text, cx - split, cy, maxW);
    ctx.fillStyle = 'rgba(255,79,216,0.75)';
    ctx.fillText(text, cx + split, cy, maxW);
    ctx.restore();
  }
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.6;
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy, maxW);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(text, cx, cy, maxW);
  ctx.globalAlpha = 1;
}
/** A jagged lightning bolt from (x, y0) to (x, y1), wandering sideways by up to amp. */
function bolt(x, y0, y1, amp) {
  const segs = 10;
  ctx.moveTo(x, y0);
  for (let i = 1; i <= segs; i++) ctx.lineTo(x + (i < segs ? rand(-amp, amp) : 0), y0 + (y1 - y0) * i / segs);
}

/* ---------- HUD pieces ---------- */
function hudPanel(x, y, w, h, label, s, accent) {
  chamfer(x, y, w, h, s * 0.55);
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, 'rgba(8,14,30,0.9)');
  bg.addColorStop(1, 'rgba(4,8,18,0.85)');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.28);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y + s * 0.3, s * 0.12, s * 0.55);
  setFont(700, s * 0.44, FONT_D, s * 0.12);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c9d6ee';
  ctx.fillText(label, x + s * 0.35, y + s * 0.6);
}

function fmtTime(ms) {
  ms = Math.max(0, ms);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
}

function drawStat(x, y, align, label, value, sub, s, accent, big) {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  setFont(700, s * 0.4, FONT_U, s * 0.14);
  ctx.fillStyle = '#7f8ea8';
  ctx.fillText(label, x, y);
  const vs = s * (big ? 0.95 : 0.7);
  setFont(700, vs, FONT_D, 0);
  const vw = ctx.measureText(value).width;
  let subW = 0;
  if (sub) { setFont(700, vs * 0.55, FONT_D, 0); subW = ctx.measureText(sub).width; }
  const baseY = y + vs + s * 0.12;
  const startX = align === 'right' ? x - vw - subW : x;
  ctx.textAlign = 'left';
  setFont(700, vs, FONT_D, 0);
  ctx.fillStyle = '#f2f7ff';
  ctx.shadowColor = rgba(accent, 0.6);
  ctx.shadowBlur = s * 0.3;
  ctx.fillText(value, startX, baseY);
  ctx.shadowBlur = 0;
  if (sub) {
    setFont(700, vs * 0.55, FONT_D, 0);
    ctx.fillStyle = '#9fb0cc';
    ctx.fillText(sub, startX + vw, baseY);
  }
}

function drawCenterText(text, cx, cy, size, color, maxW, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(900, size, FONT_D, size * 0.06);
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy, maxW);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(text, cx, cy, maxW);
  ctx.globalAlpha = 1;
}

/* ---------- one player's board + HUD ---------- */
function drawPlayer(g, L, header, t, dt) {
  const s = L.s;
  const ox = L.x, oy = L.y;
  const bx = ox + BOARD_X * s, by = oy + BOARD_Y * s;
  const bw = COLS * s, bh = VISIBLE_ROWS * s;
  const accent = header.accent;
  Object.assign(L, { bx, by, bw, bh });
  g._L = L;
  consumeFx(g, L);
  updateVfx(g, dt, s);
  const V = vfx(g);
  trackState(g, V, L);
  const lvl = fxLevel();
  const rowY = (r) => by + (r - HIDDEN_ROWS) * s;

  ctx.save();
  if (g.shake > 0 && settings.shake) {
    ctx.translate((Math.random() - 0.5) * g.shake * s * 2, (Math.random() - 0.5) * g.shake * s * 2);
  }

  // Header
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  setFont(900, s * 0.72, FONT_D, s * 0.25);
  ctx.fillStyle = '#eef5ff';
  ctx.shadowColor = accent;
  ctx.shadowBlur = s * 0.6;
  ctx.fillText(header.name, bx + bw / 2, oy + s * 0.55);
  ctx.shadowBlur = 0;
  if (header.wins != null) {
    for (let i = 0; i < VERSUS_WINS; i++) {
      const px = bx + bw / 2 - (VERSUS_WINS - 1) * 0.55 * s + i * 1.1 * s, py = oy + s * 1.45;
      ctx.beginPath();
      ctx.moveTo(px, py - s * 0.28); ctx.lineTo(px + s * 0.28, py); ctx.lineTo(px, py + s * 0.28); ctx.lineTo(px - s * 0.28, py);
      ctx.closePath();
      if (i < header.wins) { ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = s * 0.5; ctx.fill(); ctx.shadowBlur = 0; }
      else { ctx.strokeStyle = rgba(accent, 0.45); ctx.lineWidth = 1.5; ctx.stroke(); }
    }
  } else if (header.sub) {
    setFont(700, s * 0.4, FONT_U, s * 0.3);
    ctx.fillStyle = '#7f8ea8';
    ctx.fillText(header.sub, bx + bw / 2, oy + s * 1.35);
  }

  // Board backing
  const danger = g.stackHeight() > 16 && g.phase === 'playing';
  const pulse = 0.5 + 0.5 * Math.sin(t * 8);
  const edge = danger ? '#ff4d6a' : accent;
  ctx.save();
  ctx.shadowColor = rgba(edge, 0.35);
  ctx.shadowBlur = s * 1.2;
  ctx.fillStyle = 'rgba(3,6,14,0.94)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();
  const well = ctx.createLinearGradient(0, by, 0, by + bh);
  well.addColorStop(0, 'rgba(20,40,80,0.10)');
  well.addColorStop(1, rgba(accent, 0.07));
  ctx.fillStyle = well;
  ctx.fillRect(bx, by, bw, bh);

  // Grid: faint lines + intersection dots
  ctx.strokeStyle = 'rgba(140,200,255,0.035)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < COLS; x++) { ctx.moveTo(bx + x * s + 0.5, by); ctx.lineTo(bx + x * s + 0.5, by + bh); }
  for (let y = 1; y < VISIBLE_ROWS; y++) { ctx.moveTo(bx, by + y * s + 0.5); ctx.lineTo(bx + bw, by + y * s + 0.5); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(140,210,255,0.16)';
  const d = Math.max(1, s * 0.06);
  for (let x = 1; x < COLS; x++) for (let y = 1; y < VISIBLE_ROWS; y++) ctx.fillRect(bx + x * s - d / 2, by + y * s - d / 2, d, d);

  if (danger) {
    const dg = ctx.createLinearGradient(0, by, 0, by + bh * 0.5);
    dg.addColorStop(0, `rgba(255,77,106,${0.18 + 0.12 * pulse})`);
    dg.addColorStop(1, 'rgba(255,77,106,0)');
    ctx.fillStyle = dg;
    ctx.fillRect(bx, by, bw, bh * 0.5);
    // Hazard stripes along the top of the well
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, s * 0.5);
    ctx.clip();
    ctx.fillStyle = `rgba(255,77,106,${0.16 + 0.14 * pulse})`;
    const off = (t * s * 2) % (s * 1.2);
    for (let x = bx - s * 1.2 + off; x < bx + bw + s; x += s * 1.2) {
      ctx.beginPath();
      ctx.moveTo(x, by + s * 0.5); ctx.lineTo(x + s * 0.5, by); ctx.lineTo(x + s * 1.0, by); ctx.lineTo(x + s * 0.5, by + s * 0.5);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (lvl > 0) {
    // Glass reflection and a slow scan line sweeping down the well
    const sheen = ctx.createLinearGradient(bx, by, bx + bw, by + bh * 0.6);
    sheen.addColorStop(0, 'rgba(255,255,255,0.035)');
    sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(bx, by, bw, bh);
    const sweep = (t % 7) / 1.6;
    if (sweep < 1) {
      const sy = by + bh * sweep;
      const sg = ctx.createLinearGradient(0, sy - s * 1.5, 0, sy);
      sg.addColorStop(0, rgba(accent, 0));
      sg.addColorStop(1, rgba(accent, 0.07));
      ctx.fillStyle = sg;
      ctx.fillRect(bx, sy - s * 1.5, bw, s * 1.5);
    }
  }
  // Combo counter as a big watermark behind the stack
  if (V.comboMark && lvl > 0) {
    const cm = V.comboMark, kk = cm.t / 1.4;
    const a = (kk < 0.1 ? kk / 0.1 : 1 - (kk - 0.1) / 0.9) * 0.22;
    const col = comboColor(cm.n);
    const pop = 1 + 0.25 * (1 - easeOut(cm.t / 0.2));
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    setFont(900, s * 4.2 * pop, FONT_D, 0);
    ctx.fillStyle = col;
    ctx.fillText(String(cm.n), bx + bw / 2, by + bh * 0.56);
    setFont(900, s * 0.9, FONT_D, s * 0.3);
    ctx.fillText('COMBO', bx + bw / 2, by + bh * 0.56 + s * 2.8);
    ctx.globalAlpha = 1;
  }
  // Blitz level up: a violet wave rising through the well
  if (V.wave > 0) {
    const wy = by + bh * V.wave;
    const wg = ctx.createLinearGradient(0, wy, 0, wy + s * 3);
    wg.addColorStop(0, `rgba(154,107,255,${0.35 * V.wave})`);
    wg.addColorStop(1, 'rgba(154,107,255,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(bx, wy, bw, s * 3);
  }
  // Incoming garbage: red light rising from the floor
  if (V.garbFlash > 0) {
    const gg = ctx.createLinearGradient(0, by + bh, 0, by + bh * 0.55);
    gg.addColorStop(0, `rgba(255,77,106,${0.32 * V.garbFlash})`);
    gg.addColorStop(1, 'rgba(255,77,106,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(bx, by + bh * 0.55, bw, bh * 0.45);
  }
  ctx.restore();

  // Column guide beam under the active piece
  const p = g.piece;
  if (p) {
    const cols = new Set(SHAPES[p.type].states[p.rot].map(([cx]) => p.x + cx));
    const beam = ctx.createLinearGradient(0, by, 0, by + bh);
    beam.addColorStop(0, rgba(PIECE_COLORS[p.type], 0));
    beam.addColorStop(1, rgba(PIECE_COLORS[p.type], 0.07));
    ctx.fillStyle = beam;
    for (const c of cols) ctx.fillRect(bx + c * s, by, s, bh);
  }

  // Locked blocks (hidden rows are drawn above the visible field)
  const dead = g.phase === 'over';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const tp = g.board[r][c];
      if (tp) drawBlock(bx + c * s, rowY(r), s, dead ? 'G' : tp, dead ? 0.6 : 1, 1);
    }
  }

  // Hard drop trails
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const tr of V.trails) {
    const a = 1 - tr.t / 0.28;
    for (const c of tr.cells) {
      const top = rowY(c.y0), bot = rowY(c.y1) + s;
      const tg = ctx.createLinearGradient(0, top, 0, bot);
      tg.addColorStop(0, rgba(tr.color, 0));
      tg.addColorStop(1, rgba(tr.color, 0.45 * a));
      ctx.fillStyle = tg;
      ctx.fillRect(bx + c.x * s + s * 0.1, top, s * 0.8, bot - top);
    }
  }
  ctx.restore();

  // Ghost + active piece
  if (p) {
    const cells = SHAPES[p.type].states[p.rot];
    if (settings.ghost) {
      const gy = g.ghostY();
      for (const [cx, cy] of cells) drawGhostBlock(bx + (p.x + cx) * s, rowY(gy + cy), s, p.type);
    }
    for (const a of V.after) {
      for (const [cx, cy] of SHAPES[a.type].states[a.rot]) drawBlock(bx + (a.x + cx) * s, rowY(a.y + cy), s, a.type, 0.28 * (1 - a.t / 0.12), 1);
    }
    const lockFade = g.grounded() ? 1 - 0.4 * Math.min(1, g.lockTimer / LOCK_DELAY) : 1;
    for (const [cx, cy] of cells) drawBlock(bx + (p.x + cx) * s, rowY(p.y + cy), s, p.type, lockFade, 2);
    // A new piece materialises: a bright outline that shrinks onto it
    if (V.spawnT < 0.14 && lvl > 0) {
      const k = V.spawnT / 0.14, grow = s * 0.35 * (1 - k);
      ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - k)})`;
      ctx.lineWidth = Math.max(1, s * 0.08);
      for (const [cx, cy] of cells) ctx.strokeRect(bx + (p.x + cx) * s - grow, rowY(p.y + cy) - grow, s + grow * 2, s + grow * 2);
    }
  }

  // Lock flash
  if (V.lockFlash) {
    ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - V.lockFlash.t / 0.15)})`;
    for (const c of V.lockFlash.cells) ctx.fillRect(bx + c.x * s, rowY(c.y), s, s);
  }

  // Line clear bands
  if (settings.flash) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of V.bands) {
      const k = b.t / 0.3;
      const hh = s * (1 - k);
      ctx.fillStyle = `rgba(200,245,255,${0.9 * (1 - k)})`;
      ctx.fillRect(bx - s * 0.5 * k, b.y + (s - hh) / 2, bw + s * k, hh);
      if (lvl > 0) {
        // The beam vents out past both walls
        const reach = s * (1.5 + 3 * easeOut(k * 2));
        const yy = b.y + (s - hh * 0.5) / 2;
        const lg = ctx.createLinearGradient(bx - reach, 0, bx, 0);
        lg.addColorStop(0, 'rgba(200,245,255,0)');
        lg.addColorStop(1, `rgba(200,245,255,${0.7 * (1 - k)})`);
        ctx.fillStyle = lg;
        ctx.fillRect(bx - reach, yy, reach, hh * 0.5);
        const rg = ctx.createLinearGradient(bx + bw, 0, bx + bw + reach, 0);
        rg.addColorStop(0, `rgba(200,245,255,${0.7 * (1 - k)})`);
        rg.addColorStop(1, 'rgba(200,245,255,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(bx + bw, yy, reach, hh * 0.5);
      }
    }
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Hard drop impact: a shock line spreading along the landing row
  for (const im of V.impacts) {
    const k = im.t / 0.25, spread = s * 2.5 * easeOut(k);
    ctx.fillStyle = rgba(im.color, 0.8 * (1 - k));
    ctx.fillRect(bx + im.x0 * s - spread, rowY(im.y) - s * 0.06, (im.x1 - im.x0) * s + spread * 2, s * 0.12);
  }
  // QUAD: a light pillar fills the well
  if (V.pillar > 0) {
    const pg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    pg.addColorStop(0, 'rgba(56,232,255,0)');
    pg.addColorStop(0.5, `rgba(120,240,255,${0.32 * V.pillar})`);
    pg.addColorStop(1, 'rgba(56,232,255,0)');
    ctx.fillStyle = pg;
    ctx.fillRect(bx - s, by - s * 2 * V.pillar, bw + s * 2, bh + s * 2 * V.pillar);
  }
  // Spin vortex: arcs whirling around where the piece spun in
  for (const v of V.vortex) {
    const k = v.t / 0.7, vx = bx + (v.x + 0.5) * s, vy = rowY(v.y) + s / 2;
    ctx.strokeStyle = rgba(v.color, 0.85 * (1 - k));
    ctx.lineWidth = s * 0.14 * (1 - k * 0.6);
    for (let i = 0; i < 3; i++) {
      const r = s * (0.8 + i * 0.55 + easeOut(k) * 1.6), a0 = v.t * (9 - i * 2) + i * 2.1;
      ctx.beginPath();
      ctx.arc(vx, vy, r, a0, a0 + Math.PI * (0.9 - i * 0.15));
      ctx.stroke();
    }
  }
  ctx.restore();

  // Board frame: open top, glowing sides and floor, corner brackets
  ctx.save();
  ctx.strokeStyle = danger ? `rgba(255,77,106,${0.7 + 0.3 * pulse})` : rgba(accent, 0.85);
  ctx.shadowColor = edge;
  ctx.shadowBlur = s * 0.5;
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(bx - 1, by);
  ctx.lineTo(bx - 1, by + bh + 1);
  ctx.lineTo(bx + bw + 1, by + bh + 1);
  ctx.lineTo(bx + bw + 1, by);
  ctx.stroke();
  ctx.lineWidth = Math.max(3, s * 0.16);
  const k = s * 0.9;
  ctx.beginPath();
  ctx.moveTo(bx - 4, by + bh - k); ctx.lineTo(bx - 4, by + bh + 4); ctx.lineTo(bx - 4 + k, by + bh + 4);
  ctx.moveTo(bx + bw + 4, by + bh - k); ctx.lineTo(bx + bw + 4, by + bh + 4); ctx.lineTo(bx + bw + 4 - k, by + bh + 4);
  ctx.moveTo(bx - 4, by + k); ctx.lineTo(bx - 4, by);
  ctx.moveTo(bx + bw + 4, by + k); ctx.lineTo(bx + bw + 4, by);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = rgba(accent, 0.15);
  ctx.lineWidth = 1;
  ctx.setLineDash([s * 0.3, s * 0.3]);
  ctx.beginPath();
  ctx.moveTo(bx, by + 0.5);
  ctx.lineTo(bx + bw, by + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Two lights race down the walls and meet under the floor; faster with energy
  if (lvl > 0 && g.phase !== 'over') {
    const half = bh + bw / 2;
    const head = ((t * (0.22 + V.energy * 0.6)) % 1) * half;
    const at = (d) => (d < bh ? [bx - 1, by + d] : [bx - 1 + (d - bh), by + bh + 1]);
    const tail = lvl === 2 ? 14 : 7;
    for (let i = 0; i < tail; i++) {
      const d = head - i * s * 0.35;
      if (d < 0) break;
      const [x, y] = at(d);
      const r = s * (i === 0 ? 0.2 : 0.15) * (1 - i / tail);
      ctx.fillStyle = i === 0 ? '#ffffff' : rgba(edge, 0.9 * (1 - i / tail));
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillRect(2 * bx + bw - x - r, y - r, r * 2, r * 2);
    }
  }
  // Back-to-back: gold lightning crawling up both walls
  const b2bIdle = lvl === 2 && g.b2b >= 4 && g.phase === 'playing' ? 0.25 : 0;
  const arc = Math.max(V.b2bArc / 0.9, b2bIdle);
  if (arc > 0 && lvl > 0 && Math.random() < 0.6 + arc * 0.4) {
    ctx.strokeStyle = `rgba(255,214,110,${0.85 * arc})`;
    ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.shadowColor = '#ffd66e';
    ctx.shadowBlur = s * 0.6;
    const top = by + bh * (1 - Math.min(1, arc * 1.4));
    ctx.beginPath();
    bolt(bx - s * 0.3, by + bh, top, s * 0.35);
    bolt(bx + bw + s * 0.3, by + bh, top, s * 0.35);
    ctx.stroke();
  }
  ctx.restore();

  // Mode progress bar (right edge of the board)
  let prog = null;
  if (g.mode === 'sprint') prog = Math.min(1, g.lines / SPRINT_LINES);
  else if (g.mode === 'blitz') prog = 1 - Math.min(1, g.time / BLITZ_MS);
  if (prog != null) {
    const px = bx + bw + s * 0.22;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(px, by, s * 0.14, bh);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = s * 0.4;
    ctx.fillRect(px, by + bh * (1 - prog), s * 0.14, bh * prog);
    ctx.shadowBlur = 0;
  }

  // Hold
  const holdH = 3.9 * s;
  hudPanel(ox, by, HOLD_W * s, holdH, 'HOLD', s, accent);
  if (g.holdPiece) drawMiniPiece(g.holdPiece, ox + HOLD_W * s / 2, by + holdH / 2 + s * 0.45, Math.round(s * 0.78), !g.canHold);

  // Next queue
  const nextH = 1.15 * s + NEXT_COUNT * NEXT_SPACING * s;
  hudPanel(ox + NEXT_X * s, by, HOLD_W * s, nextH, 'NEXT', s, accent);
  for (let i = 0; i < NEXT_COUNT; i++) {
    const tp = g.queue[i];
    if (tp) drawMiniPiece(tp, ox + NEXT_X * s + HOLD_W * s / 2, by + 1.15 * s + i * NEXT_SPACING * s + NEXT_SPACING * s / 2,
      Math.round(s * (i === 0 ? 0.78 : 0.62)));
  }

  // Garbage meter
  const mx = ox + METER_X * s, mw = METER_W * s;
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(mx, by, mw, bh);
  let filled = 0;
  ctx.save();
  for (const inc of g.incoming) {
    const n = Math.min(inc.lines, VISIBLE_ROWS - filled);
    if (n <= 0) break;
    const ready = g.time >= inc.readyAt;
    const col = ready ? '#ff4d6a' : '#ff9a3c';
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = s * (0.4 + V.meterPulse * 0.8 + (ready ? pulse * 0.4 : 0));
    ctx.fillRect(mx, by + bh - (filled + n) * s + 1, mw, n * s - 2);
    filled += n;
  }
  ctx.restore();

  // Action text popups (between hold and stats, right-aligned to the board)
  const popX = ox + (METER_X - 0.35) * s;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  g.popups.forEach((pp, i) => {
    const kk = pp.t / pp.life;
    const alpha = kk > 0.7 ? (1 - kk) / 0.3 : 1;
    const inK = easeOut(pp.t / 160);
    const size = s * (pp.big ? 0.62 : 0.52) * (0.85 + 0.15 * inK);
    const px = popX - (1 - inK) * s * 1.5, py = by + holdH + s * (1.1 + i * 0.95), maxW = (METER_X - 0.4) * s;
    ctx.save();
    // Slides in leaning forward, then straightens up
    ctx.setTransform(ctx.getTransform().translate(px, py).skewX(-20 * (1 - inK)).translate(-px, -py));
    setFont(900, size, FONT_D, size * 0.08);
    if (lvl > 0 && inK < 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.6 * (1 - inK);
      ctx.fillStyle = '#38e8ff';
      ctx.fillText(pp.text, px - s * 0.25, py, maxW);
      ctx.fillStyle = '#ff4fd8';
      ctx.fillText(pp.text, px + s * 0.25, py, maxW);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = alpha * inK;
    ctx.shadowColor = pp.color;
    ctx.shadowBlur = s * 0.5;
    ctx.fillStyle = pp.color;
    ctx.fillText(pp.text, px, py, maxW);
    ctx.restore();
  });
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // Shockwave rings
  for (const r of V.rings) {
    const kk = r.t / 0.7;
    ctx.strokeStyle = rgba(r.color, 0.8 * (1 - kk));
    ctx.lineWidth = s * 0.2 * (1 - kk);
    ctx.beginPath();
    ctx.arc(bx + bw / 2, by + bh / 2, easeOut(kk) * (r.big ? bw : bw * 0.5), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Particles
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const pt of V.parts) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.max);
    if (pt.streak) {
      // Streaks stretch along their motion like sparks
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = pt.size * 0.45;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x - pt.vx * 0.035, pt.y - pt.vy * 0.035);
      ctx.stroke();
    } else {
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
  }
  ctx.restore();

  // Center text: countdown / GO / perfect clear / end state
  const cx = bx + bw / 2, cy = by + bh / 2;
  if (g.phase === 'countdown') {
    const n = Math.max(1, Math.ceil(g.countdown / 1000));
    const frac = (g.countdown % 1000) / 1000;
    ctx.save();
    ctx.strokeStyle = rgba(accent, 0.2);
    ctx.lineWidth = s * 0.18;
    ctx.beginPath(); ctx.arc(cx, cy, s * 2.6, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = s * 0.6;
    ctx.beginPath(); ctx.arc(cx, cy, s * 2.6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    ctx.restore();
    drawCenterText(String(n), cx, cy, s * (2.6 + 0.6 * frac), accent, bw);
    setFont(700, s * 0.45, FONT_U, s * 0.4);
    ctx.fillStyle = '#9fb0cc';
    ctx.fillText('READY', cx, cy + s * 3.6);
  } else if (g.goTimer > 0) {
    const kk = 1 - g.goTimer / 700;
    drawCenterText('GO!', cx, cy, s * (2.6 + kk * 1.4), '#4dff9a', bw * 1.2, 1 - kk);
  }
  if (V.pc > 0) {
    const kk = 1 - V.pc / 1.9;
    const a = V.pc < 0.4 ? V.pc / 0.4 : 1;
    const sc = 0.7 + 0.3 * easeOut(kk * 4);
    drawCenterText('PERFECT', cx, cy - s * 0.8, s * 1.15 * sc, '#ffd66e', bw, a);
    drawCenterText('CLEAR', cx, cy + s * 0.6, s * 1.15 * sc, '#ff4fd8', bw, a);
  }
  // QUAD / big spin title: slams in with a chromatic split, holds, then fades
  if (V.title) {
    const T = V.title, kk = T.t / T.life;
    const slam = 1 + 0.9 * (1 - easeOut(T.t / 0.14));
    const a = kk > 0.7 ? (1 - kk) / 0.3 : Math.min(1, T.t / 0.06);
    const size = s * 1.9 * slam;
    const ty = by + bh * 0.3;
    drawSplitText(T.text, cx, ty, size, T.color, bw * 1.15, a, lvl > 0 ? s * (0.12 + 0.5 * (1 - easeOut(T.t / 0.3))) : 0);
    if (T.sub) {
      setFont(800, s * 0.6, FONT_D, s * 0.3);
      ctx.globalAlpha = a;
      ctx.fillStyle = T.sub.startsWith('B2B') ? '#ffd66e' : '#e8f1ff';
      ctx.fillText(T.sub, cx, ty + s * 1.5, bw);
      ctx.globalAlpha = 1;
    }
  }
  if (g.phase === 'over' || g.phase === 'done') {
    let text, col;
    if (g.phase === 'over') { text = g.mode === 'versus' ? 'TOPPED OUT' : 'GAME OVER'; col = '#ff4d6a'; }
    else if (g.mode === 'versus') { text = 'VICTORY'; col = '#4dff9a'; }
    else { text = g.mode === 'blitz' ? 'TIME UP' : 'FINISH'; col = '#4dff9a'; }
    ctx.fillStyle = 'rgba(2,4,10,0.75)';
    ctx.fillRect(bx, cy - s * 1.2, bw, s * 2.4);
    ctx.fillStyle = col;
    ctx.fillRect(bx, cy - s * 1.2, bw, 2);
    ctx.fillRect(bx, cy + s * 1.2 - 2, bw, 2);
    drawCenterText(text, cx, cy, s * 1.1, col, bw - s);
  }

  // Stats: left column (bottom-aligned, right-justified) and right column
  const lx = ox + (METER_X - 0.35) * s;
  const rx = ox + NEXT_X * s + s * 0.2;
  const step = 2.05 * s;
  const tm = g.mode === 'blitz' ? fmtTime(BLITZ_MS - g.time) : fmtTime(g.time);
  const [tMain, tMs] = [tm.slice(0, -4), tm.slice(-4)];
  const leftStats = [
    [g.mode === 'blitz' ? 'TIME LEFT' : 'TIME', tMain, tMs, true],
    ['LINES', String(g.lines), g.mode === 'sprint' ? `/${SPRINT_LINES}` : null],
    ['PIECES', String(g.pieces), ` ${g.pps.toFixed(2)}/S`],
    ['ATTACK', String(g.attack), ` ${g.apm.toFixed(1)}/M`],
  ];
  const lTop = by + bh - leftStats.length * step + s * 0.35;
  leftStats.forEach(([lab, v, sub, big], i) => drawStat(lx, lTop + i * step, 'right', lab, v, sub, s, accent, big));
  const rightStats = [
    ['SCORE', g.score.toLocaleString(), g.mode === 'blitz' ? ` LV${g.level}` : null],
    ['B2B', g.b2b >= 1 ? `×${g.b2b}` : '—', null],
    ['COMBO', g.combo >= 1 ? String(g.combo) : '—', null],
  ];
  const rTop = by + bh - rightStats.length * step + s * 0.35;
  rightStats.forEach(([lab, v, sub], i) => drawStat(rx, rTop + i * step, 'left', lab, v, sub, s, accent, false));

  ctx.restore();
}

/* ---------- attack projectiles between boards ---------- */
function drawGlobalFx(dt) {
  const lvl = fxLevel();
  for (const f of globalFx) f.t += dt;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of globalFx) {
    const A = f.from._L, B = f.to._L;
    if (!A || !B) continue;
    const x0 = A.bx + A.bw / 2, y0 = A.by + A.bh * 0.55;
    const x1 = B.x + (METER_X + METER_W / 2) * B.s, y1 = B.by + B.bh - B.s;
    const mxp = (x0 + x1) / 2, myp = Math.min(y0, y1) - A.s * 6;
    const at = (u) => [(1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mxp + u * u * x1, (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * myp + u * u * y1];
    const size = A.s * (0.25 + Math.min(f.lines, 10) * 0.04);
    if (f.t >= 0.5) {
      // Impact: a burst of sparks on the receiver's garbage meter
      if (!f.hit) {
        f.hit = true;
        for (let k = fxCount(10 + f.lines * 4); k > 0; k--) {
          const a = rand(0, Math.PI * 2), sp = rand(2, 9) * B.s;
          globalParts.push({ x: x1, y: y1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.55), max: 0.55, size: B.s * rand(0.1, 0.22), color: f.color, s: B.s });
        }
        vfx(f.to).meterPulse = 1;
      }
      continue;
    }
    const head = easeOut(f.t / 0.5);
    for (let k = 0; k < 10; k++) {
      const [x, y] = at(Math.max(0, head - k * 0.022));
      ctx.globalAlpha = 1 - k * 0.09;
      ctx.fillStyle = k === 0 ? '#ffffff' : f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = A.s;
      ctx.beginPath();
      ctx.arc(x, y, size * (1 - k * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
    // Sparkling tail
    if (lvl > 0) {
      const [x, y] = at(head);
      for (let k = fxCount(3); k > 0; k--) {
        globalParts.push({ x, y, vx: rand(-1.5, 1.5) * A.s, vy: rand(-1.5, 1.5) * A.s, life: rand(0.2, 0.4), max: 0.4, size: A.s * rand(0.06, 0.14), color: f.color, s: A.s });
      }
    }
  }
  ctx.shadowBlur = 0;
  for (let i = globalFx.length - 1; i >= 0; i--) if (globalFx[i].hit) globalFx.splice(i, 1);
  for (const p of globalParts) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 10 * p.s * dt;
    p.life -= dt;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  globalParts = globalParts.filter(p => p.life > 0);
  if (globalParts.length > 400) globalParts.splice(0, globalParts.length - 400);
  ctx.restore();
}

/** Full-screen overlays: the tinted flash on big plays and a red edge glow in danger. */
function drawScreenFx(dt, games) {
  const W = VIEW_W, H = VIEW_H;
  const danger = games.some(g => !g.remote && g.phase === 'playing' && g.stackHeight() > 16);
  screenFx.danger += ((danger ? 1 : 0) - screenFx.danger) * Math.min(1, dt * 4);
  if (screenFx.danger > 0.02 && fxLevel() > 0) {
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(255,40,70,0)');
    vg.addColorStop(1, `rgba(255,40,70,${0.22 * screenFx.danger * (0.75 + 0.25 * Math.sin(performance.now() / 160))})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }
  if (screenFx.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(screenFx.flashColor, screenFx.flash);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/* ---------- frame ---------- */
/** Fits n boards into whatever the touch controller leaves free. */
function fitBoards(n) {
  const ins = Touch.insets();
  const AX = ins.left, W = VIEW_W - ins.left - ins.right, H = VIEW_H - ins.bottom;
  // On a touch screen the opponent's board is drawn at a smaller scale beside yours.
  const oppScale = Touch.shown && n === 2 ? 0.46 : 1;
  const totalW = n === 1 ? UNIT_W : UNIT_W + (UNIT_GAP * oppScale) + UNIT_W * oppScale;
  // Phones need every pixel, so the margin is thinner and the cell size snaps to half pixels.
  const m = Touch.shown ? 8 : 24;
  const s = Math.max(6, Math.floor(Math.min((W - m) / totalW, (H - m) / UNIT_H) * 2) / 2);
  const x0 = AX + (W - totalW * s) / 2, y0 = Math.max(8, (H - UNIT_H * s) / 2);
  return { AX, W, H, oppScale, s, x0, y0 };
}
/** Where a solo board lands on screen, for the touch layout editor's preview. */
function soloBoardRect() {
  const { s, x0, y0 } = fitBoards(1);
  return { x: x0 + BOARD_X * s, y: y0 + BOARD_Y * s, w: COLS * s, h: VISIBLE_ROWS * s };
}

let lastRenderTime = performance.now();
function render(now = performance.now()) {
  const rawMs = now - lastRenderTime;
  const dt = Math.min(0.05, rawMs / 1000);
  lastRenderTime = now;
  const t = now / 1000;
  const games = App.games;
  trackFrameRate(rawMs, dt, games.length > 0 && !App.paused && !document.hidden);
  // Shared reactions decay every frame; the background follows the most energetic board.
  screenFx.flash = Math.max(0, screenFx.flash - dt * 2);
  screenFx.pulse = Math.max(0, screenFx.pulse - dt * 1.5);
  const energy = games.reduce((m, g) => Math.max(m, g._vfx ? g._vfx.energy : 0), 0);
  screenFx.energy += (energy - screenFx.energy) * Math.min(1, dt * 2);
  drawBackground(t, games.length > 0, dt);
  if (!games.length) return;
  const n = games.length;
  const { AX, W, oppScale, s, x0, y0 } = fitBoards(n);
  games.forEach((g, i) => {
    let header;
    if (App.mode === 'versus') header = { name: `PLAYER ${i + 1}`, wins: App.wins[i], accent: ACCENTS[i] };
    else if (App.mode === 'cpu') {
      const lvl = App.cpuLevel || CPU_LEVELS[1];
      header = { name: i === 0 ? 'YOU' : `CPU · ${lvl.name}`, wins: App.wins[i], accent: i === 0 ? ACCENTS[0] : lvl.color };
    }
    else if (App.mode === 'online') {
      const name = i === 0 ? (Online.myName || Online.player.name || 'YOU') : Online.opponentName();
      header = { name: name.toUpperCase(), wins: App.wins[i], accent: ACCENTS[i] };
    } else header = { name: MODE_NAMES[App.mode].toUpperCase(), sub: MODE_SUBS[App.mode], accent: MODE_ACCENTS[App.mode] };
    const L = i === 0 || oppScale === 1
      ? { x: x0 + i * (UNIT_W + UNIT_GAP) * s, y: y0, s }
      : { x: x0 + (UNIT_W + UNIT_GAP * oppScale) * s, y: y0, s: s * oppScale };
    drawPlayer(g, L, header, t, dt);
  });
  if ((App.mode === 'versus' || App.mode === 'cpu' || App.mode === 'online') && oppScale === 1) {
    const cx = AX + W / 2, cy = y0 + (BOARD_Y + 10) * s;
    drawCenterText('VS', cx, cy, s * 1.3, '#9a6bff', s * 3, 0.9);
    setFont(700, s * 0.45, FONT_U, s * 0.3);
    ctx.fillStyle = '#7f8ea8';
    ctx.textAlign = 'center';
    ctx.fillText(`ROUND ${App.round}`, cx, cy + s * 1.4);
  }
  drawGlobalFx(dt);
  drawScreenFx(dt, games);
}
resizeCanvas();
