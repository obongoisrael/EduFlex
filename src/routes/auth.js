/**
 * Authentication & profile routes.
 *
 * Real accounts: sign-up requires an email on a domain that can receive mail
 * (optionally university/college emails only — EDUFLEX_REQUIRE_EDU_EMAIL=1), plus a
 * strong password — or "Continue with Google". New accounts must confirm their email
 * (single-use link, 24h) before they can log in. Forgotten passwords are reset by
 * emailed link (single-use, 1h). Login attempts and emails are rate-limited.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, nowISO, makePublicUsername } = require('../db');
const { requireAuth, planActive, safe } = require('../middleware');
const {
  EMAIL_RE, isEducationEmail, domainAcceptsMail, passwordProblem,
  createToken, consumeToken, rateLimiter,
} = require('../services/authSecurity');
const { appUrl, sendVerificationEmail, sendPasswordResetEmail } = require('../services/mailer');
const { googleConfigured, authorizationUrl, exchangeCode, randomToken } = require('../services/googleAuth');

const router = express.Router();

const VERIFY_TTL = 24 * 60 * 60 * 1000;
const RESET_TTL = 60 * 60 * 1000;

// Brute-force / spam protection
const loginFails = rateLimiter(5, 15 * 60 * 1000);     // 5 wrong passwords per email+IP per 15 min
const loginFailsIp = rateLimiter(30, 15 * 60 * 1000);  // 30 per IP across all emails
const emailSends = rateLimiter(3, 15 * 60 * 1000);     // 3 verification/reset emails per address per 15 min
const registrations = rateLimiter(10, 60 * 60 * 1000); // 10 sign-ups per IP per hour

/** Only university/college emails? Off by default; set EDUFLEX_REQUIRE_EDU_EMAIL=1 to enable. */
const requireEduEmail = () => process.env.EDUFLEX_REQUIRE_EDU_EMAIL === '1';
const EDU_EMAIL_HELP = 'Please use your university or college email (for example name@students.ku.ac.ke or name@strathmore.edu).';

/** Async route wrapper: turns thrown errors into a 500 JSON response. */
const safeAsync = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

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
    email_verified: !!u.email_verified_at,
    has_password: !!u.password_hash,
    google_linked: !!u.google_sub,
    profile_complete: !!(u.institution && u.programme),
    institution: u.institution,
    programme: u.programme,
    role: u.role,
    account_status: u.account_status,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
    peer_matching_enabled: !!u.peer_matching_enabled,
    notification_preferences: prefs,
    plan: u.plan || 'free',
    plan_expires_at: u.plan_expires_at || null,
    is_plus: planActive(u),
  };
}

const normEmail = (e) => String(e || '').toLowerCase().trim();

/** Log a user in on a fresh session id (prevents session fixation). */
function startSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowISO(), nowISO(), userId);
      promoteOwnerAdmin(userId);
      resolve();
    });
  });
}

/**
 * Owner admins: accounts whose email is listed in EDUFLEX_ADMIN_EMAILS (comma-separated)
 * become admins when they sign in — for hosts without a shell to run `npm run make-admin`.
 * Only applies to confirmed emails, so nobody can claim an admin address they don't own.
 */
function promoteOwnerAdmin(userId) {
  const owners = (process.env.EDUFLEX_ADMIN_EMAILS || '').split(',').map(normEmail).filter(Boolean);
  if (!owners.length) return;
  const u = db.prepare('SELECT email, role, email_verified_at FROM users WHERE id = ?').get(userId);
  if (u && u.email_verified_at && u.role !== 'admin' && owners.includes(u.email)) {
    db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").run(nowISO(), userId);
    console.log(`Granted admin to owner account ${u.email} (EDUFLEX_ADMIN_EMAILS).`);
  }
}

/** Sign out every device for a user (after a password reset). */
function endAllSessions(userId) {
  db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(userId);
}

async function sendVerification(req, user) {
  const token = createToken(user.id, 'verify', VERIFY_TTL);
  await sendVerificationEmail(user, `${appUrl(req)}/api/auth/verify?token=${encodeURIComponent(token)}`);
}

