/**
 * Study session routes: list (with optional date range for the calendar),
 * schedule generation, status changes (complete / missed / reschedule), delete.
 */
const express = require('express');
const { db, nowISO } = require('../db');
const { requireAuth, safe } = require('../middleware');
const { generateSchedule } = require('../scheduler');
const { syncTopicFromSessions } = require('../services/roadmaps');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['Planned', 'Completed', 'Missed', 'Rescheduled'];

// GET /api/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD  (range is optional)
router.get('/', safe((req, res) => {
  const { from, to } = req.query;
  let sql =
    `SELECT s.*, c.title AS course_title, c.code AS course_code,
            d.title AS deadline_title, d.due_date AS deadline_due
     FROM study_sessions s
     JOIN courses c ON c.id = s.course_id
     LEFT JOIN deadlines d ON d.id = s.deadline_id
     WHERE s.user_id = ?`;
  const params = [req.session.userId];
  if (from) { sql += ' AND s.end_datetime >= ?'; params.push(`${from}T00:00`); }
  if (to) { sql += ' AND s.start_datetime <= ?'; params.push(`${to}T23:59`); }
  sql += ' ORDER BY s.start_datetime ASC';
  res.json({ sessions: db.prepare(sql).all(...params) });
}));

// POST /api/sessions/generate — run the adaptive scheduling engine
router.post('/generate', safe((req, res) => {
  const result = generateSchedule(req.session.userId);
  res.json(result);
}));

// PATCH /api/sessions/:id — update status, reschedule, or edit notes
router.patch('/:id', safe((req, res) => {
  const s = db.prepare('SELECT * FROM study_sessions WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.session.userId);
  if (!s) return res.status(404).json({ error: 'Session not found.' });

  const { status, start_datetime, end_datetime, notes, reminder_enabled, reminder_minutes_before } = req.body || {};
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  let newStart = s.start_datetime, newEnd = s.end_datetime, newStatus = status || s.status;

  // Rescheduling: new times required, must be valid and not in the past
  if (start_datetime || end_datetime) {
    newStart = start_datetime || s.start_datetime;
    newEnd = end_datetime || s.end_datetime;
    if (newEnd <= newStart) return res.status(400).json({ error: 'End must be after start.' });
    if (start_datetime && new Date(newStart) < new Date())
      return res.status(400).json({ error: 'Cannot reschedule into the past.' });
    if (!status) newStatus = 'Rescheduled';
  }

  // Alarm reminder settings (Phase 2 §7)
  const remEnabled = reminder_enabled !== undefined ? (reminder_enabled ? 1 : 0) : s.reminder_enabled;
  let remMinutes = s.reminder_minutes_before;
  if (reminder_minutes_before !== undefined) {
    remMinutes = Number(reminder_minutes_before);
    if (![0, 5, 15, 30, 60, 1440].includes(remMinutes))
      return res.status(400).json({ error: 'Invalid reminder time.' });
  }

  db.prepare(
    `UPDATE study_sessions SET status=?, start_datetime=?, end_datetime=?, notes=?,
       reminder_enabled=?, reminder_minutes_before=?, updated_at=? WHERE id=?`
  ).run(newStatus, newStart, newEnd, notes !== undefined ? String(notes) : s.notes,
        remEnabled, remMinutes, nowISO(), s.id);

  // Roadmap integration: completing a linked session advances the roadmap topic
  if (s.roadmap_topic_id && newStatus !== s.status) syncTopicFromSessions(s.roadmap_topic_id);

  res.json({ session: db.prepare('SELECT * FROM study_sessions WHERE id = ?').get(s.id) });
}));

// DELETE /api/sessions/:id
router.delete('/:id', safe((req, res) => {
  const info = db.prepare('DELETE FROM study_sessions WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.session.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Session not found.' });
  res.json({ ok: true });
}));

module.exports = router;
