'use strict';

/* =========================================================================
 * INPUT HANDLER (keyboard -> per-player action events)
 * ========================================================================= */
const Input = {
  bindings: [], // [{ game, keys }]
  capture: null, // callback while rebinding a key
  init() {
    window.addEventListener('keydown', e => this.onKey(e, 'down'));
    window.addEventListener('keyup', e => this.onKey(e, 'up'));
    window.addEventListener('blur', () => {
      this.releaseAll();
      if (App.inGame() && !App.paused && App.mode !== 'online') App.setPaused(true);
    });
  },
  bind(list) { this.bindings = list; },
  releaseAll() { for (const b of this.bindings) b.game.releaseAll(); },
  onKey(e, type) {
    if (this.capture) {
      if (type === 'down') { e.preventDefault(); const cb = this.capture; this.capture = null; cb(e.code); }
      return;
    }
    if (e.code === 'Escape') {
      if (type === 'down' && !e.repeat) App.onEscape();
      return;
    }
    if (type === 'down' && !e.repeat && App.onHotkey(e.code)) { e.preventDefault(); return; }
    if (!App.inGame() || App.paused) return;
    let used = false;
    for (const b of this.bindings) {
      for (const action of ACTIONS) {
        if (b.keys[action] === e.code) {
          used = true;
          if (!(type === 'down' && e.repeat)) b.game.input(type, action);
        }
      }
    }
    if (used) e.preventDefault();
  },
};

function keyLabel(code) {
  if (!code) return '—';
  const named = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt', Space: 'Space',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
