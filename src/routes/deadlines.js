/** Deadline CRUD — always returned in urgency order (closest due date first). */
const express = require('express');
const { db, nowISO } = require('../db');
const { requireAuth, safe } = require('../middleware');

const router = express.Router();
router.use(requireAuth);

const TYPES = ['Assignment', 'CAT/Test', 'Exam', 'Project', 'Presentation', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const STATUSES = ['Pending', 'Completed', 'Missed'];

function validate(body, partial = false) {
  const { course_id, title, type, due_date, priority, estimated_hours } = body;
  if (!partial || course_id !== undefined) { if (!course_id) return 'Course is required.'; }
  if (!partial || title !== undefined) { if (!title || !String(title).trim()) return 'Title is required.'; }
  if (!partial || type !== undefined) { if (!TYPES.includes(type)) return 'Invalid deadline type.'; }
  if (!partial || due_date !== undefined) { if (!due_date) return 'Due date is required.'; }
  if (!partial || priority !== undefined) { if (!PRIORITIES.includes(priority)) return 'Invalid priority.'; }
  if (!partial || estimated_hours !== undefined) {
    const h = Number(estimated_hours);
    if (!Number.isFinite(h) || h <= 0 || h > 200) return 'Estimated hours must be a positive number (max 200).';
  }
  return null;
}

// GET /api/deadlines — urgency order: pending first, then closest due date
router.get('/', safe((req, res) => {
  const deadlines = db.prepare(
    `SELECT d.*, c.title AS course_title, c.code AS course_code
     FROM deadlines d JOIN courses c ON c.id = d.course_id
     WHERE d.user_id = ?
     ORDER BY CASE d.status WHEN 'Pending' THEN 0 ELSE 1 END, d.due_date ASC`
  ).all(req.session.userId);
  res.json({ deadlines });
}));

// POST /api/deadlines
router.post('/', safe((req, res) => {
  const err = validate(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const { course_id, title, type, due_date, priority, estimated_hours } = req.body;

  const course = db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?')
    .get(Number(course_id), req.session.userId);
  if (!course) return res.status(400).json({ error: 'Course not found (or not yours).' });

  const ts = nowISO();
  const remEnabled = req.body.reminder_enabled ? 1 : 0;
  const remMinutes = [60, 1440].includes(Number(req.body.reminder_minutes_before))
    ? Number(req.body.reminder_minutes_before) : 1440;
  const info = db.prepare(
    `INSERT INTO deadlines (user_id, course_id, title, type, due_date, priority, estimated_hours, status,
                            reminder_enabled, reminder_minutes_before, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'Pending', ?, ?, ?, ?)`
  ).run(req.session.userId, course.id, String(title).trim(), type, due_date, priority, Number(estimated_hours),
        remEnabled, remMinutes, ts, ts);
  res.status(201).json({ deadline: db.prepare('SELECT * FROM deadlines WHERE id = ?').get(Number(info.lastInsertRowid)) });
}));

// PUT /api/deadlines/:id
router.put('/:id', safe((req, res) => {
  const dl = db.prepare('SELECT * FROM deadlines WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.session.userId);
  if (!dl) return res.status(404).json({ error: 'Deadline not found.' });

  const err = validate(req.body || {}, true);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  if (b.status && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
  if (b.course_id) {
    const course = db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?')
      .get(Number(b.course_id), req.session.userId);
    if (!course) return res.status(400).json({ error: 'Course not found (or not yours).' });
  }

  db.prepare(
    `UPDATE deadlines SET course_id=?, title=?, type=?, due_date=?, priority=?, estimated_hours=?, status=?,
       reminder_enabled=?, reminder_minutes_before=?, updated_at=? WHERE id=?`
  ).run(
    b.course_id ? Number(b.course_id) : dl.course_id,
    b.title !== undefined ? String(b.title).trim() : dl.title,
    b.type || dl.type,
    b.due_date || dl.due_date,
    b.priority || dl.priority,
    b.estimated_hours !== undefined ? Number(b.estimated_hours) : dl.estimated_hours,
    b.status || dl.status,
    b.reminder_enabled !== undefined ? (b.reminder_enabled ? 1 : 0) : dl.reminder_enabled,
    [60, 1440].includes(Number(b.reminder_minutes_before)) ? Number(b.reminder_minutes_before) : dl.reminder_minutes_before,
    nowISO(), dl.id
  );
  res.json({ deadline: db.prepare('SELECT * FROM deadlines WHERE id = ?').get(dl.id) });
}));

// DELETE /api/deadlines/:id
router.delete('/:id', safe((req, res) => {
  const info = db.prepare('DELETE FROM deadlines WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.session.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Deadline not found.' });
  res.json({ ok: true });
}));

module.exports = router;