// POST /api/auth/register — creates an unverified account and emails a confirmation link
router.post('/register', safeAsync(async (req, res) => {
  const { first_name, last_name, password, institution, programme } = req.body || {};
  const email = normEmail(req.body && req.body.email);

  // Server-side validation (forms are also validated client-side)
  const errors = [];
  if (!first_name || !String(first_name).trim()) errors.push('First name is required.');
  if (!last_name || !String(last_name).trim()) errors.push('Last name is required.');
  if (!EMAIL_RE.test(email)) errors.push('A valid email address is required.');
  else if (requireEduEmail() && !isEducationEmail(email)) errors.push(EDU_EMAIL_HELP);
  const pwProblem = passwordProblem(password, { email });
  if (pwProblem) errors.push(pwProblem);
  if (!institution || !String(institution).trim()) errors.push('Institution is required.');
  if (!programme || !String(programme).trim()) errors.push('Programme is required.');
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const ipKey = `register:${req.ip}`;
  if (registrations.limited(ipKey)) return res.status(429).json({ error: 'Too many sign-ups from this network. Please try again later.' });

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    if (existing.email_verified_at) return res.status(409).json({ error: 'An account with this email already exists. Log in, or use "Forgot password".' });
    // Signed up before but never confirmed — send a fresh link instead of failing
    if (!emailSends.limited(`mail:${email}`)) { emailSends.hit(`mail:${email}`); await sendVerification(req, existing); }
    return res.status(200).json({ verification_sent: true, email });
  }

  if (!(await domainAcceptsMail(email))) {
    return res.status(400).json({ error: `We couldn't find a mail server for "${email.split('@')[1]}". Check the spelling of your email.` });
  }

  registrations.hit(ipKey);
  const ts = nowISO();
  const info = db.prepare(
    `INSERT INTO users (first_name, last_name, public_username, email, password_hash, institution, programme, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    String(first_name).trim(), String(last_name).trim(), makePublicUsername(first_name, last_name),
    email, bcrypt.hashSync(password, 10),
    String(institution).trim(), String(programme).trim(), ts, ts
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));

  let emailSent = true;
  try {
    emailSends.hit(`mail:${email}`);
    await sendVerification(req, user);
  } catch (err) {
    console.error('Verification email failed:', err.message);
    emailSent = false; // the account exists; the student can press "Resend"
  }
  res.status(201).json({ verification_sent: emailSent, email });
}));

// GET /api/auth/verify?token=… — the link in the confirmation email
router.get('/verify', safeAsync(async (req, res) => {
  const userId = consumeToken(String(req.query.token || ''), 'verify');
  if (!userId) return res.redirect('/login.html?verify=invalid');
  db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?')
    .run(nowISO(), nowISO(), userId);
  const user = db.prepare('SELECT account_status FROM users WHERE id = ?').get(userId);
  if (!user || user.account_status !== 'active') return res.redirect('/login.html?verified=1');
  await startSession(req, userId);
  const hasCourses = db.prepare('SELECT 1 FROM courses WHERE user_id = ? LIMIT 1').get(userId);
  res.redirect(hasCourses ? '/app.html#/dashboard' : '/app.html#/setup');
}));

// POST /api/auth/resend-verification — same response whether or not the account exists
router.post('/resend-verification', safeAsync(async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const key = `mail:${email}`;
  if (EMAIL_RE.test(email) && !emailSends.limited(key)) {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user && !user.email_verified_at) { emailSends.hit(key); await sendVerification(req, user); }
  }
  res.json({ ok: true, message: 'If that account is waiting for confirmation, a new link is on its way.' });
}));

// POST /api/auth/login
router.post('/login', safeAsync(async (req, res) => {
  const { password } = req.body || {};
  const email = normEmail(req.body && req.body.email);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const key = `login:${email}:${req.ip}`, ipKey = `login-ip:${req.ip}`;
  if (loginFails.limited(key) || loginFailsIp.limited(ipKey)) {
    return res.status(429).json({ error: 'Too many failed attempts. Wait 15 minutes, or reset your password.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user && !user.password_hash) {
    return res.status(400).json({ error: 'This account signs in with Google. Use "Continue with Google", or set a password with "Forgot password".', google_only: true });
  }
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    loginFails.hit(key); loginFailsIp.hit(ipKey);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  loginFails.reset(key);
  if (!user.email_verified_at) {
    return res.status(403).json({ error: 'Please confirm your email first — check your inbox for the link.', needs_verification: true });
  }
  if (user.account_status !== 'active') return res.status(403).json({ error: 'This account is inactive. Contact your EduFlex administrator.' });

  await startSession(req, user.id);
  res.json({ user: publicProfile(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
}));

// POST /api/auth/forgot — emails a reset link; same response whether or not the account exists
router.post('/forgot', safeAsync(async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const key = `mail:${email}`;
  if (EMAIL_RE.test(email) && !emailSends.limited(key)) {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user && user.account_status === 'active') {
      emailSends.hit(key);
      const token = createToken(user.id, 'reset', RESET_TTL);
      await sendPasswordResetEmail(user, `${appUrl(req)}/reset.html?token=${encodeURIComponent(token)}`);
    }
  }
  res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
}));

// POST /api/auth/reset — set a new password using the emailed link
router.post('/reset', safeAsync(async (req, res) => {
  const { token, password } = req.body || {};
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  const userId = consumeToken(String(token || ''), 'reset');
  if (!userId) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });

  // Following the emailed link also proves the address is theirs
  db.prepare('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), nowISO(), nowISO(), userId);
  endAllSessions(userId); // sign out everywhere — the old password may have been compromised
  res.json({ ok: true });
}));

// GET /api/auth/config — which sign-in options the login/register pages should show
router.get('/config', (req, res) => {
  res.json({ google: googleConfigured(), require_edu_email: requireEduEmail() });
});

/* ---------- Continue with Google ---------- */

const googleRedirectUri = (req) => `${appUrl(req)}/api/auth/google/callback`;
const GOOGLE_FLOW_TTL = 10 * 60 * 1000;

// GET /api/auth/google — send the browser to Google's account chooser
router.get('/google', (req, res) => {
  if (!googleConfigured()) return res.redirect('/login.html?google=unavailable');
  // state blocks forged callbacks (CSRF); nonce ties the ID token to this attempt
  req.session.googleOAuth = { state: randomToken(), nonce: randomToken(), at: Date.now() };
  req.session.save(() => res.redirect(authorizationUrl({
    redirectUri: googleRedirectUri(req), state: req.session.googleOAuth.state, nonce: req.session.googleOAuth.nonce,
  })));
});

// GET /api/auth/google/callback — Google sends the student back here
router.get('/google/callback', safeAsync(async (req, res) => {
  const flow = req.session.googleOAuth;
  delete req.session.googleOAuth;
  const fail = (reason) => res.redirect(`/login.html?google=${reason}`);

  if (req.query.error) return fail('cancelled'); // e.g. the student closed the Google screen
  if (!flow || !req.query.state || req.query.state !== flow.state || Date.now() - flow.at > GOOGLE_FLOW_TTL || !req.query.code) {
    return fail('error');
  }

  let g;
  try {
    g = await exchangeCode({ code: String(req.query.code), redirectUri: googleRedirectUri(req), nonce: flow.nonce });
  } catch (err) {
    console.error('Google sign-in failed:', err.message);
    return fail(err.code === 'EMAIL_NOT_VERIFIED' ? 'unverified' : 'error');
  }

  // Find the account: by Google id, else by email (link it — Google has verified the address)
  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(g.sub);
  if (!user) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(g.email);
    if (user) {
      db.prepare('UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?')
        .run(g.sub, nowISO(), nowISO(), user.id);
    } else {
      if (requireEduEmail() && !isEducationEmail(g.email)) return fail('school');
      const parts = (g.name || '').trim().split(/s+/);
      const first = (g.given_name || parts[0] || g.email.split('@')[0]).trim().slice(0, 60);
      const last = (g.family_name || parts.slice(1).join(' ') || '').trim().slice(0, 60);
      const ts = nowISO();
      // No password (they sign in with Google); institution/programme are asked for on first visit
      const info = db.prepare(
        `INSERT INTO users (first_name, last_name, public_username, email, password_hash, institution, programme,
                            google_sub, email_verified_at, created_at, updated_at)
         VALUES (?,?,?,?, '', '', '', ?,?,?,?)`
      ).run(first, last, makePublicUsername(first, last || first.slice(1)), g.email, g.sub, ts, ts, ts);
      user = { id: Number(info.lastInsertRowid), account_status: 'active' };
    }
  }
  if (user.account_status !== 'active') return fail('inactive');

  await startSession(req, user.id);
  const hasCourses = db.prepare('SELECT 1 FROM courses WHERE user_id = ? LIMIT 1').get(user.id);
  res.redirect(hasCourses ? '/app.html#/dashboard' : '/app.html#/setup');
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

// PUT /api/auth/profile — update profile (regenerates initials if name changes).
// Changing the password requires the current password.
router.put('/profile', requireAuth, safe((req, res) => {
  const { first_name, last_name, institution, programme, password, current_password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const fn = (first_name || user.first_name).trim();
  const ln = (last_name || user.last_name).trim();
  const inst = (institution || user.institution).trim();
  const prog = (programme || user.programme).trim();
  if (!fn || !ln || !inst || !prog) return res.status(400).json({ error: 'Fields cannot be empty.' });

  let hash = user.password_hash;
  if (password) {
    if (user.password_hash && (!current_password || !bcrypt.compareSync(String(current_password), user.password_hash))) {
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    const problem = passwordProblem(password, { email: user.email });
    if (problem) return res.status(400).json({ error: problem });
    hash = bcrypt.hashSync(password, 10);
  }
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
