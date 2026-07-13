/** Aggregated data for the Dashboard and Progress pages. */
const express = require('express');
const { db, fmtLocal } = require('../db');
const { requireAuth, safe } = require('../middleware');

const router = express.Router();
router.use(requireAuth);

/** Monday 00:00 of the current week (weeks run Mon–Sun). */
function weekStart(d = new Date()) {
  const day = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return m;
}

// GET /api/stats/dashboard
router.get('/dashboard', safe((req, res) => {
  const uid = req.session.userId;
  const now = new Date();
  const today = fmtLocal(now).slice(0, 10);
  const ws = weekStart(now);
  const we = new Date(ws.getTime() + 7 * 86400000);

  const courseCount = db.prepare('SELECT COUNT(*) AS n FROM courses WHERE user_id=?').get(uid).n;

  const upcomingDeadlines = db.prepare(
    `SELECT d.*, c.title AS course_title, c.code AS course_code
     FROM deadlines d JOIN courses c ON c.id = d.course_id
     WHERE d.user_id=? AND d.status='Pending' AND d.due_date >= ?
     ORDER BY d.due_date ASC LIMIT 5`
  ).all(uid, fmtLocal(now));

  const todaySessions = db.prepare(
    `SELECT s.*, c.title AS course_title, c.code AS course_code
     FROM study_sessions s JOIN courses c ON c.id = s.course_id
     WHERE s.user_id=? AND s.start_datetime LIKE ?
     ORDER BY s.start_datetime ASC`
  ).all(uid, `${today}%`);

  // Weekly progress: completed vs total planned hours in the current week
  const week = db.prepare(
    `SELECT status,
            SUM((julianday(end_datetime) - julianday(start_datetime)) * 24) AS h,
            COUNT(*) AS n
     FROM study_sessions
     WHERE user_id=? AND start_datetime >= ? AND start_datetime < ?
     GROUP BY status`
  ).all(uid, fmtLocal(ws), fmtLocal(we));
  const weekly = { completed_hours: 0, total_hours: 0, completed_sessions: 0, total_sessions: 0 };
  for (const r of week) {
    weekly.total_hours += r.h || 0;
    weekly.total_sessions += r.n;
    if (r.status === 'Completed') { weekly.completed_hours = r.h || 0; weekly.completed_sessions = r.n; }
  }

  // Focus minutes logged this week (counts toward weekly study time)
  const focusWeek = db.prepare(
    `SELECT COALESCE(SUM(completed_duration_minutes),0) AS m
     FROM focus_sessions WHERE user_id=? AND status='Completed' AND started_at >= ?`
  ).get(uid, ws.toISOString()).m;

  const recentResources = db.prepare(
    `SELECT id, title, category, course_name, institution, public_username, upvotes_count, created_at
     FROM resources ORDER BY created_at DESC LIMIT 5`
  ).all();

  res.json({
    course_count: courseCount,
    upcoming_deadlines: upcomingDeadlines,
    today_sessions: todaySessions,
    weekly,
    focus_minutes_week: focusWeek,
    recent_resources: recentResources,
  });
}));

// GET /api/stats/progress
router.get('/progress', safe((req, res) => {
  const uid = req.session.userId;
  const ws = weekStart();

  const totals = { Planned: 0, Completed: 0, Missed: 0, Rescheduled: 0 };
  for (const r of db.prepare(
    'SELECT status, COUNT(*) AS n FROM study_sessions WHERE user_id=? GROUP BY status'
  ).all(uid)) totals[r.status] = r.n;

  const totalSessions = totals.Planned + totals.Completed + totals.Missed + totals.Rescheduled;
  const completionPct = totalSessions ? Math.round((totals.Completed / totalSessions) * 100) : 0;

  const weeklyHours = db.prepare(
    `SELECT COALESCE(SUM((julianday(end_datetime) - julianday(start_datetime)) * 24),0) AS h
     FROM study_sessions WHERE user_id=? AND status='Completed' AND start_datetime >= ?`
  ).get(uid, fmtLocal(ws)).h;

  const focusMinutesTotal = db.prepare(
    `SELECT COALESCE(SUM(completed_duration_minutes),0) AS m
     FROM focus_sessions WHERE user_id=? AND status='Completed'`
  ).get(uid).m;

  // Per-course breakdown for the progress bars
  const byCourse = db.prepare(
    `SELECT c.id, c.title, c.code, c.difficulty,
            COUNT(s.id) AS total_sessions,
            SUM(CASE WHEN s.status='Completed' THEN 1 ELSE 0 END) AS completed_sessions,
            SUM(CASE WHEN s.status='Missed' THEN 1 ELSE 0 END) AS missed_sessions,
            COALESCE(SUM(CASE WHEN s.status='Completed'
              THEN (julianday(s.end_datetime) - julianday(s.start_datetime)) * 24 ELSE 0 END), 0) AS completed_hours
     FROM courses c LEFT JOIN study_sessions s ON s.course_id = c.id
     WHERE c.user_id=?
     GROUP BY c.id ORDER BY c.title`
  ).all(uid);

  // Hours studied per day over the last 7 days (simple bar chart data)
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(); day.setDate(day.getDate() - i);
    const key = fmtLocal(day).slice(0, 10);
    const h = db.prepare(
      `SELECT COALESCE(SUM((julianday(end_datetime) - julianday(start_datetime)) * 24),0) AS h
       FROM study_sessions WHERE user_id=? AND status='Completed' AND start_datetime LIKE ?`
    ).get(uid, `${key}%`).h;
    daily.push({ date: key, hours: Math.round(h * 10) / 10 });
  }

  res.json({
    totals,
    total_sessions: totalSessions,
    completion_pct: completionPct,
    weekly_hours: Math.round(weeklyHours * 10) / 10,
    focus_minutes_total: focusMinutesTotal,
    by_course: byCourse,
    daily,
  });
}));

module.exports = router;
