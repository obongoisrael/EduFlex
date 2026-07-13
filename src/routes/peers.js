/**
 * Peer Study routes (Phase 2 §8): opt-in preference, matches, study requests,
 * and simple study groups.
 *
 * PRIVACY: responses only ever contain public_username initials + institution.
 * Requests are visible to their sender and receiver only.
 */
const express = require('express');
const { db, nowISO } = require('../db');
const { requireAuth, safe } = require('../middleware');
const { findMatches } = require('../services/peers');

const router = express.Router();
router.use(requireAuth);

/* ---- preferences (opt-in) ---- */

// GET /api/peers/preferences
router.get('/preferences', safe((req, res) => {
  const u = db.prepare('SELECT peer_matching_enabled FROM users WHERE id = ?').get(req.session.userId);
  res.json({ enabled: !!u.peer_matching_enabled });
}));

// PUT /api/peers/preferences — "Allow Peer Study Matching" toggle
router.put('/preferences', safe((req, res) => {
  const enabled = req.body && req.body.enabled ? 1 : 0;
  db.prepare('UPDATE users SET peer_matching_enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled, nowISO(), req.session.userId);
  res.json({ enabled: !!enabled });
}));

/* ---- matches ---- */

// GET /api/peers/matches
router.get('/matches', safe((req, res) => {
  res.json(findMatches(req.session.userId));
}));

/* ---- study requests ---- */

// GET /api/peers/requests — incoming + sent, initials only
router.get('/requests', safe((req, res) => {
  const uid = req.session.userId;
  const incoming = db.prepare(
    `SELECT r.id, r.course_name, r.message, r.status, r.created_at,
            u.public_username, u.institution
     FROM study_requests r JOIN users u ON u.id = r.sender_user_id
     WHERE r.receiver_user_id = ? ORDER BY r.created_at DESC LIMIT 20`
  ).all(uid);
  const sent = db.prepare(
    `SELECT r.id, r.course_name, r.message, r.status, r.created_at,
            u.public_username, u.institution
     FROM study_requests r JOIN users u ON u.id = r.receiver_user_id
     WHERE r.sender_user_id = ? ORDER BY r.created_at DESC LIMIT 20`
  ).all(uid);
  res.json({ incoming, sent });
}));

// POST /api/peers/requests — send a study request to a matched peer
router.post('/requests', safe((req, res) => {
  const { receiver_user_id, course_name, message } = req.body || {};
  const receiver = db.prepare('SELECT id, peer_matching_enabled FROM users WHERE id = ?')
    .get(Number(receiver_user_id));
  if (!receiver || receiver.id === req.session.userId)
    return res.status(400).json({ error: 'Invalid peer.' });
  if (!receiver.peer_matching_enabled)
    return res.status(400).json({ error: 'This student is not participating in peer matching.' });

  const dup = db.prepare(
    `SELECT id FROM study_requests
     WHERE sender_user_id = ? AND receiver_user_id = ? AND status = 'Pending'`
  ).get(req.session.userId, receiver.id);
  if (dup) return res.status(409).json({ error: 'You already have a pending request to this student.' });

  const ts = nowISO();
  db.prepare(
    `INSERT INTO study_requests (sender_user_id, receiver_user_id, course_name, message, status, created_at, updated_at)
     VALUES (?,?,?,?, 'Pending', ?, ?)`
  ).run(req.session.userId, receiver.id, (course_name || '').trim(), (message || '').trim().slice(0, 300), ts, ts);
  res.status(201).json({ ok: true });
}));

// PATCH /api/peers/requests/:id — receiver accepts or declines
router.patch('/requests/:id', safe((req, res) => {
  const { status } = req.body || {};
  if (!['Accepted', 'Declined'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const info = db.prepare(
    `UPDATE study_requests SET status = ?, updated_at = ?
     WHERE id = ? AND receiver_user_id = ? AND status = 'Pending'`
  ).run(status, nowISO(), Number(req.params.id), req.session.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Request not found.' });
  res.json({ ok: true });
}));

/* ---- study groups ---- */

// GET /api/peers/groups — all groups with member counts + membership flags
router.get('/groups', safe((req, res) => {
  const uid = req.session.userId;
  const groups = db.prepare(
    `SELECT g.id, g.name, g.course_name, g.institution, g.created_at,
            (SELECT COUNT(*) FROM study_group_members m WHERE m.group_id = g.id) AS member_count,
            EXISTS(SELECT 1 FROM study_group_members m WHERE m.group_id = g.id AND m.user_id = ?) AS is_member,
            (g.created_by = ?) AS is_owner
     FROM study_groups g ORDER BY g.created_at DESC LIMIT 30`
  ).all(uid, uid).map(g => ({
    ...g,
    // member initials only (privacy rule)
    members: db.prepare(
      `SELECT u.public_username, u.institution, m.role
       FROM study_group_members m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ? ORDER BY m.joined_at LIMIT 12`
    ).all(g.id),
  }));
  res.json({ groups });
}));

// POST /api/peers/groups — create a group (creator becomes owner-member)
router.post('/groups', safe((req, res) => {
  const { name, course_name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required.' });
  const me = db.prepare('SELECT institution FROM users WHERE id = ?').get(req.session.userId);
  const ts = nowISO();
  const info = db.prepare(
    `INSERT INTO study_groups (name, course_name, institution, created_by, created_at) VALUES (?,?,?,?,?)`
  ).run(name.trim().slice(0, 60), (course_name || '').trim(), me.institution, req.session.userId, ts);
  db.prepare('INSERT INTO study_group_members (group_id, user_id, role, joined_at) VALUES (?,?,?,?)')
    .run(Number(info.lastInsertRowid), req.session.userId, 'owner', ts);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

// POST /api/peers/groups/:id/join
router.post('/groups/:id/join', safe((req, res) => {
  const g = db.prepare('SELECT id FROM study_groups WHERE id = ?').get(Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'Group not found.' });
  try {
    db.prepare('INSERT INTO study_group_members (group_id, user_id, role, joined_at) VALUES (?,?,?,?)')
      .run(g.id, req.session.userId, 'member', nowISO());
  } catch { return res.status(409).json({ error: 'You are already a member.' }); }
  res.json({ ok: true });
}));

// POST /api/peers/groups/:id/leave
router.post('/groups/:id/leave', safe((req, res) => {
  const info = db.prepare('DELETE FROM study_group_members WHERE group_id = ? AND user_id = ?')
    .run(Number(req.params.id), req.session.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'You are not a member of this group.' });
  // If the group is now empty, remove it
  const left = db.prepare('SELECT COUNT(*) AS n FROM study_group_members WHERE group_id = ?')
    .get(Number(req.params.id)).n;
  if (left === 0) db.prepare('DELETE FROM study_groups WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
}));

module.exports = router;
