const express = require('express');
const path = require('path');
const fs = require('fs');
const { db, nowISO, UPLOAD_DIR } = require('../db');
const { requireAuth, requireAdmin, safe } = require('../middleware');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

const STATUSES = ['active', 'inactive', 'suspended'];
const ROLES = ['student', 'admin'];

/** Remove stored upload files once their resource rows are gone. */
function unlinkUploads(fileUrls) {
  for (const f of fileUrls) {
    const filePath = path.join(UPLOAD_DIR, path.basename(f)); // basename() blocks path traversal
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.error(e); }
  }
}

// GET /api/admin/stats
router.get('/stats', safe((req, res) => {
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM users WHERE account_status = 'active') AS active_users,
      (SELECT COUNT(*) FROM resources) AS total_resources,
      (SELECT COUNT(*) FROM courses) AS total_courses,
      (SELECT COUNT(*) FROM study_sessions) AS total_sessions,
      (SELECT COUNT(*) FROM users WHERE plan = 'plus'
         AND (plan_expires_at IS NULL OR plan_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))) AS plus_users
  `).get();

  const recentUsers = db.prepare(`
    SELECT id, first_name, last_name, email, institution, programme, role, account_status, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  const recentResources = db.prepare(`
    SELECT id, title, course_name, category, institution, public_username, moderation_status, created_at
    FROM resources
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  const moderationList = db.prepare(`
    SELECT id, title, course_name, category, moderation_status, created_at, institution, public_username
    FROM resources
    WHERE moderation_status != 'Approved'
    ORDER BY created_at DESC
    LIMIT 10
  `).all();

  res.json({
    stats: {
      ...totals,
      total_users: Number(totals.total_users || 0),
      active_users: Number(totals.active_users || 0),
      total_resources: Number(totals.total_resources || 0),
      total_courses: Number(totals.total_courses || 0),
      total_sessions: Number(totals.total_sessions || 0),
      plus_users: Number(totals.plus_users || 0),
    },
    recent_registrations: recentUsers,
    recent_resources: recentResources,
    moderation_list: moderationList,
  });
}));

// GET /api/admin/users
router.get('/users', safe((req, res) => {
  const search = String(req.query.search || '').trim();
  let sql = `
    SELECT id, first_name, last_name, public_username, email, institution, programme, role, account_status,
           plan, plan_expires_at, last_login_at, created_at, updated_at
    FROM users
  `;
  const params = [];
  if (search) {
    sql += `WHERE (email LIKE ? OR institution LIKE ? OR programme LIKE ?) `;
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  sql += `ORDER BY created_at DESC`;

  const users = db.prepare(sql).all(...params);
  res.json({ users });
}));

// GET /api/admin/users/:id
router.get('/users/:id', safe((req, res) => {
  const user = db.prepare(`
    SELECT id, first_name, last_name, public_username, email, institution, programme, role, account_status, last_login_at, created_at, updated_at
    FROM users WHERE id = ?
  `).get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
}));

// PATCH /api/admin/users/:id/status
router.patch('/users/:id/status', safe((req, res) => {
  const userId = Number(req.params.id);
  const status = String(req.body?.status || '').toLowerCase();
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (userId === req.session.userId && status !== 'active')
    return res.status(400).json({ error: 'You cannot deactivate your own admin account.' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  db.prepare(`UPDATE users SET account_status = ?, updated_at = ? WHERE id = ?`).run(status, nowISO(), userId);
  const updated = db.prepare(`SELECT id, first_name, last_name, email, role, account_status FROM users WHERE id = ?`).get(userId);
  res.json({ user: updated });
}));

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', safe((req, res) => {
  const userId = Number(req.params.id);
  const role = String(req.body?.role || '').toLowerCase();
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (userId === req.session.userId && role !== 'admin')
    return res.status(400).json({ error: 'You cannot demote your own admin account.' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  db.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`).run(role, nowISO(), userId);
  const updated = db.prepare(`SELECT id, first_name, last_name, email, role, account_status FROM users WHERE id = ?`).get(userId);
  res.json({ user: updated });
}));

