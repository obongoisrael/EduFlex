/**
 * Smart feature routes (Phase 2): risk, study/resource recommendations,
 * weekly insights, reminders, and missed-session recovery.
 */
const express = require('express');
const { db, nowISO, fmtLocal } = require('../db');
const { requireAuth, safe } = require('../middleware');
const { assessRisks } = require('../services/risk');
const { studyRecommendations, resourceRecommendations } = require('../services/recommend');
const { weeklyInsights } = require('../services/insights');
const { recoverySuggestions, acceptRecovery, ignoreRecovery } = require('../services/recovery');

const router = express.Router();
router.use(requireAuth);

// GET /api/smart/risk — full academic risk assessment
router.get('/risk', safe((req, res) => {
  res.json({ risks: assessRisks(req.session.userId) });
}));

// GET /api/smart/recommendations — study recommendations (also the "Generate" button target)
router.get('/recommendations', safe((req, res) => {
  res.json(studyRecommendations(req.session.userId, Number(req.query.limit) || 3));
}));

// POST /api/smart/recommendations/accept — add a suggested session to the schedule
router.post('/recommendations/accept', safe((req, res) => {
  const { course_id, deadline_id, start_datetime, end_datetime, intensity, title } = req.body || {};
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND user_id = ?')
    .get(Number(course_id), req.session.userId);
  if (!course) return res.status(400).json({ error: 'Course not found.' });
  if (!start_datetime || !end_datetime || end_datetime <= start_datetime)
    return res.status(400).json({ error: 'Invalid time range.' });
  if (new Date(start_datetime) < new Date())
    return res.status(400).json({ error: 'Suggested time is already in the past — generate a fresh recommendation.' });

  const ts = nowISO();
  const info = db.prepare(
    `INSERT INTO study_sessions
       (user_id, course_id, deadline_id, title, start_datetime, end_datetime,
        status, study_intensity, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'Planned', ?, 'Added from a smart recommendation', ?, ?)`
  ).run(
    req.session.userId, course.id, deadline_id ? Number(deadline_id) : null,
    title || `${course.code}: recommended study`, start_datetime, end_datetime,
    intensity || 'Normal', ts, ts
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

// GET /api/smart/resources — smart resource recommendations
router.get('/resources', safe((req, res) => {
  res.json({ resources: resourceRecommendations(req.session.userId, Number(req.query.limit) || 6) });
}));

// GET /api/smart/weekly — weekly progress insights
router.get('/weekly', safe((req, res) => {
  res.json(weeklyInsights(req.session.userId));
}));

// GET /api/smart/reminders — upcoming reminders (sessions + deadlines)
router.get('/reminders', safe((req, res) => {
  const uid = req.session.userId;
  const now = fmtLocal(new Date());
  const soon = fmtLocal(new Date(Date.now() + 3 * 86400000));

  const sessions = db.prepare(
    `SELECT s.id, s.title, s.start_datetime, s.reminder_minutes_before,
            c.code AS course_code
     FROM study_sessions s JOIN courses c ON c.id = s.course_id
     WHERE s.user_id = ? AND s.reminder_enabled = 1
       AND s.status IN ('Planned','Rescheduled')
       AND s.start_datetime BETWEEN ? AND ?
     ORDER BY s.start_datetime`
  ).all(uid, now, soon).map(s => ({
    kind: 'session',
    id: s.id,
    title: `${s.course_code} — ${s.title}`,
    at: s.start_datetime,
    minutes_before: s.reminder_minutes_before,
    remind_at: fmtLocal(new Date(new Date(s.start_datetime) - s.reminder_minutes_before * 60000)),
  }));

  const deadlines = db.prepare(
    `SELECT d.id, d.title, d.due_date, d.reminder_minutes_before, c.code AS course_code
     FROM deadlines d JOIN courses c ON c.id = d.course_id
     WHERE d.user_id = ? AND d.reminder_enabled = 1 AND d.status = 'Pending'
       AND d.due_date BETWEEN ? AND ?
     ORDER BY d.due_date`
  ).all(uid, now, soon).map(d => ({
    kind: 'deadline',
    id: d.id,
    title: `${d.course_code} — ${d.title} (deadline)`,
    at: d.due_date,
    minutes_before: d.reminder_minutes_before,
    remind_at: fmtLocal(new Date(new Date(d.due_date) - d.reminder_minutes_before * 60000)),
  }));

  const reminders = [...sessions, ...deadlines].sort((a, b) => a.remind_at.localeCompare(b.remind_at));
  res.json({ reminders });
}));

// GET /api/smart/recovery — recovery suggestions for missed sessions
router.get('/recovery', safe((req, res) => {
  res.json({ suggestions: recoverySuggestions(req.session.userId) });
}));

// POST /api/smart/recovery/:sessionId/accept — accept a slot (suggested or custom)
router.post('/recovery/:sessionId/accept', safe((req, res) => {
  const { start_datetime, end_datetime } = req.body || {};
  const result = acceptRecovery(req.session.userId, Number(req.params.sessionId), start_datetime, end_datetime);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result);
}));

// POST /api/smart/recovery/:sessionId/ignore — dismiss suggestion
router.post('/recovery/:sessionId/ignore', safe((req, res) => {
  const ok = ignoreRecovery(req.session.userId, Number(req.params.sessionId));
  if (!ok) return res.status(404).json({ error: 'Missed session not found.' });
  res.json({ ok: true });
}));

// GET /api/smart/dashboard — everything the dashboard smart cards need in one call
router.get('/dashboard', safe((req, res) => {
  const uid = req.session.userId;
  const risks = assessRisks(uid);
  res.json({
    risks: risks.filter(r => r.risk_level !== 'Low').slice(0, 3),
    recommendation: studyRecommendations(uid, 1),
    weekly: weeklyInsights(uid),
    resource_recs: resourceRecommendations(uid, 3),
    recovery: recoverySuggestions(uid).slice(0, 2),
  });
}));

module.exports = router;
