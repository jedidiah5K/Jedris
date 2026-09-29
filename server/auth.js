'use strict';

/* =========================================================================
 * ACCOUNTS
 * Players sign up with their DCISM ID (e.g. s23105047), a display name and a
 * password of their own. Passwords are hashed with scrypt; login sessions are
 * random bearer tokens (only their SHA-256 is stored).
 *
 *   POST /api/auth/signup    {dcismId, username, password}  -> {token, user}
 *   POST /api/auth/login     {login, password}              -> {token, user}
 *   POST /api/auth/password  {current, password}            -> {token, user}
 *   POST /api/auth/logout
 *   GET  /api/auth/me                                       -> {user}
 *   POST /api/records        {mode, value}                  -> {records}
 *   PUT  /api/settings       {settings}                     -> {ok}
 *   GET  /api/leaderboard                                   -> {players: [{username, wins, losses}]}
 * ========================================================================= */
const crypto = require('crypto');
const express = require('express');

const DCISM_ID_RE = /^[a-z]\d{7,9}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECORD_MODES = { sprint: 'lower', blitz: 'higher' };
const SETTINGS_MAX_BYTES = 4096;
const LEADERBOARD_SIZE = 50;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function checkPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored).split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
function passwordError(password) {
  if (password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return 'That password is too long.';
  return null;
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, dcismId: u.dcismId, records: u.records || {},
    wins: u.wins || 0, losses: u.losses || 0, settings: u.settings || null, createdAt: u.createdAt,
  };
}

/** Very small fixed-window rate limiter keyed by client IP. */
function rateLimit(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
    next();
  };
}

class Auth {
  /**
   * @param {object} opts
   *   store  Store instance
   *   now    () => ms (tests)
   */
  constructor({ store, now = Date.now }) {
    this.store = store;
    this.now = now;
    setInterval(() => store.prune(this.now()), 10 * 60 * 1000).unref();
  }

