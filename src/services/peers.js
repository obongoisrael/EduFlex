/**
 * Peer Study Matching service (Phase 2 §8).
 *
 * PRIVACY: every object returned here contains ONLY public_username initials
 * and institution — never first/last names or email addresses. Matching only
 * considers students who explicitly opted in (users.peer_matching_enabled = 1).
 */
const { db } = require('../db');

function tokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Suggest peers with similar courses / codes / availability. */
function findMatches(userId) {
  const me = db.prepare('SELECT id, institution, peer_matching_enabled FROM users WHERE id = ?').get(userId);
  if (!me || !me.peer_matching_enabled) return { enabled: false, matches: [] };

  const myCourses = db.prepare('SELECT title, code FROM courses WHERE user_id = ?').all(userId);
  // Roadmap integration: subjects being studied via roadmaps also count as interests
  const myRoadmaps = db.prepare('SELECT course_name AS title, course_code AS code FROM learning_roadmaps WHERE user_id = ?').all(userId);
  const mySlots = db.prepare('SELECT day_of_week, start_time, end_time FROM availability_slots WHERE user_id = ?').all(userId);
  const myTokens = new Set([...myCourses, ...myRoadmaps].flatMap(c => [...tokens(c.title), ...tokens(c.code)]));
  const myCodes = new Set([...myCourses, ...myRoadmaps].map(c => (c.code || '').toLowerCase()).filter(Boolean));

  // Only opted-in students appear as candidates (privacy: initials + institution only)
  const candidates = db.prepare(
    `SELECT id, public_username, institution FROM users
     WHERE id != ? AND peer_matching_enabled = 1`
  ).all(userId);

  const matches = [];
  for (const peer of candidates) {
    const theirCourses = [
      ...db.prepare('SELECT title, code FROM courses WHERE user_id = ?').all(peer.id),
      ...db.prepare('SELECT course_name AS title, course_code AS code FROM learning_roadmaps WHERE user_id = ?').all(peer.id),
    ];
    const shared = theirCourses.filter(c =>
      myCodes.has((c.code || '').toLowerCase()) ||
      tokens(c.title).some(t => myTokens.has(t)));
    if (shared.length === 0) continue; // must share at least one academic interest

    // Overlapping availability (same weekday, overlapping times)
    const theirSlots = db.prepare('SELECT day_of_week, start_time, end_time FROM availability_slots WHERE user_id = ?').all(peer.id);
    let commonSlot = null;
    for (const a of mySlots) {
      const b = theirSlots.find(b => b.day_of_week === a.day_of_week && b.start_time < a.end_time && b.end_time > a.start_time);
      if (b) {
        const start = a.start_time > b.start_time ? a.start_time : b.start_time;
        const end = a.end_time < b.end_time ? a.end_time : b.end_time;
        commonSlot = `${DAY_NAMES[a.day_of_week]} ${start}–${end}`;
        break;
      }
    }

    const exactCode = shared.some(c => myCodes.has(c.code.toLowerCase()));
    const reasons = [exactCode ? 'Same course' : 'Similar course'];
    if (peer.institution === me.institution) reasons.push('same institution');
    if (commonSlot) reasons.push('overlapping study time');

    matches.push({
      user_id: peer.id, // needed to send a study request; no personal data attached
      public_username: peer.public_username,
      institution: peer.institution,
      shared_courses: shared.map(c => `${c.code} — ${c.title}`).slice(0, 3),
      common_slot: commonSlot,
      match_reason: reasons.join(', ') + '.',
      score: shared.length * 10 + (exactCode ? 10 : 0) + (peer.institution === me.institution ? 5 : 0) + (commonSlot ? 5 : 0),
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return { enabled: true, matches: matches.slice(0, 12) };
}

module.exports = { findMatches };
