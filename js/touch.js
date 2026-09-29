'use strict';

/* =========================================================================
 * TOUCH CONTROLS
 * An on-screen controller for phones and tablets. Portrait puts the board on
 * top and the pad underneath; landscape splits the pad to either side.
 *   D-pad: left / right / soft drop (no up: hard drop has its own button)
 *   DROP: hard drop
 *   Face buttons: rotate CCW, rotate CW, rotate 180, hold
 * The pad feeds the same Game.input() events as the keyboard, so DAS, ARR and
 * soft drop speed follow the player's handling settings.
 * ========================================================================= */
const Touch = {
  enabled: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  shown: false,
  held: new Map(), // pointerId -> action currently pressed by that pointer

  init() {
    window.addEventListener('touchstart', () => this.enable(), { passive: true, once: true });
    if (this.enabled) this.enable();
    const pad = $('pad');
    for (const btn of pad.querySelectorAll('[data-act]')) this.bindButton(btn, btn.dataset.act);
    this.bindDpad($('pad-dpad'));
    $('pad-menu').addEventListener('click', () => { this.releaseAll(); App.onEscape(); });
    $('pad-retry').addEventListener('click', () => { this.releaseAll(); if (App.mode && App.mode !== 'versus' && App.mode !== 'online') App.start(App.mode); });
    // Keep the page from scrolling or zooming under a thumb.
    pad.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
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

  /** One zone for the whole D-pad so a thumb can slide between directions. */
  bindDpad(el) {
    const dirAt = (e, starting) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      if (Math.hypot(dx, dy) < 0.12) return starting ? null : this.held.get(e.pointerId) || null;
      if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
      return dy > 0 ? 'soft' : null; // nothing above the hub
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.press(e.pointerId, dirAt(e, true));
    });
    el.addEventListener('pointermove', (e) => {
      if (this.held.has(e.pointerId) || el.hasPointerCapture(e.pointerId)) this.press(e.pointerId, dirAt(e, false));
    });
    const up = (e) => this.release(e.pointerId);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  },

  /** Called every frame: show the pad only while playing. */
  sync() {
    const show = this.enabled && App.inGame() && !App.paused;
    if (show !== this.shown) {
      this.shown = show;
      $('pad').classList.toggle('hidden', !show);
      if (!show) this.releaseAll();
    }
    const solo = App.mode && App.mode !== 'versus' && App.mode !== 'online';
    $('pad-retry').classList.toggle('hidden', !solo);
  },

  /** Screen space the pad covers, so the renderer can fit the board around it. */
  insets() {
    if (!this.shown) return { left: 0, right: 0, bottom: 0 };
    if (innerWidth > innerHeight) {
      const side = Math.max($('pad-dpad').offsetWidth, $('pad-face').offsetWidth) + 28;
      return { left: side, right: side, bottom: 0 };
    }
    return { left: 0, right: 0, bottom: $('pad').offsetHeight };
  },
};
