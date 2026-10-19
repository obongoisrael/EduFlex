/** Shared Express middleware for EduFlex. */

/** Blocks unauthenticated API access (security rule: dashboard data is private). */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Authentication required' });
  const { db } = require('./db');
  const user = db.prepare('SELECT account_status FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (user.account_status !== 'active') return res.status(403).json({ error: 'Account is inactive.' });
  return next();
}

/** Blocks non-admin users from admin-only routes. */
function requireAdmin(req, res, next) {
  const { db } = require('./db');
  const user = db.prepare('SELECT role, account_status FROM users WHERE id = ?').get(req.session?.userId);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (user.account_status !== 'active') return res.status(403).json({ error: 'Account is inactive.' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

/**
 * Does this user row have EduFlex Plus right now?
 * Admins always do; otherwise plan must be 'plus' and not expired.
 */
function planActive(u) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (u.plan !== 'plus') return false;
  return !u.plan_expires_at || new Date(u.plan_expires_at) > new Date();
}

/** Is the given user id on Plus? */
function isPlus(userId) {
  const { db } = require('./db');
  return planActive(db.prepare('SELECT role, plan, plan_expires_at FROM users WHERE id = ?').get(userId));
}

/** Blocks free users from premium routes (402 + premium flag so the client can show an upgrade prompt). */
function requirePlus(req, res, next) {
  if (isPlus(req.session.userId)) return next();
  res.status(402).json({ error: 'This is an EduFlex Plus feature.', premium: true });
}

/** Small helper: run fn, convert thrown errors into a 500 JSON response. */
function safe(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

module.exports = { requireAuth, requireAdmin, requirePlus, planActive, isPlus, safe };
