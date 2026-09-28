'use strict';

/* =========================================================================
 * ACCOUNT STORE
 * A small JSON-file database of accounts and login sessions. Writes are
 * batched and atomic (temp file + rename), which is plenty for a class-sized
 * player base and needs no database setup.
 * ========================================================================= */
const fs = require('fs');
const path = require('path');

const SAVE_DELAY_MS = 200;

function emptyData() {
  return { users: {}, sessions: {}, nextUserId: 1 };
}

class Store {
  /** @param {string|null} file  JSON file to persist to; null keeps everything in memory (tests). */
  constructor(file) {
    this.file = file;
    this.data = emptyData();
    this.timer = null;
    if (file && fs.existsSync(file)) {
      try {
        this.data = Object.assign(emptyData(), JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (e) {
        // Keep the unreadable file for inspection rather than overwriting it.
        const bad = `${file}.corrupt-${Date.now()}`;
        fs.renameSync(file, bad);
        console.error(`Account database was unreadable; moved it to ${bad} and started fresh.`);
      }
    }
  }

  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /* ---------- users ---------- */
  userByDcismId(id) {
    const i = id.toLowerCase();
    return Object.values(this.data.users).find(u => u.dcismId === i) || null;
  }
  userByName(name) {
    const n = name.toLowerCase();
    return Object.values(this.data.users).find(u => u.username.toLowerCase() === n) || null;
  }
  user(id) { return this.data.users[id] || null; }

  addUser(fields) {
    const id = String(this.data.nextUserId++);
    const user = { id, createdAt: Date.now(), records: {}, ...fields };
    this.data.users[id] = user;
    this.save();
    return user;
  }
  updateUser(user) { this.data.users[user.id] = user; this.save(); }

  /* ---------- sessions ---------- */
  getSession(tokenHash) { return this.data.sessions[tokenHash] || null; }
  setSession(tokenHash, entry) { this.data.sessions[tokenHash] = entry; this.save(); }
  deleteSession(tokenHash) { delete this.data.sessions[tokenHash]; this.save(); }
  deleteSessionsFor(userId) {
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.userId === userId) delete this.data.sessions[k];
    this.save();
  }

  /** Drop expired sessions. */
  prune(now = Date.now()) {
    let changed = false;
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.expires < now) { delete this.data.sessions[k]; changed = true; }
    if (changed) this.save();
  }
}

module.exports = { Store };
