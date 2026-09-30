'use strict';

/* =========================================================================
 * TOUCH CONTROLS
 * An on-screen controller for phones and tablets. Portrait puts the board on
 * top and the pad underneath; landscape splits the pad to either side.
 *   Move keys: ◀ ▶ and ▼ (soft drop), one slide-able zone for the left thumb
 *   DROP: hard drop, in the middle
 *   Rotate keys: hold, 180, ↺ (CCW), ↻ (CW) for the right thumb
 *   Corners: pause and (in solo modes) retry
 * The pad feeds the same Game.input() events as the keyboard, so DAS, ARR and
 * soft drop speed follow the player's handling settings.
 *
 * Players can also build their own layout (Config > Phone Controls): every
 * button can be dragged anywhere, resized and given a different action. A
 * custom layout is kept per orientation in settings.touch and swaps the grid
 * pad for freely placed buttons (#pad-free).
 * ========================================================================= */
const PAD_FACES = {
  left: { html: '◀', cls: 'move' }, right: { html: '▶', cls: 'move' }, soft: { html: '▼<small>SOFT</small>', cls: 'move' },
  hard: { html: '<b>⤓</b>DROP', cls: 'drop' }, hold: { html: 'HOLD', cls: 'hold' }, r180: { html: '180', cls: 'r180' },
  ccw: { html: '↺', cls: 'ccw' }, cw: { html: '↻', cls: 'cw' },
};
const MOVE_ACTIONS = new Set(['left', 'right', 'soft']); // a thumb can slide between these
const Touch = {
  enabled: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  shown: false,
  held: new Map(), // pointerId -> action currently pressed by that pointer
  editing: false,  // the layout editor is open
  selected: null,  // button id picked in the editor
  pristine: {},    // orientation -> true while the editor shows an untouched built-in layout
  layoutKey: '',

  init() {
    window.addEventListener('touchstart', () => this.enable(), { passive: true, once: true });
    if (this.enabled) this.enable();
    const pad = $('pad');
    for (const btn of pad.querySelectorAll('[data-act]')) this.bindButton(btn, btn.dataset.act);
    this.bindDpad($('pad-dpad'));
    this.buildFree();
    this.initEditor();
    $('pad-menu').addEventListener('click', () => { this.releaseAll(); App.onEscape(); });
    $('pad-retry').addEventListener('click', () => { this.releaseAll(); if (App.mode && !App.isLocalMatch() && App.mode !== 'online') App.start(App.mode); });
    // Keep the page from scrolling or zooming under a thumb. Safari ignores
    // touch-action for double-tap zoom and shows its magnifier on long presses,
    // so the controls cancel the touch itself (pointer events still fire).
    const stop = e => { if (e.cancelable) e.preventDefault(); };
    for (const el of [$('pad-dpad'), $('pad-face'), $('pad-drop'), $('pad-free'), canvas]) {
      el.addEventListener('touchstart', stop, { passive: false });
      el.addEventListener('touchend', stop, { passive: false });
    }
    pad.addEventListener('touchmove', stop, { passive: false });
    canvas.addEventListener('touchmove', stop, { passive: false });
    pad.addEventListener('dblclick', stop);
    // Safari's own pinch-zoom events.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false });
    // Double tapping anywhere else during a game (e.g. beside the pad) mustn't zoom either.
    let lastEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = e.timeStamp;
      if (this.shown && now - lastEnd < 350 && e.cancelable && !e.target.closest('button, a, input, textarea, select')) e.preventDefault();
      lastEnd = now;
    }, { passive: false });
  },

  enable() {
    if (this.enabled && document.body.classList.contains('touch')) return;
    this.enabled = true;
    document.body.classList.add('touch');
  },

  game() {
    const b = Input.bindings[0];
    return b && App.inGame() && !App.paused ? b.game : null;
  },

  press(pointerId, action) {
    const prev = this.held.get(pointerId);
    if (prev === action) return;
    const g = this.game();
    if (prev) { this.held.delete(pointerId); this.setLit(prev, false); if (g) g.input('up', prev); }
    if (!action) return;
    this.held.set(pointerId, action);
    this.setLit(action, true);
    if (g) g.input('down', action);
    if (navigator.vibrate) navigator.vibrate(8);
  },
  release(pointerId) { this.press(pointerId, null); },
  releaseAll() { for (const id of [...this.held.keys()]) this.release(id); },

  setLit(action, on) {
    for (const el of document.querySelectorAll(`#pad [data-lit="${action}"]`)) el.classList.toggle('lit', on);
  },

  bindButton(el, action) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.press(e.pointerId, action);
    });
    const up = (e) => this.release(e.pointerId);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  },

  /** One zone for the move keys (◀ ▶ on top, ▼ below) so a thumb can slide between them. */
  bindDpad(el) {
    const dirAt = (e) => {
      const r = el.getBoundingClientRect();
      if ((e.clientY - r.top) / r.height >= 0.5) return 'soft';
      return e.clientX - r.left < r.width / 2 ? 'left' : 'right';
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.press(e.pointerId, dirAt(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (this.held.has(e.pointerId)) this.press(e.pointerId, dirAt(e));
    });
    const up = (e) => this.release(e.pointerId);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  },

  /** Called every frame: show the pad only while playing (or while editing it). */
  sync() {
    const show = this.editing || (this.enabled && App.inGame() && !App.paused);
    if (show !== this.shown) {
      this.shown = show;
      $('pad').classList.toggle('hidden', !show);
      if (!show) this.releaseAll();
      this.layoutKey = '';
    }
    const solo = App.mode && !App.isLocalMatch() && App.mode !== 'online';
    $('pad-retry').classList.toggle('hidden', !solo);
    // Re-place the custom buttons when the screen turns or resizes.
    const key = `${innerWidth}x${innerHeight}`;
    if (show && key !== this.layoutKey) {
      this.layoutKey = key;
      if (this.editing) this.ensureLayout();
      this.applyLayout();
      if (this.editing) this.placeGhost();
    }
  },

  orientation() { return innerWidth > innerHeight ? 'landscape' : 'portrait'; },
  /** The custom layout in use for this orientation, or null for the built-in one. */
  layout() { return settings.touch[this.orientation()]; },
  /** One pad unit in px: the size of a standard button, matching --u in the CSS. */
  unit() {
    return innerWidth > innerHeight ? Math.min(72, innerHeight * 0.15) : Math.min(64, (innerWidth - 60) / 5);
  },

  /** Screen space the pad covers, so the renderer can fit the board around it. */
  insets() {
    if (!this.shown) return { left: 0, right: 0, bottom: 0 };
    if (this.layout()) return this.freeInsets();
    if (innerWidth > innerHeight) {
      const side = Math.max($('pad-dpad').offsetWidth, $('pad-face').offsetWidth) + 36;
      return { left: side, right: side, bottom: 0 };
    }
    return { left: 0, right: 0, bottom: $('pad').offsetHeight };
  },

  /** For a custom layout: keep the board clear of buttons along the bottom (portrait) or sides (landscape). */
  freeInsets() {
    const W = innerWidth, H = innerHeight, gap = 8;
    const rects = [...$('pad-free').children].map(b => b.getBoundingClientRect());
    if (W > H) {
      let left = 0, right = 0;
      for (const r of rects) {
        if (r.left + r.width / 2 < W / 2) left = Math.max(left, r.right + gap);
        else right = Math.max(right, W - r.left + gap);
      }
      return { left: Math.min(left, W * 0.34), right: Math.min(right, W * 0.34), bottom: 0 };
    }
    let top = H;
    for (const r of rects) if (r.top + r.height / 2 > H / 2) top = Math.min(top, r.top - gap);
    return { left: 0, right: 0, bottom: Math.min(H - top, H * 0.5) };
  },

  /* ---------- custom layout ---------- */
  buildFree() {
    const box = $('pad-free');
    for (const id of PAD_BUTTONS) {
      const b = document.createElement('button');
      b.className = 'pbtn pfree';
      b.dataset.id = id;
      box.append(b);
      this.bindFree(b);
    }
  },

  /** Places the free buttons (or goes back to the grid pad when there is no custom layout). */
  applyLayout() {
    const l = this.layout();
    $('pad').classList.toggle('free', !!l);
    if (!l) return;
    const u = this.unit(), W = innerWidth, H = innerHeight;
    for (const b of $('pad-free').children) {
      const p = l[b.dataset.id];
      const w = p.w * u, h = p.h * u;
      const x = Math.min(W - w, Math.max(0, p.x * W - w / 2));
      const y = Math.min(H - h, Math.max(0, p.y * H - h / 2));
      Object.assign(b.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`,
        borderRadius: `${Math.min(18, Math.min(w, h) * 0.28)}px` });
      if (b.dataset.act !== p.a) {
        const face = PAD_FACES[p.a];
        b.dataset.act = p.a;
        b.dataset.lit = p.a;
        b.className = `pbtn pfree ${face.cls}`;
        b.innerHTML = face.html;
        b.setAttribute('aria-label', ACTION_LABELS[p.a]);
      }
      b.classList.toggle('picked', this.editing && this.selected === b.dataset.id);
    }
  },

  bindFree(b) {
    let drag = null;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) {} // synthetic pointers can't be captured
      if (this.editing) {
        const p = this.layout()[b.dataset.id];
        drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: p.x, y: p.y, moved: false };
        this.select(b.dataset.id);
      } else this.press(e.pointerId, b.dataset.act);
    });
    b.addEventListener('pointermove', (e) => {
      if (this.editing) {
        if (!drag || drag.id !== e.pointerId) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) < 6) return;
        drag.moved = true;
        const p = this.layout()[b.dataset.id];
        const round = v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
        p.x = round(drag.x + dx / innerWidth);
        p.y = round(drag.y + dy / innerHeight);
        this.changed();
        return;
      }
      // Slide between the move buttons without lifting the thumb.
      const held = this.held.get(e.pointerId);
      if (!held || !MOVE_ACTIONS.has(held)) return;
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const target = under && under.closest('.pfree');
      if (target && MOVE_ACTIONS.has(target.dataset.act)) this.press(e.pointerId, target.dataset.act);
    });
    const up = (e) => {
      if (this.editing) {
        if (drag && drag.id === e.pointerId && drag.moved) this.save();
        drag = null;
      } else this.release(e.pointerId);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  },

  /** Reads where the built-in pad puts each button, as a starting point for a custom layout. */
  measureDefault() {
    const pad = $('pad');
    pad.classList.remove('free');
    const u = this.unit(), W = innerWidth, H = innerHeight, out = {};
    for (const id of PAD_BUTTONS) {
      const el = pad.querySelector(`:scope > [data-lit="${id}"], :scope > div:not(#pad-free) [data-lit="${id}"]`);
      const r = el.getBoundingClientRect();
      const round = v => Math.round(v * 1000) / 1000;
      out[id] = { a: id, x: round((r.left + r.width / 2) / W), y: round((r.top + r.height / 2) / H),
        w: round(Math.max(0.5, r.width / u)), h: round(Math.max(0.5, r.height / u)) };
    }
    return out;
  },

  /* ---------- layout editor ---------- */
  initEditor() {
    $('btn-edit-pad').addEventListener('click', () => this.openEditor());
    $('pe-done').addEventListener('click', () => this.closeEditor());
    $('pe-reset').addEventListener('click', () => {
      const o = this.orientation();
      settings.touch[o] = null;
      this.ensureLayout(); // back to the built-in positions, and stays built-in unless edited again
      this.select(null);
      this.placeGhost();
      this.save();
    });
    const resize = (f) => {
      const p = this.selected && this.layout()[this.selected];
      if (!p) return;
      p.w = Math.min(4, Math.max(0.5, Math.round(p.w * f * 100) / 100));
      p.h = Math.min(4, Math.max(0.5, Math.round(p.h * f * 100) / 100));
      this.changed();
      this.save();
    };
    $('pe-smaller').addEventListener('click', () => resize(1 / 1.15));
    $('pe-bigger').addEventListener('click', () => resize(1.15));
    const acts = $('pe-acts');
    for (const a of ACTIONS) {
      const c = document.createElement('button');
      c.className = 'chip';
      c.dataset.act = a;
      c.setAttribute('role', 'radio');
      c.textContent = ACTION_LABELS[a];
      c.addEventListener('click', () => this.remap(a));
      acts.append(c);
    }
    for (const el of [$('pad-editor'), $('pad-editor-bar')]) el.addEventListener('touchmove', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    $('pad-editor').addEventListener('pointerdown', () => this.select(null));
  },

  openEditor() {
    Sound.unlock();
    this.releaseAll();
    this.editing = true;
    this.pristine = {};
    showScreen(null);
    $('pad-editor').classList.remove('hidden');
    $('pad-editor-bar').classList.remove('hidden');
    $('pad').classList.add('editing');
    this.shown = false;   // let sync() show the pad and place the buttons
    this.layoutKey = '';
    this.select(null);
    this.sync();
  },

  closeEditor() {
    for (const o of ['portrait', 'landscape']) if (this.pristine[o]) settings.touch[o] = null;
    this.editing = false;
    this.selected = null;
    saveSettings();
    $('pad-editor').classList.add('hidden');
    $('pad-editor-bar').classList.add('hidden');
    $('pad').classList.remove('editing');
    this.sync();
    this.describe();
    showScreen('settings');
    $('btn-edit-pad').focus();
  },

  /** While editing, every orientation gets a layout to work on, starting from the built-in one. */
  ensureLayout() {
    const o = this.orientation();
    if (!settings.touch[o]) {
      settings.touch[o] = this.measureDefault();
      this.pristine[o] = true;
    }
    $('pe-orient').textContent = o === 'portrait' ? 'PORTRAIT · ROTATE FOR LANDSCAPE' : 'LANDSCAPE · ROTATE FOR PORTRAIT';
  },

  select(id) {
    this.selected = id;
    $('pe-sel').classList.toggle('hidden', !id);
    $('pe-hint').classList.toggle('hidden', !!id);
    if (id) {
      const act = this.layout()[id].a;
      $('pe-sel-name').textContent = ACTION_LABELS[act].toUpperCase();
      for (const c of $('pe-acts').children) {
        c.classList.toggle('on', c.dataset.act === act);
        c.setAttribute('aria-checked', c.dataset.act === act);
      }
    }
    this.applyLayout();
  },

  /** Gives the selected button a new action; the button that had it takes the old one. */
  remap(act) {
    const l = this.layout(), p = this.selected && l[this.selected];
    if (!p || p.a === act) return;
    const other = PAD_BUTTONS.find(id => l[id].a === act);
    if (other) l[other].a = p.a;
    p.a = act;
    this.changed();
    this.select(this.selected);
    this.save();
  },

  changed() {
    this.pristine[this.orientation()] = false;
    this.applyLayout();
    this.placeGhost();
  },
  /** Outlines where the board would go with the buttons where they are now. */
  placeGhost() {
    const r = soloBoardRect();
    Object.assign($('ghost-board').style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  },
  save() { saveSettings(); },

  /** The Config row's summary of which layout is in use. */
  describe() {
    const custom = ['portrait', 'landscape'].filter(o => settings.touch[o]);
    $('pad-layout-state').textContent = custom.length
      ? `Custom layout (${custom.join(' & ')})` : 'Built-in layout. Move, resize and remap the buttons.';
  },
};
