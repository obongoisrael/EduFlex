/**
 * Academic Risk Prediction service (Phase 2 §1).
 *
 * For every pending future deadline, computes a 0–100 risk score from:
 *   - remaining study hours vs. free availability before the due date
 *   - days left, priority, course difficulty
 *   - missed sessions and repeated rescheduling for the course
 *   - actual progress (completed hours vs. estimated hours)
 *
 * Levels: score >= 65 → High, >= 35 → Medium, else Low.
 */
const { db, fmtLocal } = require('../db');
const { buildFreeWindows } = require('../scheduler');

/** @returns {Array<object>} risk assessments sorted most-risky first */
function assessRisks(userId) {
  const now = new Date();
  const deadlines = db.prepare(
    `SELECT d.*, c.title AS course_title, c.code AS course_code, c.difficulty
     FROM deadlines d JOIN courses c ON c.id = d.course_id
     WHERE d.user_id = ? AND d.status = 'Pending' AND d.due_date > ?
     ORDER BY d.due_date ASC`
  ).all(userId, fmtLocal(now));
  if (deadlines.length === 0) return [];

  // One availability scan up to the furthest deadline, reused for each one.
  const lastDue = new Date(deadlines[deadlines.length - 1].due_date);
  const windows = buildFreeWindows(userId, now, lastDue);

  const results = [];
  for (const dl of deadlines) {
    const due = new Date(dl.due_date);
    const daysLeft = Math.max(0, (due - now) / 86400000);

    const completedHours = db.prepare(
      `SELECT COALESCE(SUM((julianday(end_datetime) - julianday(start_datetime)) * 24), 0) AS h
       FROM study_sessions WHERE deadline_id = ? AND status = 'Completed'`
    ).get(dl.id).h;
    const missed = db.prepare(
      `SELECT COUNT(*) AS n FROM study_sessions WHERE user_id = ? AND course_id = ? AND status = 'Missed'`
    ).get(userId, dl.course_id).n;
    const rescheduled = db.prepare(
      `SELECT COUNT(*) AS n FROM study_sessions WHERE user_id = ? AND course_id = ? AND status = 'Rescheduled'`
    ).get(userId, dl.course_id).n;

    const remaining = Math.max(0, dl.estimated_hours - completedHours);
    const availableHours = windows.reduce((sum, w) => {
      const end = Math.min(w.end.getTime(), due.getTime());
      return sum + Math.max(0, (end - w.start.getTime()) / 3600000);
    }, 0);

    let score = 0;
    if (remaining > 0) {
      // Time pressure: how tight is the remaining work vs. free time before due?
      const ratio = availableHours > 0 ? remaining / availableHours : 2;
      score += Math.min(50, ratio * 35);
    }
    if (daysLeft <= 2) score += 20;
    else if (daysLeft <= 5) score += 10;
    score += Math.min(15, missed * 5);           // missed sessions raise risk
    score += Math.min(6, rescheduled * 2);       // chronic rescheduling raises risk slightly
    if (dl.priority === 'High') score += 8;
    else if (dl.priority === 'Medium') score += 4;
    if (dl.difficulty === 'Hard') score += 8;
    else if (dl.difficulty === 'Moderate') score += 4;
    // Solid progress lowers risk
    const progress = dl.estimated_hours > 0 ? completedHours / dl.estimated_hours : 1;
    if (progress >= 0.8) score -= 20;
    else if (progress >= 0.5) score -= 10;

    score = Math.max(0, Math.min(100, Math.round(score)));
    const level = score >= 65 ? 'High' : score >= 35 ? 'Medium' : 'Low';

    // Human-readable explanation, e.g. the §1 example card
    const parts = [];
    parts.push(`${dl.title} (${dl.course_code}) is due in ${daysLeft < 1 ? 'less than a day' : Math.ceil(daysLeft) + ' day' + (Math.ceil(daysLeft) === 1 ? '' : 's')}.`);
    parts.push(`You have completed ${round1(completedHours)} of ${dl.estimated_hours} required study hours`
      + (missed > 0 ? ` and missed ${missed} session${missed === 1 ? '' : 's'}.` : '.'));
    if (level === 'High') {
      parts.push(remaining > availableHours
        ? `Only ${round1(availableHours)}h of free study time remain before the deadline — EduFlex recommends adding availability and scheduling extra focus time.`
        : 'EduFlex recommends scheduling extra focus time now.');
    } else if (level === 'Medium') {
      parts.push('You have some progress but may not finish on time — keep a steady pace.');
    } else {
      parts.push('You are on track. Keep it up!');
    }

    results.push({
      deadline_id: dl.id,
      deadline_title: dl.title,
      deadline_type: dl.type,
      due_date: dl.due_date,
      priority: dl.priority,
      course_id: dl.course_id,
      course_title: dl.course_title,
      course_code: dl.course_code,
      difficulty: dl.difficulty,
      estimated_hours: dl.estimated_hours,
      completed_hours: round1(completedHours),
      remaining_hours: round1(remaining),
      available_hours: round1(availableHours),
      missed_sessions: missed,
      rescheduled_sessions: rescheduled,
      days_left: Math.ceil(daysLeft),
      risk_score: score,
      risk_level: level,
      reason: parts.join(' '),
    });
  }

  results.sort((a, b) => b.risk_score - a.risk_score);
  return results;
}

function round1(n) { return Math.round(n * 10) / 10; }

module.exports = { assessRisks };
