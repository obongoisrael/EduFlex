/**
 * Smart Recommendation services (Phase 2 §2 + §3).
 *
 *  - studyRecommendations(): what to study next — highest-risk work first,
 *    placed in real future availability windows, with a written reason.
 *  - resourceRecommendations(): shared resources matching the student's
 *    courses & upcoming deadline types, ranked by quality score.
 */
const { db, fmtLocal } = require('../db');
const { buildFreeWindows } = require('../scheduler');
const { assessRisks } = require('./risk');
const { qualityScore } = require('./quality');

const DURATION_BY_DIFFICULTY = { Hard: 120, Moderate: 90, Easy: 60 }; // minutes

/**
 * Suggest up to `limit` study actions.
 * Rules: high risk first, then closer deadline / harder course / higher priority
 * (already encoded in the risk score); only inside availability; never in the past.
 */
function studyRecommendations(userId, limit = 3) {
  const risks = assessRisks(userId).filter(r => r.remaining_hours > 0);
  if (risks.length === 0) {
    return { recommendations: [], message: 'No pending deadlines need more study time. Nice work!' };
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 86400000);
  const windows = buildFreeWindows(userId, now, horizon);
  if (windows.length === 0) {
    return { recommendations: [], message: 'You have no free availability this week. Add availability slots so EduFlex can suggest study times.' };
  }

  const recs = [];
  for (const r of risks) {
    const due = new Date(r.due_date);
    // earliest window with usable time before the deadline
    const w = windows.find(w => w.start < due && (Math.min(w.end, due) - w.start) >= 30 * 60000);
    if (!w) continue;

    const usableEnd = new Date(Math.min(w.end.getTime(), due.getTime()));
    const durationMin = Math.min(
      DURATION_BY_DIFFICULTY[r.difficulty] || 90,
      Math.round((usableEnd - w.start) / 60000),
      Math.max(30, Math.round(r.remaining_hours * 60))
    );
    const start = new Date(w.start);
    const end = new Date(start.getTime() + durationMin * 60000);

    const reasonBits = [`your ${r.deadline_type} "${r.deadline_title}" is due in ${r.days_left} day${r.days_left === 1 ? '' : 's'}`];
    if (r.difficulty === 'Hard') reasonBits.push('the course is marked Hard');
    if (r.priority === 'High') reasonBits.push('it is high priority');
    if (r.missed_sessions > 0) reasonBits.push(`you missed ${r.missed_sessions} previous session${r.missed_sessions === 1 ? '' : 's'}`);

    recs.push({
      course_id: r.course_id,
      course_title: r.course_title,
      course_code: r.course_code,
      deadline_id: r.deadline_id,
      deadline_title: r.deadline_title,
      risk_level: r.risk_level,
      suggested_start: fmtLocal(start),
      suggested_end: fmtLocal(end),
      suggested_duration_minutes: durationMin,
      intensity: w.intensity,
      reason: `Study ${r.course_title} for ${durationMin} minutes (${fmtLocal(start).slice(11)}–${fmtLocal(end).slice(11)}) because ${reasonBits.join(', ')}.`,
      action: 'Add this session to your schedule',
    });

    w.start = end; // consume the window so the next rec doesn't overlap
    if (recs.length >= limit) break;
  }

  return {
    recommendations: recs,
    message: recs.length === 0 ? 'No free time found before your deadlines — add more availability slots.' : null,
  };
}

/** Map deadline types to the resource categories most useful for them. */
const CATEGORY_FOR_TYPE = {
  'CAT/Test': ['Past Paper', 'Notes'],
  'Exam': ['Past Paper', 'Notes'],
  'Assignment': ['Assignment Guide', 'Notes'],
  'Project': ['Assignment Guide', 'Slides'],
  'Presentation': ['Slides', 'Notes'],
};

/** Tokenize a course title/code for fuzzy matching. */
function tokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3);
}

/**
 * Recommend up to `limit` shared resources relevant to the student's courses
 * and upcoming deadlines, ranked by relevance + quality score.
 */
function resourceRecommendations(userId, limit = 6) {
  const me = db.prepare('SELECT institution FROM users WHERE id = ?').get(userId);
  const myCourses = db.prepare('SELECT title, code FROM courses WHERE user_id = ?').all(userId);
  const pendingTypes = db.prepare(
    `SELECT DISTINCT type FROM deadlines WHERE user_id = ? AND status = 'Pending'`
  ).all(userId).map(r => r.type);
  const wantedCategories = new Set(pendingTypes.flatMap(t => CATEGORY_FOR_TYPE[t] || []));

  const courseTokens = new Set(myCourses.flatMap(c => [...tokens(c.title), ...tokens(c.code)]));
  const myCodes = new Set(myCourses.map(c => c.code.toLowerCase()));

  const all = db.prepare(
    `SELECT id, user_id, title, description, course_name, course_code, category, institution,
            public_username, upvotes_count, views_count, downloads_count, created_at
     FROM resources`
  ).all();

  const scored = all.map(r => {
    const q = qualityScore(r, me?.institution);
    let relevance = 0;
    if (r.course_code && myCodes.has(r.course_code.toLowerCase())) relevance += 40; // exact course match
    const rTokens = [...tokens(r.course_name), ...tokens(r.title), ...tokens(r.course_code)];
    relevance += Math.min(30, rTokens.filter(t => courseTokens.has(t)).length * 10);
    if (wantedCategories.has(r.category)) relevance += 15; // matches an upcoming deadline type
    if (r.institution === me?.institution) relevance += 5;
    if (r.user_id === userId) relevance -= 25; // prefer *discovering* others' materials
    return {
      ...r,
      user_id: undefined, // privacy: never leak internal owner ids
      quality_score: q.score,
      quality_label: q.label,
      relevance,
      total: relevance + q.score * 0.4,
    };
  })
  .filter(r => r.relevance > 0)
  .sort((a, b) => b.total - a.total)
  .slice(0, limit);

  return scored;
}

module.exports = { studyRecommendations, resourceRecommendations };
