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
const BG_BITS = Array.from({ length: 60 }, () => ({
  x: Math.random(), y: Math.random(), z: Math.random(), r: Math.random() * Math.PI,
  c: PIECE_COLORS[PIECE_TYPES[Math.floor(Math.random() * 7)]],
}));
function drawBackground(t, inGame) {
  const W = VIEW_W, H = VIEW_H;
  const g = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, Math.max(W, H) * 0.85);
  g.addColorStop(0, '#0c1838');
  g.addColorStop(0.45, '#060b1d');
  g.addColorStop(1, '#010207');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Perspective grid floor scrolling towards the viewer
  const hz = H * 0.64, vx = W / 2;
  const strength = inGame ? 0.45 : 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, hz, W, H - hz);
  ctx.clip();
  const fade = ctx.createLinearGradient(0, hz, 0, H);
  fade.addColorStop(0, 'rgba(56,232,255,0)');
  fade.addColorStop(1, `rgba(56,232,255,${0.35 * strength})`);
  ctx.strokeStyle = fade;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const near = W / 9;
  for (let i = -14; i <= 14; i++) {
    ctx.moveTo(vx + i * near * 0.06, hz);
    ctx.lineTo(vx + i * near * 1.6, H);
  }
  const phase = (t * 0.6) % 1;
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
  hg.addColorStop(0.5, `rgba(120,200,255,${0.55 * strength})`);
  hg.addColorStop(1, 'rgba(255,79,216,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, hz - 1, W, 2);
  const haze = ctx.createLinearGradient(0, hz - H * 0.12, 0, hz);
  haze.addColorStop(0, 'rgba(154,107,255,0)');
  haze.addColorStop(1, `rgba(154,107,255,${0.12 * strength})`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, hz - H * 0.12, W, H * 0.12);

  // Drifting neon fragments
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of BG_BITS) {
    const y = ((b.y - t * 0.012 * (0.3 + b.z)) % 1 + 1) % 1;
    const x = b.x + Math.sin(t * 0.2 + b.r * 4) * 0.01;
    const size = 3 + b.z * 10;
    ctx.save();
    ctx.translate(x * W, y * H);
    ctx.rotate(b.r + t * 0.1 * (b.z - 0.5));
    ctx.strokeStyle = rgba(b.c, (0.08 + b.z * 0.22) * strength);
    ctx.lineWidth = 1;
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}

