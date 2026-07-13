/** Focus mode: start a timed session, complete/abandon it, list history. */
const express = require('express');
const { db, nowISO } = require('../db');
const { requireAuth, safe } = require('../middleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/focus — recent focus history
router.get('/', safe((req, res) => {
  const sessions = db.prepare(
    `SELECT f.*, c.title AS course_title, c.code AS course_code
     FROM focus_sessions f LEFT JOIN courses c ON c.id = f.course_id
     WHERE f.user_id = ? ORDER BY f.started_at DESC LIMIT 30`
  ).all(req.session.userId);
  res.json({ sessions });
}));

// POST /api/focus — start a focus session
router.post('/', safe((req, res) => {
  const { title, course_id, study_session_id, study_duration_minutes, break_duration_minutes } = req.body || {};
  const study = Number(study_duration_minutes) || 25;
  const brk = Number(break_duration_minutes) || 5;
  if (study < 1 || study > 240) return res.status(400).json({ error: 'Study duration must be 1–240 minutes.' });
  if (brk < 0 || brk > 60) return res.status(400).json({ error: 'Break duration must be 0–60 minutes.' });

  if (course_id) {
    const c = db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?').get(Number(course_id), req.session.userId);
    if (!c) return res.status(400).json({ error: 'Course not found.' });
  }

  const ts = nowISO();
  const info = db.prepare(
    `INSERT INTO focus_sessions (user_id, course_id, study_session_id, title,
       study_duration_minutes, break_duration_minutes, completed_duration_minutes,
       status, started_at, created_at)
     VALUES (?,?,?,?,?,?,0,'In Progress',?,?)`
  ).run(
    req.session.userId,
    course_id ? Number(course_id) : null,
    study_session_id ? Number(study_session_id) : null,
    (title || 'Focus session').trim(), study, brk, ts, ts
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

// PATCH /api/focus/:id — finish (or abandon) a focus session
router.patch('/:id', safe((req, res) => {
  const f = db.prepare('SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.session.userId);
  if (!f) return res.status(404).json({ error: 'Focus session not found.' });

  const { completed_duration_minutes, status, mark_study_session_completed } = req.body || {};
  const done = Math.max(0, Number(completed_duration_minutes) || 0);
  const newStatus = status === 'Abandoned' ? 'Abandoned' : 'Completed';

  db.prepare('UPDATE focus_sessions SET completed_duration_minutes=?, status=?, completed_at=? WHERE id=?')
    .run(done, newStatus, nowISO(), f.id);

  // Optionally mark the linked study session as completed (updates weekly progress)
  if (mark_study_session_completed && f.study_session_id) {
    db.prepare(`UPDATE study_sessions SET status='Completed', updated_at=? WHERE id=? AND user_id=?`)
      .run(nowISO(), f.study_session_id, req.session.userId);
  }
  res.json({ ok: true });
}));

// POST /api/focus/sync — upload focus sessions completed while offline (Phase 2 §6)
router.post('/sync', safe((req, res) => {
  const list = Array.isArray(req.body && req.body.sessions) ? req.body.sessions : [];
  if (list.length === 0) return res.json({ synced: 0 });

  const insert = db.prepare(
    `INSERT INTO focus_sessions (user_id, course_id, study_session_id, title,
       study_duration_minutes, break_duration_minutes, completed_duration_minutes,
       status, started_at, completed_at, created_at, synced, offline_created)
     VALUES (?,?,?,?,?,?,?, 'Completed', ?, ?, ?, 1, 1)`
  );
  let synced = 0;
  for (const s of list.slice(0, 50)) {
    const done = Math.max(0, Math.min(1440, Number(s.completed_duration_minutes) || 0));
    if (done === 0) continue;
    let courseId = null;
    if (s.course_id) {
      const c = db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?')
        .get(Number(s.course_id), req.session.userId);
      if (c) courseId = c.id;
    }
    const ts = nowISO();
    insert.run(
      req.session.userId, courseId, null,
      String(s.title || 'Offline focus session').slice(0, 100),
      Number(s.study_duration_minutes) || 25, Number(s.break_duration_minutes) || 5,
      done, s.started_at || ts, s.completed_at || ts, ts
    );
    synced++;
  }
  res.json({ synced });
}));

module.exports = router;
