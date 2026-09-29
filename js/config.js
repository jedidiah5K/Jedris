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

const VERSION = '1.6.0';
const REPO_URL = 'https://github.com/jedidiah5K/Jedris';
const PREFERS_REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const DEFAULT_SETTINGS = {
  das: 167, arr: 33, sdf: 20, sdfInstant: false, dasCut: false,
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

const SETTINGS_VERSION = 3;

/** Copies saved values over a fresh copy of the defaults, ignoring anything unknown. */
function mergeSettings(saved) {
  const s = clone(DEFAULT_SETTINGS);
  if (!saved || typeof saved !== 'object') return s;
  saved = { ...saved };
  // Earlier versions shipped other auto-repeat defaults (v1: DAS 133 / ARR 10,
  // v2: 120 / 120). Players who never changed them get the current default.
  const oldDefault = (!(saved.v >= 2) && saved.das === 133 && saved.arr === 10)
    || (!(saved.v >= 3) && saved.das === 120 && saved.arr === 120);
  if (oldDefault) { delete saved.das; delete saved.arr; }
  for (const k of Object.keys(s)) if (k !== 'keys' && k in saved && typeof saved[k] === typeof s[k]) s[k] = saved[k];
  if (saved.keys && typeof saved.keys === 'object') {
    for (const p of ['p1', 'p2']) {
      const keys = saved.keys[p];
      if (keys && typeof keys === 'object') for (const a of ACTIONS) if (typeof keys[a] === 'string') s.keys[p][a] = keys[a];
    }
    if (typeof saved.keys.retry === 'string') s.keys.retry = saved.keys.retry;
  }
  return s;
}
function loadSettings() {
  try { return mergeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); } catch (e) { return clone(DEFAULT_SETTINGS); }
}
/** Replaces the live settings object's contents (e.g. with the copy saved to an account). */
function applySettings(obj) {
  Object.assign(settings, mergeSettings(obj));
}
let onSettingsSaved = null; // set by Account to copy changes to the signed-in account
function saveSettings(fromAccount) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, v: SETTINGS_VERSION })); } catch (e) {}
  if (!fromAccount && onSettingsSaved) onSettingsSaved();
}
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function saveRecords(r) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); } catch (e) {}
}

const settings = loadSettings();
