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
    // Keep the page from scrolling or zooming under a thumb. Safari ignores
    // touch-action for double-tap zoom and shows its magnifier on long presses,
    // so the controls cancel the touch itself (pointer events still fire).
    const stop = e => { if (e.cancelable) e.preventDefault(); };
    for (const el of [$('pad-dpad'), $('pad-face'), $('pad-drop'), canvas]) {
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
      const side = Math.max($('pad-dpad').offsetWidth, $('pad-face').offsetWidth) + 36;
      return { left: side, right: side, bottom: 0 };
    }
    return { left: 0, right: 0, bottom: $('pad').offsetHeight };
  },
};
