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

module.exports = { requireAuth, requireAdmin, safe };
