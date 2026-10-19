/**
 * Authentication security helpers:
 *  - education email rule (university / college domains only)
 *  - check that the email domain can actually receive mail (MX lookup)
 *  - password strength rules
 *  - single-use, expiring tokens for email verification and password reset
 *  - simple in-memory rate limiting against password guessing and email spam
 */
const crypto = require('crypto');
const dns = require('dns').promises;
const { db, nowISO } = require('../db');

/* ---------- education emails ---------- */

const EMAIL_RE = /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;

// Extra allowed domains (comma-separated), for institutions that don't use .edu / .ac.xx,
// e.g. EDUFLEX_EMAIL_DOMAINS=strathmore.edu,mylearning.college.org
function extraDomains() {
  return (process.env.EDUFLEX_EMAIL_DOMAINS || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
}

/**
 * Is this a university/college email? Accepts:
 *   *.edu (US and e.g. strathmore.edu), *.edu.xx (e.g. .edu.au, .edu.ng),
 *   *.ac.xx (e.g. ku.ac.ke, students.uonbi.ac.ke, ox.ac.uk, ac.za, ac.ug, ac.tz),
 *   plus any domain listed in EDUFLEX_EMAIL_DOMAINS (and its subdomains).
 */
function isEducationEmail(email) {
  if (!EMAIL_RE.test(String(email || ''))) return false;
  const domain = email.split('@')[1].toLowerCase();
  if (/\.edu$/.test(domain) || /\.(edu|ac)\.[a-z]{2}$/.test(domain)) return true;
  return extraDomains().some(d => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Can this domain receive email? Looks up MX (then A) records.
 * Returns false only when DNS says the domain has no mail setup; DNS outages
 * don't block sign-up. Skipped when EDUFLEX_SKIP_MX_CHECK=1 (tests, offline dev).
 */
async function domainAcceptsMail(email) {
  if (process.env.EDUFLEX_SKIP_MX_CHECK === '1') return true;
  const domain = email.split('@')[1];
  const NO_DOMAIN = ['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN'];
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length) return true;
  } catch (err) {
    if (!NO_DOMAIN.includes(err.code)) return true; // DNS trouble — don't block the student
  }
  try {
    return (await dns.resolve4(domain)).length > 0; // fall back to the domain's own address
  } catch (err) {
    return !NO_DOMAIN.includes(err.code);
  }
}

/* ---------- passwords ---------- */

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'qwertyuiop', 'iloveyou1', 'abc12345', 'abcd1234', 'admin123', 'welcome1', 'letmein1',
  'student1', 'student123', 'kenya123', 'nairobi1', 'football1', 'eduflex1', 'eduflex123',
]);

/** Returns a problem description, or null if the password is acceptable. */
function passwordProblem(password, { email } = {}) {
  const p = String(password || '');
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 128) return 'Password must be at most 128 characters.';
  if (!/[a-z]/i.test(p) || !/\d/.test(p)) return 'Password must include both letters and numbers.';
  if (COMMON_PASSWORDS.has(p.toLowerCase())) return 'That password is too common — choose something harder to guess.';
  if (email && p.toLowerCase().includes(String(email).split('@')[0].toLowerCase())) {
    return 'Password must not contain your email name.';
  }
  return null;
}

/* ---------- one-time tokens (verification + reset links) ---------- */

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Create a single-use token; returns the raw token (only its hash is stored). */
function createToken(userId, purpose, ttlMs) {
  const raw = crypto.randomBytes(32).toString('base64url');
  // One live link per purpose: older unused links stop working
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL')
    .run(nowISO(), userId, purpose);
  db.prepare('INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)')
    .run(userId, purpose, sha256(raw), new Date(Date.now() + ttlMs).toISOString(), nowISO());
  return raw;
}

/** Use a token: returns its user_id if valid, unused and unexpired (then marks it used); else null. */
function consumeToken(raw, purpose) {
  if (!raw || typeof raw !== 'string' || raw.length > 200) return null;
  const row = db.prepare(
    'SELECT id, user_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND purpose = ?'
  ).get(sha256(raw), purpose);
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(nowISO(), row.id);
  return row.user_id;
}

/* ---------- rate limiting ---------- */

const buckets = new Map(); // key -> timestamps (ms)

/**
 * Sliding-window limiter. hit(key) records an attempt; limited(key) says whether
 * the key is over `max` attempts in `windowMs`. Keys are like "login:<email>:<ip>".
 */
function rateLimiter(max, windowMs) {
  const prune = (key) => {
    const cutoff = Date.now() - windowMs;
    const list = (buckets.get(key) || []).filter(t => t > cutoff);
    if (list.length) buckets.set(key, list); else buckets.delete(key);
    return list;
  };
  return {
    limited: (key) => prune(key).length >= max,
    hit: (key) => { const list = prune(key); list.push(Date.now()); buckets.set(key, list); },
    reset: (key) => buckets.delete(key),
  };
}

module.exports = {
  EMAIL_RE, isEducationEmail, domainAcceptsMail, passwordProblem,
  createToken, consumeToken, rateLimiter,
};
