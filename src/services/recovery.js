/**
 * Missed Session Recovery service (Phase 2 §4).
 *
 * Finds missed sessions that haven't been handled yet, and proposes up to 3
 * future recovery slots (from real availability). Accepting creates a new
 * session marked Rescheduled, linked back via original_session_id.
 */
const { db, nowISO, fmtLocal } = require('../db');
const { buildFreeWindows } = require('../scheduler');

/** Missed sessions awaiting a decision, each with up to 3 suggested slots. */
function recoverySuggestions(userId) {
  const missed = db.prepare(
    `SELECT s.*, c.title AS course_title, c.code AS course_code
     FROM study_sessions s JOIN courses c ON c.id = s.course_id
     WHERE s.user_id = ? AND s.status = 'Missed' AND s.recovery_status IS NULL
     ORDER BY s.start_datetime DESC LIMIT 5`
  ).all(userId);
  if (missed.length === 0) return [];

  const now = new Date();
  const windows = buildFreeWindows(userId, now, new Date(now.getTime() + 7 * 86400000));

  return missed.map(s => {
    const durationMs = new Date(s.end_datetime) - new Date(s.start_datetime);
    const options = [];
    for (const w of windows) {
      if (options.length >= 3) break;
      if ((w.end - w.start) >= Math.min(durationMs, 30 * 60000)) {
        const start = new Date(w.start);
        const end = new Date(Math.min(start.getTime() + durationMs, w.end.getTime()));
        options.push({ start_datetime: fmtLocal(start), end_datetime: fmtLocal(end), intensity: w.intensity });
        w.start = end; // don't offer the same minutes twice
      }
    }
    return {
      session_id: s.id,
      title: s.title,
      course_title: s.course_title,
      course_code: s.course_code,
      course_id: s.course_id,
      deadline_id: s.deadline_id,
      missed_at: s.start_datetime,
      duration_minutes: Math.round(durationMs / 60000),
      options,
    };
  });
}

/** Accept a recovery slot (or a custom one) for a missed session. */
function acceptRecovery(userId, sessionId, startDt, endDt) {
  const s = db.prepare('SELECT * FROM study_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!s) return { error: 'Session not found.', status: 404 };
  if (s.status !== 'Missed') return { error: 'Only missed sessions can be recovered.', status: 400 };
  if (!startDt || !endDt || endDt <= startDt) return { error: 'Invalid recovery time.', status: 400 };
  if (new Date(startDt) < new Date()) return { error: 'Recovery time cannot be in the past.', status: 400 };

  const ts = nowISO();
  const info = db.prepare(
    `INSERT INTO study_sessions
       (user_id, course_id, deadline_id, title, start_datetime, end_datetime,
        status, study_intensity, notes, original_session_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'Rescheduled', ?, ?, ?, ?, ?)`
  ).run(
    userId, s.course_id, s.deadline_id,
    s.title.includes('(recovery)') ? s.title : `${s.title} (recovery)`,
    startDt, endDt, s.study_intensity,
    `Recovery of session missed on ${s.start_datetime.replace('T', ' ')}`,
    s.id, ts, ts
  );
  db.prepare(`UPDATE study_sessions SET recovery_status = 'Recovered', updated_at = ? WHERE id = ?`)
    .run(ts, s.id);
  return { id: Number(info.lastInsertRowid) };
}

/** Dismiss recovery for a missed session (stops suggesting it). */
function ignoreRecovery(userId, sessionId) {
  const info = db.prepare(
    `UPDATE study_sessions SET recovery_status = 'Ignored', updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'Missed'`
  ).run(nowISO(), sessionId, userId);
  return info.changes > 0;
}

module.exports = { recoverySuggestions, acceptRecovery, ignoreRecovery };