// PATCH /api/admin/users/:id/plan — grant or revoke EduFlex Plus
// body: { plan: 'plus' | 'free', days?: number }  (days omitted/0 = no expiry)
router.patch('/users/:id/plan', safe((req, res) => {
  const userId = Number(req.params.id);
  const plan = String(req.body?.plan || '').toLowerCase();
  if (!['free', 'plus'].includes(plan)) return res.status(400).json({ error: 'Plan must be free or plus.' });
  const days = Number(req.body?.days) || 0;
  if (days < 0 || days > 3650) return res.status(400).json({ error: 'Days must be between 0 and 3650.' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const expires = plan === 'plus' && days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  db.prepare('UPDATE users SET plan = ?, plan_expires_at = ?, updated_at = ? WHERE id = ?')
    .run(plan, expires, nowISO(), userId);
  res.json({ user: db.prepare('SELECT id, email, plan, plan_expires_at FROM users WHERE id = ?').get(userId) });
}));

// DELETE /api/admin/users/:id
router.delete('/users/:id', safe((req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.session.userId) return res.status(400).json({ error: 'You cannot delete your own admin account.' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const files = db.prepare('SELECT file_url FROM resources WHERE user_id = ?').all(userId).map(r => r.file_url);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId); // cascades to their resources
  unlinkUploads(files);
  res.json({ ok: true });
}));

// GET /api/admin/resources
router.get('/resources', safe((req, res) => {
  const { search, status } = req.query;
  let sql = `
    SELECT r.id, r.title, r.description, r.course_name, r.category, r.institution, r.public_username,
           r.moderation_status, r.moderation_note, r.created_at, r.updated_at,
           u.first_name, u.last_name, u.email
    FROM resources r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE 1=1
  `;
  const params = [];
  if (search) {
    sql += `AND (r.title LIKE ? OR r.course_name LIKE ? OR u.email LIKE ?) `;
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  if (status) {
    sql += `AND r.moderation_status = ? `;
    params.push(status);
  }
  sql += `ORDER BY r.created_at DESC`;
  const resources = db.prepare(sql).all(...params);
  res.json({ resources });
}));

// PATCH /api/admin/resources/:id/approve
router.patch('/resources/:id/approve', safe((req, res) => {
  const resourceId = Number(req.params.id);
  const resource = db.prepare('SELECT id FROM resources WHERE id = ?').get(resourceId);
  if (!resource) return res.status(404).json({ error: 'Resource not found.' });

  db.prepare(`UPDATE resources SET moderation_status = ?, moderation_note = ?, updated_at = ? WHERE id = ?`)
    .run('Approved', req.body?.note || 'Approved by admin', nowISO(), resourceId);
  res.json({ ok: true });
}));

// PATCH /api/admin/resources/:id/reject
router.patch('/resources/:id/reject', safe((req, res) => {
  const resourceId = Number(req.params.id);
  const resource = db.prepare('SELECT id FROM resources WHERE id = ?').get(resourceId);
  if (!resource) return res.status(404).json({ error: 'Resource not found.' });

  db.prepare(`UPDATE resources SET moderation_status = ?, moderation_note = ?, updated_at = ? WHERE id = ?`)
    .run('Rejected', req.body?.note || 'Rejected by admin', nowISO(), resourceId);
  res.json({ ok: true });
}));

// DELETE /api/admin/resources/:id
router.delete('/resources/:id', safe((req, res) => {
  const resourceId = Number(req.params.id);
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  if (!resource) return res.status(404).json({ error: 'Resource not found.' });

  db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
  unlinkUploads([resource.file_url]);
  res.json({ ok: true });
}));

// GET /api/admin/courses
router.get('/courses', safe((req, res) => {
  const courses = db.prepare(`
    SELECT c.id, c.title, c.code, c.difficulty, c.description, c.created_at, u.first_name, u.last_name, u.email
    FROM courses c
    LEFT JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC
  `).all();
  res.json({ courses });
}));

// GET /api/admin/study-sessions
router.get('/study-sessions', safe((req, res) => {
  const sessions = db.prepare(`
    SELECT s.id, s.title, s.status, s.start_datetime, s.end_datetime, s.study_intensity, s.created_at,
           u.first_name, u.last_name, u.email, c.title AS course_title
    FROM study_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN courses c ON c.id = s.course_id
    ORDER BY s.created_at DESC
    LIMIT 50
  `).all();
  res.json({ sessions });
}));

// GET /api/admin/reports
router.get('/reports', safe((req, res) => {
  const reports = db.prepare(`
    SELECT r.id, r.title, r.course_name, r.category, r.moderation_status, r.moderation_note, r.created_at,
           u.first_name, u.last_name, u.email
    FROM resources r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.moderation_status != 'Approved'
    ORDER BY r.created_at DESC
  `).all();
  res.json({ reports });
}));

module.exports = router;
