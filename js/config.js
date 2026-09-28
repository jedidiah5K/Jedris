'use strict';

/* =========================================================================
 * CONFIG
 * ========================================================================= */
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 2;
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const NEXT_COUNT = 5;
const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;
const GARBAGE_DELAY = 500;
const GARBAGE_CAP = 8;          // max garbage rows inserted per piece
const COUNTDOWN_MS = 3000;
const SPRINT_LINES = 40;
const BLITZ_MS = 120000;
const BLITZ_LINES_PER_LEVEL = 10;
const VERSUS_WINS = 2;          // best of 3

const ACTIONS = ['left', 'right', 'soft', 'hard', 'ccw', 'cw', 'r180', 'hold'];
const ACTION_LABELS = { left: 'Move left', right: 'Move right', soft: 'Soft drop', hard: 'Hard drop',
  ccw: 'Rotate CCW', cw: 'Rotate CW', r180: 'Rotate 180°', hold: 'Hold' };

const VERSION = '1.2.0';
const REPO_URL = 'https://github.com/jedidiah5K/Jedris';
const PREFERS_REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const DEFAULT_SETTINGS = {
  das: 133, arr: 10, sdf: 20, sdfInstant: false, dasCut: false,
  ghost: true, shake: !PREFERS_REDUCED_MOTION, flash: true, sound: true, volume: 0.5,
  keys: {
    p1: { left: 'KeyA', right: 'KeyD', soft: 'KeyS', hard: 'KeyW', ccw: 'KeyQ', cw: 'KeyE', r180: 'KeyR', hold: 'ShiftLeft' },
    p2: { left: 'ArrowLeft', right: 'ArrowRight', soft: 'ArrowDown', hard: 'ArrowUp', ccw: 'Comma', cw: 'Period', r180: 'Slash', hold: 'ShiftRight' },
    retry: 'Backquote', // quick restart in solo modes
  },
};

const STORAGE_KEY = 'jedris.settings.v1';
const RECORDS_KEY = 'jedris.records.v1';

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function loadSettings() {
  const s = clone(DEFAULT_SETTINGS);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(s)) if (k !== 'keys' && k in saved) s[k] = saved[k];
      if (saved.keys) {
        for (const p of ['p1', 'p2']) Object.assign(s.keys[p], saved.keys[p] || {});
        if (typeof saved.keys.retry === 'string') s.keys.retry = saved.keys.retry;
      }
    }
  } catch (e) { /* storage unavailable: use defaults */ }
  return s;
}
function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) {}
}
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function saveRecords(r) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); } catch (e) {}
}

const settings = loadSettings();
