/**
 * Weekly Progress Insights service (Phase 2 §5).
 * Builds a human-readable weekly summary: completion %, hours, focus time,
 * study streak, best study day, strongest/weakest course, and a suggestion.
 */
const { db, fmtLocal } = require('../db');

function weekStart(d = new Date()) {
  const day = (d.getDay() + 6) % 7; // Mon = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weeklyInsights(userId) {
  const ws = weekStart();
  const we = new Date(ws.getTime() + 7 * 86400000);
  const wsStr = fmtLocal(ws), weStr = fmtLocal(we);

  // Planned vs completed hours & session counts this week
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS n,
            COALESCE(SUM((julianday(end_datetime) - julianday(start_datetime)) * 24), 0) AS h
     FROM study_sessions
     WHERE user_id = ? AND start_datetime >= ? AND start_datetime < ?
     GROUP BY status`
  ).all(userId, wsStr, weStr);
  let plannedHours = 0, completedHours = 0, totalSessions = 0, completedSessions = 0, missedSessions = 0;
  for (const r of rows) {
    plannedHours += r.h; totalSessions += r.n;
    if (r.status === 'Completed') { completedHours = r.h; completedSessions = r.n; }
    if (r.status === 'Missed') missedSessions = r.n;
  }
  const completionPct = totalSessions ? Math.round((completedSessions / totalSessions) * 100) : 0;

  const focus = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(completed_duration_minutes), 0) AS m
     FROM focus_sessions WHERE user_id = ? AND status = 'Completed' AND started_at >= ?`
  ).get(userId, ws.toISOString());

  // Per-course completion this week → strongest / weakest / needs attention
  const byCourse = db.prepare(
    `SELECT c.id, c.title, c.code,
            COUNT(s.id) AS total,
            SUM(CASE WHEN s.status = 'Completed' THEN 1 ELSE 0 END) AS done,
            COALESCE(SUM(CASE WHEN s.status = 'Completed'
              THEN (julianday(s.end_datetime) - julianday(s.start_datetime)) * 24 ELSE 0 END), 0) AS hours
     FROM courses c
     JOIN study_sessions s ON s.course_id = c.id
       AND s.start_datetime >= ? AND s.start_datetime < ?
     WHERE c.user_id = ?
     GROUP BY c.id HAVING total > 0`
  ).all(wsStr, weStr, userId)
    .map(c => ({ ...c, pct: Math.round((c.done / c.total) * 100) }));

  byCourse.sort((a, b) => b.hours - a.hours);
  const mostStudied = byCourse[0] || null;
  const leastStudied = byCourse.length > 1 ? byCourse[byCourse.length - 1] : null;
  const needsAttention = byCourse.filter(c => c.pct < 50);

  // Best study day: most completed hours over the last 28 days
  const dayHours = db.prepare(
    `SELECT CAST(strftime('%w', start_datetime) AS INTEGER) AS dow,
            SUM((julianday(end_datetime) - julianday(start_datetime)) * 24) AS h
     FROM study_sessions
     WHERE user_id = ? AND status = 'Completed' AND start_datetime >= ?
     GROUP BY dow ORDER BY h DESC LIMIT 1`
  ).get(userId, fmtLocal(new Date(Date.now() - 28 * 86400000)));
  const bestDay = dayHours ? DAY_NAMES[dayHours.dow] : null;

  // Study streak: consecutive days (ending today) with a completed session or focus block
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const day = new Date(); day.setDate(day.getDate() - i);
    const key = fmtLocal(day).slice(0, 10);
    const hasStudy = db.prepare(
      `SELECT EXISTS(
         SELECT 1 FROM study_sessions WHERE user_id=? AND status='Completed' AND start_datetime LIKE ?
       ) OR EXISTS(
         SELECT 1 FROM focus_sessions WHERE user_id=? AND status='Completed' AND started_at LIKE ?
       ) AS x`
    ).get(userId, `${key}%`, userId, `${key}%`).x;
    if (hasStudy) streak++;
    else if (i === 0) continue; // today isn't over yet — don't break the streak on it
    else break;
  }

  // Assemble the text insight (§5 example style)
  const parts = [];
  parts.push(totalSessions > 0
    ? `You completed ${completionPct}% of your planned study sessions this week.`
    : 'No study sessions were planned this week — generate a schedule to get started.');
  if (bestDay) parts.push(`Your strongest study day is ${bestDay}.`);
  if (streak >= 2) parts.push(`You are on a ${streak}-day study streak. 🔥`);
  if (needsAttention.length > 0) {
    const worst = needsAttention[needsAttention.length - 1];
    parts.push(`${worst.title} needs more attention next week because only ${worst.pct}% of planned sessions were completed.`);
  }
  const suggestion = missedSessions > 0
    ? `Try recovering your ${missedSessions} missed session${missedSessions === 1 ? '' : 's'} and protect your ${bestDay || 'best'} study time next week.`
    : completionPct >= 80 && totalSessions > 0
      ? 'Great consistency — consider raising your weekly study target slightly.'
      : 'Aim to complete at least 80% of planned sessions next week; shorter, more frequent sessions can help.';

  return {
    week_start: wsStr.slice(0, 10),
    week_end: fmtLocal(new Date(we.getTime() - 86400000)).slice(0, 10),
    planned_hours: round1(plannedHours),
    completed_hours: round1(completedHours),
    total_sessions: totalSessions,
    completed_sessions: completedSessions,
    missed_sessions: missedSessions,
    completion_pct: completionPct,
    focus_sessions: focus.n,
    focus_minutes: focus.m,
    streak,
    best_day: bestDay,
    most_studied: mostStudied ? { title: mostStudied.title, code: mostStudied.code, hours: round1(mostStudied.hours) } : null,
    least_studied: leastStudied ? { title: leastStudied.title, code: leastStudied.code, hours: round1(leastStudied.hours) } : null,
    needs_attention: needsAttention.map(c => ({ title: c.title, code: c.code, pct: c.pct })),
    insight_text: parts.join(' '),
    suggestion,
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

module.exports = { weeklyInsights };