/* ---------- per-game visual effects (particles, trails, rings) ---------- */
function vfx(g) {
  if (!g._vfx) g._vfx = { parts: [], trails: [], rings: [], bands: [], lockFlash: null, pc: 0, meterPulse: 0 };
  return g._vfx;
}
function consumeFx(g, L) {
  const V = vfx(g);
  const s = L.s;
  const rowY = (r) => L.by + (r - HIDDEN_ROWS) * s;
  for (const ev of g.fx) {
    switch (ev.type) {
      case 'clear':
        for (const row of ev.rows) {
          V.bands.push({ y: rowY(row.y), t: 0 });
          row.cells.forEach((type, c) => {
            if (!type) return;
            for (let k = 0; k < 2; k++) {
              V.parts.push({
                x: L.bx + (c + 0.5) * s, y: rowY(row.y) + s / 2,
                vx: ((c - 4.5) / 4.5) * rand(3, 9) * s + rand(-1.5, 1.5) * s, vy: rand(-6, -1) * s,
                life: rand(0.45, 0.9), max: 0.9, size: s * rand(0.12, 0.3), color: PIECE_COLORS[type],
              });
            }
          });
        }
        break;
      case 'hard':
        V.trails.push({ cells: ev.cells, color: PIECE_COLORS[ev.piece], t: 0 });
        for (const c of ev.cells) {
          for (let k = 0; k < 3; k++) {
            V.parts.push({ x: L.bx + (c.x + rand(0.1, 0.9)) * s, y: rowY(c.y1) + s, vx: rand(-2, 2) * s, vy: rand(-4, -1) * s,
              life: rand(0.2, 0.4), max: 0.4, size: s * rand(0.08, 0.16), color: PIECE_COLORS[ev.piece] });
          }
        }
        break;
      case 'lock':
        V.lockFlash = { cells: ev.cells, t: 0 };
        break;
      case 'pc':
        V.pc = 1.9;
        for (let k = 0; k < 90; k++) {
          const a = rand(0, Math.PI * 2), sp = rand(3, 14) * s;
          V.parts.push({ x: L.bx + L.bw / 2, y: L.by + L.bh / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: rand(0.6, 1.3), max: 1.3, size: s * rand(0.12, 0.3), color: PIECE_COLORS[PIECE_TYPES[k % 7]] });
        }
        break;
      case 'spin':
        V.rings.push({ t: 0, color: PIECE_COLORS.T, big: false });
        break;
      case 'attack': {
        if (ev.lines >= 4) V.rings.push({ t: 0, color: ev.lines >= 8 ? '#ffd66e' : '#38e8ff', big: true });
        const target = App.games.find(o => o !== g);
        if (target && ev.sent > 0) globalFx.push({ from: g, to: target, t: 0, lines: ev.sent, color: ACCENTS[App.games.indexOf(g)] || '#38e8ff' });
        break;
      }
      case 'garbage':
        V.meterPulse = 1;
        break;
    }
  }
  g.fx.length = 0;
}
function updateVfx(g, dt, s) {
  const V = vfx(g);
  for (const p of V.parts) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 32 * s * dt;
    p.vx *= 0.985;
    p.life -= dt;
  }
  V.parts = V.parts.filter(p => p.life > 0);
  if (V.parts.length > 600) V.parts.splice(0, V.parts.length - 600);
  for (const tr of V.trails) tr.t += dt;
  V.trails = V.trails.filter(tr => tr.t < 0.28);
  for (const r of V.rings) r.t += dt;
  V.rings = V.rings.filter(r => r.t < 0.7);
  for (const b of V.bands) b.t += dt;
  V.bands = V.bands.filter(b => b.t < 0.3);
  if (V.lockFlash) { V.lockFlash.t += dt; if (V.lockFlash.t > 0.15) V.lockFlash = null; }
  V.pc = Math.max(0, V.pc - dt);
  V.meterPulse = Math.max(0, V.meterPulse - dt * 2.5);
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
  }

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
    const lockFade = g.grounded() ? 1 - 0.4 * Math.min(1, g.lockTimer / LOCK_DELAY) : 1;
    for (const [cx, cy] of cells) drawBlock(bx + (p.x + cx) * s, rowY(p.y + cy), s, p.type, lockFade, 2);
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
    }
    ctx.restore();
  }

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
    ctx.globalAlpha = alpha * inK;
    setFont(900, size, FONT_D, size * 0.08);
    ctx.shadowColor = pp.color;
    ctx.shadowBlur = s * 0.5;
    ctx.fillStyle = pp.color;
    ctx.fillText(pp.text, popX - (1 - inK) * s * 1.5, by + holdH + s * (1.1 + i * 0.95), (METER_X - 0.4) * s);
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
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
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
  for (const f of globalFx) f.t += dt;
  for (let i = globalFx.length - 1; i >= 0; i--) if (globalFx[i].t > 0.5) globalFx.splice(i, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of globalFx) {
    const A = f.from._L, B = f.to._L;
    if (!A || !B) continue;
    const x0 = A.bx + A.bw / 2, y0 = A.by + A.bh * 0.55;
    const x1 = B.x + (METER_X + METER_W / 2) * B.s, y1 = B.by + B.bh - B.s;
    const mxp = (x0 + x1) / 2, myp = Math.min(y0, y1) - A.s * 6;
    for (let k = 0; k < 8; k++) {
      const u = Math.max(0, easeOut(f.t / 0.5) - k * 0.025);
      const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mxp + u * u * x1;
      const y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * myp + u * u * y1;
      const r = A.s * (0.25 + Math.min(f.lines, 10) * 0.04) * (1 - k * 0.1);
      ctx.globalAlpha = 1 - k * 0.12;
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = A.s;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/* ---------- frame ---------- */
let lastRenderTime = performance.now();
function render(now = performance.now()) {
  const dt = Math.min(0.05, (now - lastRenderTime) / 1000);
  lastRenderTime = now;
  const t = now / 1000;
  const games = App.games;
  drawBackground(t, games.length > 0);
  if (!games.length) return;
  const W = VIEW_W, H = VIEW_H;
  const n = games.length;
  const totalW = n * UNIT_W + (n - 1) * UNIT_GAP;
  const s = Math.max(6, Math.floor(Math.min((W - 24) / totalW, (H - 24) / UNIT_H)));
  const x0 = (W - totalW * s) / 2, y0 = (H - UNIT_H * s) / 2;
  games.forEach((g, i) => {
    const header = App.mode === 'versus'
      ? { name: `PLAYER ${i + 1}`, wins: App.wins[i], accent: ACCENTS[i] }
      : { name: MODE_NAMES[App.mode].toUpperCase(), sub: MODE_SUBS[App.mode], accent: MODE_ACCENTS[App.mode] };
    drawPlayer(g, { x: x0 + i * (UNIT_W + UNIT_GAP) * s, y: y0, s }, header, t, dt);
  });
  if (App.mode === 'versus') {
    const cx = W / 2, cy = y0 + (BOARD_Y + 10) * s;
    drawCenterText('VS', cx, cy, s * 1.3, '#9a6bff', s * 3, 0.9);
    setFont(700, s * 0.45, FONT_U, s * 0.3);
    ctx.fillStyle = '#7f8ea8';
    ctx.textAlign = 'center';
    ctx.fillText(`ROUND ${App.round}`, cx, cy + s * 1.4);
  }
  drawGlobalFx(dt);
}
resizeCanvas();
