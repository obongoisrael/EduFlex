/**
 * SQLite-backed session store for express-session.
 * Keeps users logged in across server restarts (the default MemoryStore
 * forgets all sessions whenever the server restarts, which shows up as a
 * blank/redirected app after a restart).
 */
const { Store } = require('express-session');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

class SQLiteStore extends Store {
  constructor(db) {
    super();
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      sess    TEXT NOT NULL,
      expires INTEGER NOT NULL
    )`);
    // Clean out expired sessions on startup
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      const expires = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + WEEK_MS;
      this.db.prepare(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?,?,?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`
      ).run(sid, JSON.stringify(sess), expires);
      if (cb) cb(null);
    } catch (err) { if (cb) cb(err); }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (cb) cb(null);
    } catch (err) { if (cb) cb(err); }
  }

  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

module.exports = { SQLiteStore };
