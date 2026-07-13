/**
 * EduFlex Adaptive Scheduling Engine.
 *
 * Generates study sessions from:
 *  - the student's weekly availability slots
 *  - pending deadlines (urgency + priority + estimated hours)
 *  - course difficulty
 *
 * Core rules (see PROMPT.md §6):
 *  1. Deadlines are served in order of urgency (closest due date first);
 *     priority breaks ties, so High priority work grabs the earliest slots.
 *  2. Hard courses get longer chunks (and therefore more contiguous time).
 *  3. Sessions are only placed inside availability windows, never in the past,
 *     never after the deadline is due, and never overlapping existing sessions.
 *  4. Large estimated_hours are split into manageable chunks (0.5h – 2h).
 */
const { db, nowISO, fmtLocal } = require('./db');

const PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };
// Maximum single-session length in hours, by course difficulty.
const MAX_CHUNK_BY_DIFFICULTY = { Hard: 2, Moderate: 1.5, Easy: 1 };
const MIN_CHUNK_HOURS = 0.5;
const HORIZON_DAYS = 28; // never plan further than 4 weeks ahead

/** Parse a local "YYYY-MM-DDTHH:MM" string into a Date. */
function parseLocal(s) {
  return new Date(s);
}

/** Difference in hours between two dates. */
function hoursBetween(a, b) {
  return (b.getTime() - a.getTime()) / 3600000;
}

/**
 * Build the list of free time windows for a user between `from` and `to`,
 * based on weekly availability slots minus already-occupied study sessions.
 * Returns [{ start: Date, end: Date, intensity }] sorted by start time.
 */
function buildFreeWindows(userId, from, to) {
  const slots = db.prepare(
    'SELECT * FROM availability_slots WHERE user_id = ?'
  ).all(userId);
  if (slots.length === 0) return [];

  // Future sessions still occupying time (missed/past ones don't block).
  const busy = db.prepare(
    `SELECT start_datetime, end_datetime FROM study_sessions
     WHERE user_id = ? AND status IN ('Planned','Rescheduled')
       AND end_datetime >= ?`
  ).all(userId, fmtLocal(from)).map(r => ({
    start: parseLocal(r.start_datetime),
    end: parseLocal(r.end_datetime),
  }));

  const windows = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (cursor <= to) {
    for (const slot of slots) {
      if (slot.day_of_week !== cursor.getDay()) continue;
      const [sh, sm] = slot.start_time.split(':').map(Number);
      const [eh, em] = slot.end_time.split(':').map(Number);
      let wStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), sh, sm);
      const wEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), eh, em);
      // Rule: never schedule in the past — clip today's window to "now".
      if (wStart < from) wStart = new Date(from);
      if (wEnd <= wStart) continue;

      // Subtract busy intervals from this window.
      let free = [{ start: wStart, end: wEnd }];
      for (const b of busy) {
        free = free.flatMap(w => {
          if (b.end <= w.start || b.start >= w.end) return [w]; // no overlap
          const parts = [];
          if (b.start > w.start) parts.push({ start: w.start, end: b.start });
          if (b.end < w.end) parts.push({ start: b.end, end: w.end });
          return parts;
        });
      }
      for (const w of free) {
        if (hoursBetween(w.start, w.end) >= MIN_CHUNK_HOURS) {
          windows.push({ start: w.start, end: w.end, intensity: slot.study_intensity });
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  windows.sort((a, b) => a.start - b.start);
  return windows;
}

/**
 * Generate study sessions for every pending deadline that still needs hours.
 * Returns { created, skipped, messages } for user feedback.
 */
function generateSchedule(userId) {
  const now = new Date();
  const messages = [];

  const deadlines = db.prepare(
    `SELECT d.*, c.title AS course_title, c.code AS course_code, c.difficulty
     FROM deadlines d JOIN courses c ON c.id = d.course_id
     WHERE d.user_id = ? AND d.status = 'Pending' AND d.due_date > ?
     ORDER BY d.due_date ASC`
  ).all(userId, fmtLocal(now));

  if (deadlines.length === 0) {
    return { created: 0, skipped: 0, messages: ['No pending future deadlines to schedule. Add a deadline first.'] };
  }

  // Urgency first (closest due date), then priority weight breaks ties.
  deadlines.sort((a, b) => {
    const t = parseLocal(a.due_date) - parseLocal(b.due_date);
    if (t !== 0) return t;
    return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  });

  const lastDue = parseLocal(deadlines[deadlines.length - 1].due_date);
  const horizon = new Date(Math.min(lastDue.getTime(), now.getTime() + HORIZON_DAYS * 86400000));
  const windows = buildFreeWindows(userId, now, horizon);
  if (windows.length === 0) {
    return { created: 0, skipped: deadlines.length, messages: ['No free availability found. Add availability slots first.'] };
  }

  const insert = db.prepare(
    `INSERT INTO study_sessions
       (user_id, course_id, deadline_id, title, start_datetime, end_datetime,
        status, study_intensity, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'Planned', ?, ?, ?, ?)`
  );

  let created = 0, skipped = 0;

  for (const dl of deadlines) {
    // Hours already covered by planned/completed sessions for this deadline.
    const already = db.prepare(
      `SELECT COALESCE(SUM((julianday(end_datetime) - julianday(start_datetime)) * 24), 0) AS h
       FROM study_sessions
       WHERE deadline_id = ? AND status IN ('Planned','Completed','Rescheduled')`
    ).get(dl.id).h;

    let remaining = Math.max(0, dl.estimated_hours - already);
    if (remaining < MIN_CHUNK_HOURS) { skipped++; continue; }

    const due = parseLocal(dl.due_date);
    const maxChunk = MAX_CHUNK_BY_DIFFICULTY[dl.difficulty] || 1.5;

    // Greedy: fill the earliest free windows that end before the deadline.
    for (const w of windows) {
      if (remaining < MIN_CHUNK_HOURS) break;
      if (w.start >= due) break; // windows are sorted; nothing usable after due date
      const usableEnd = new Date(Math.min(w.end.getTime(), due.getTime()));
      const available = hoursBetween(w.start, usableEnd);
      if (available < MIN_CHUNK_HOURS) continue;

      // Session length: capped by window space, difficulty cap, and hours left.
      const len = Math.max(MIN_CHUNK_HOURS, Math.min(available, maxChunk, remaining));
      const sStart = new Date(w.start);
      const sEnd = new Date(sStart.getTime() + len * 3600000);

      const ts = nowISO();
      insert.run(
        userId, dl.course_id, dl.id,
        `${dl.course_code}: study for ${dl.title}`,
        fmtLocal(sStart), fmtLocal(sEnd),
        w.intensity,
        `Auto-generated for ${dl.type} "${dl.title}" (due ${dl.due_date.replace('T', ' ')})`,
        ts, ts
      );
      created++;
      remaining -= len;

      // Shrink the window so later deadlines can use what's left of it.
      w.start = sEnd;
    }

    if (remaining >= MIN_CHUNK_HOURS) {
      messages.push(`Not enough free time before "${dl.title}" — ${remaining.toFixed(1)}h could not be placed. Add more availability.`);
    }
  }

  // Drop fully-consumed windows for cleanliness (not strictly required).
  if (created > 0) messages.unshift(`Created ${created} study session${created === 1 ? '' : 's'}.`);
  if (created === 0 && messages.length === 0) {
    messages.push('All pending deadlines already have enough study time scheduled.');
  }
  return { created, skipped, messages };
}

module.exports = { generateSchedule, buildFreeWindows };
