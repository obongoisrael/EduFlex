/**
 * Authentication & profile routes.
 * Register / login / logout / current-user / profile update.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, nowISO, makePublicUsername } = require('../db');
const { requireAuth, safe } = require('../middleware');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Strip private fields before sending a user object to the client (their own profile). */
function publicProfile(u) {
  let prefs = {};
  try { prefs = JSON.parse(u.notification_preferences || '{}'); } catch { /* keep default */ }
  return {
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    public_username: u.public_username,
    email: u.email,
    institution: u.institution,
    programme: u.programme,
    role: u.role,
    account_status: u.account_status,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
    peer_matching_enabled: !!u.peer_matching_enabled,
    notification_preferences: prefs,
  };
}

// POST /api/auth/register
router.post('/register', safe((req, res) => {
  const { first_name, last_name, email, password, institution, programme } = req.body || {};

  // Server-side validation (forms are also validated client-side)
  const errors = [];
  if (!first_name || !first_name.trim()) errors.push('First name is required.');
  if (!last_name || !last_name.trim()) errors.push('Last name is required.');
  if (!email || !EMAIL_RE.test(email)) errors.push('A valid email address is required.');
  if (!password || password.length < 6) errors.push('Password must be at least 6 characters.');
  if (!institution || !institution.trim()) errors.push('Institution is required.');
  if (!programme || !programme.trim()) errors.push('Programme is required.');
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  // Public username = initials only (privacy rule: full name stays private)
  const publicUsername = makePublicUsername(first_name, last_name);
  const ts = nowISO();
  const info = db.prepare(
    `INSERT INTO users (first_name, last_name, public_username, email, password_hash, institution, programme, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    first_name.trim(), last_name.trim(), publicUsername,
    email.toLowerCase().trim(), bcrypt.hashSync(password, 10),
    institution.trim(), programme.trim(), ts, ts
  );

  req.session.userId = Number(info.lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowISO(), nowISO(), req.session.userId);
  res.status(201).json({ user: publicProfile(user) });
}));

// POST /api/auth/login
router.post('/login', safe((req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  req.session.userId = user.id;
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowISO(), nowISO(), user.id);
  res.json({ user: publicProfile(user) });
}));

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/me — current logged-in user
router.get('/me', requireAuth, safe((req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  res.json({ user: publicProfile(user) });
}));

// PUT /api/auth/profile — update profile (regenerates initials if name changes)
router.put('/profile', requireAuth, safe((req, res) => {
  const { first_name, last_name, institution, programme, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const fn = (first_name || user.first_name).trim();
  const ln = (last_name || user.last_name).trim();
  const inst = (institution || user.institution).trim();
  const prog = (programme || user.programme).trim();
  if (!fn || !ln || !inst || !prog) return res.status(400).json({ error: 'Fields cannot be empty.' });
  if (password && password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

  const hash = password ? bcrypt.hashSync(password, 10) : user.password_hash;
  const publicUsername = makePublicUsername(fn, ln);

  // Notification preferences (Phase 2 §7): stored as JSON, e.g. { browser: true, sound: true }
  let prefsJson = user.notification_preferences || '{}';
  if (req.body.notification_preferences && typeof req.body.notification_preferences === 'object') {
    const p = req.body.notification_preferences;
    prefsJson = JSON.stringify({ browser: !!p.browser, sound: !!p.sound });
  }

  db.prepare(
    `UPDATE users SET first_name=?, last_name=?, public_username=?, institution=?, programme=?, password_hash=?,
       notification_preferences=?, updated_at=?
     WHERE id=?`
  ).run(fn, ln, publicUsername, inst, prog, hash, prefsJson, nowISO(), user.id);

  // Keep resources' contributor initials in sync with the profile
  db.prepare('UPDATE resources SET public_username=?, institution=? WHERE user_id=?')
    .run(publicUsername, inst, user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ user: publicProfile(updated) });
}));

module.exports = router;