  /* ---------- sessions ---------- */
  createSession(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.store.setSession(sha256(token), { userId: user.id, expires: this.now() + SESSION_TTL_MS });
    return token;
  }
  /** Returns the account for a bearer token, or null. */
  userForToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const s = this.store.getSession(sha256(token));
    if (!s || s.expires < this.now()) return null;
    return this.store.user(s.userId);
  }
  tokenFrom(req) {
    const h = req.get('authorization') || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  }
  /** True when a guest name would pass for someone's account name. */
  isAccountName(name) {
    return !!this.store.userByName(String(name));
  }

  /** Counts a finished online match. Only matches between two different accounts count. */
  recordMatch(winnerId, loserId) {
    if (!winnerId || !loserId || winnerId === loserId) return;
    const w = this.store.user(winnerId), l = this.store.user(loserId);
    if (!w || !l) return;
    w.wins = (w.wins || 0) + 1;
    l.losses = (l.losses || 0) + 1;
    this.store.updateUser(w);
    this.store.updateUser(l);
  }

  leaderboard() {
    return this.store.allUsers()
      .filter(u => u.wins > 0)
      .sort((a, b) => b.wins - a.wins || (a.losses || 0) - (b.losses || 0) || a.username.localeCompare(b.username))
      .slice(0, LEADERBOARD_SIZE)
      .map(u => ({ username: u.username, wins: u.wins, losses: u.losses || 0 }));
  }

  /* ---------- routes ---------- */
  router() {
    const r = express.Router();
    r.use(express.json({ limit: '8kb' }));
    r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const signupLimit = rateLimit(10, 10 * 60 * 1000);
    const loginLimit = rateLimit(40, 10 * 60 * 1000);
    const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
      console.error('auth error:', e);
      res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
    });
    const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const pass = (v) => (typeof v === 'string' ? v : '');
    const signedIn = (req, res) => {
      const user = this.userForToken(this.tokenFrom(req));
      if (!user) res.status(401).json({ error: 'You are signed out. Sign in again.' });
      return user;
    };

    r.post('/auth/signup', signupLimit, wrap(async (req, res) => {
      const dcismId = str(req.body.dcismId, 20).toLowerCase();
      const username = str(req.body.username, 32);
      const password = pass(req.body.password);
      if (!DCISM_ID_RE.test(dcismId)) return res.status(400).json({ error: 'Enter your DCISM ID, like s23105047.', field: 'dcismId' });
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Display names are 3–16 letters, numbers or underscores.', field: 'username' });
      const pwErr = passwordError(password);
      if (pwErr) return res.status(400).json({ error: pwErr, field: 'password' });
      if (this.store.userByDcismId(dcismId)) return res.status(409).json({ error: 'That DCISM ID already has an account. Sign in instead.', field: 'dcismId' });
      if (this.store.userByName(username)) return res.status(409).json({ error: 'That display name is taken.', field: 'username' });
      const user = this.store.addUser({ dcismId, username, passHash: hashPassword(password) });
      res.json({ token: this.createSession(user), user: publicUser(user) });
    }));

    r.post('/auth/login', loginLimit, wrap(async (req, res) => {
      const login = str(req.body.login, 40);
      const user = DCISM_ID_RE.test(login.toLowerCase())
        ? this.store.userByDcismId(login)
        : this.store.userByName(login);
      if (!user || !checkPassword(pass(req.body.password), user.passHash)) {
        return res.status(401).json({ error: 'Wrong DCISM ID or password.' });
      }
      res.json({ token: this.createSession(user), user: publicUser(user) });
    }));

    r.post('/auth/password', loginLimit, wrap(async (req, res) => {
      const user = signedIn(req, res);
      if (!user) return;
      if (!checkPassword(pass(req.body.current), user.passHash)) return res.status(401).json({ error: 'Your current password is wrong.', field: 'current' });
      const password = pass(req.body.password);
      const pwErr = passwordError(password);
      if (pwErr) return res.status(400).json({ error: pwErr, field: 'password' });
      user.passHash = hashPassword(password);
      this.store.updateUser(user);
      this.store.deleteSessionsFor(user.id); // signs out other devices
      res.json({ token: this.createSession(user), user: publicUser(user) });
    }));

    r.post('/auth/logout', wrap(async (req, res) => {
      const token = this.tokenFrom(req);
      if (token) this.store.deleteSession(sha256(token));
      res.json({ ok: true });
    }));

    r.get('/auth/me', wrap(async (req, res) => {
      const user = signedIn(req, res);
      if (user) res.json({ user: publicUser(user) });
    }));

    r.post('/records', wrap(async (req, res) => {
      const user = signedIn(req, res);
      if (!user) return;
      const mode = req.body.mode;
      const value = Number(req.body.value);
      const dir = RECORD_MODES[mode];
      if (!dir || !Number.isFinite(value) || value <= 0 || value > 1e9) return res.status(400).json({ error: 'Bad record.' });
      user.records = user.records || {};
      const prev = user.records[mode];
      if (prev == null || (dir === 'lower' ? value < prev : value > prev)) {
        user.records[mode] = Math.round(value);
        this.store.updateUser(user);
      }
      res.json({ records: user.records });
    }));

    r.put('/settings', wrap(async (req, res) => {
      const user = signedIn(req, res);
      if (!user) return;
      const settings = req.body.settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings) || JSON.stringify(settings).length > SETTINGS_MAX_BYTES) {
        return res.status(400).json({ error: 'Bad settings.' });
      }
      user.settings = settings;
      this.store.updateUser(user);
      res.json({ ok: true });
    }));

    r.get('/leaderboard', wrap(async (req, res) => {
      res.json({ players: this.leaderboard() });
    }));

    return r;
  }
}

/** Sets a new password from the command line (for forgotten passwords). */
function resetPassword(store, dcismId, password) {
  const user = store.userByDcismId(dcismId);
  if (!user) throw new Error(`No account uses ${dcismId}.`);
  const err = passwordError(password);
  if (err) throw new Error(err);
  user.passHash = hashPassword(password);
  store.updateUser(user);
  store.deleteSessionsFor(user.id);
  store.flush();
  return user;
}

module.exports = { Auth, DCISM_ID_RE, USERNAME_RE, hashPassword, checkPassword, resetPassword };
