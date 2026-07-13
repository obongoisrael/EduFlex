/**
 * Smart Learning Roadmap service: progress recalculation, study-schedule
 * generation from roadmap topics, library resource matching, and syncing
 * topic progress when linked study sessions complete.
 */
const { db, nowISO, fmtLocal } = require('../db');
const { buildFreeWindows } = require('../scheduler');
const { qualityScore } = require('./quality');

function tokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3);
}

/** Recompute roadmap progress % (hour-weighted topic completion) and status. */
function recalcProgress(roadmapId) {
  const topics = db.prepare(
    'SELECT estimated_hours, status FROM roadmap_topics WHERE roadmap_id = ?'
  ).all(roadmapId);
  const active = topics.filter(t => t.status !== 'Skipped');
  const total = active.reduce((s, t) => s + t.estimated_hours, 0);
  const done = active.filter(t => t.status === 'Completed')
    .reduce((s, t) => s + t.estimated_hours, 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const rm = db.prepare('SELECT status FROM learning_roadmaps WHERE id = ?').get(roadmapId);
  let status = rm ? rm.status : 'Not Started';
  if (status !== 'Paused') {
    if (pct >= 100 && active.length > 0) status = 'Completed';
    else if (topics.some(t => t.status !== 'Not Started')) status = 'In Progress';
  }
  db.prepare('UPDATE learning_roadmaps SET progress_percentage = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(pct, status, nowISO(), roadmapId);

  // Stage statuses follow their topics
  for (const st of db.prepare('SELECT id FROM roadmap_stages WHERE roadmap_id = ?').all(roadmapId)) {
    const ts = db.prepare('SELECT status FROM roadmap_topics WHERE stage_id = ?').all(st.id);
    if (ts.length === 0) continue;
    const stStatus = ts.every(t => t.status === 'Completed' || t.status === 'Skipped') ? 'Completed'
      : ts.some(t => t.status !== 'Not Started') ? 'In Progress' : 'Not Started';
    db.prepare('UPDATE roadmap_stages SET status = ?, updated_at = ? WHERE id = ?')
      .run(stStatus, nowISO(), st.id);
  }
  return pct;
}

/**
 * Called when a study session linked to a roadmap topic is completed:
 * once completed session hours cover the topic estimate, complete the topic.
 */
function syncTopicFromSessions(topicId) {
  const topic = db.prepare('SELECT * FROM roadmap_topics WHERE id = ?').get(topicId);
  if (!topic || topic.status === 'Completed' || topic.status === 'Skipped') return;
  const doneHours = db.prepare(
    `SELECT COALESCE(SUM((julianday(end_datetime) - julianday(start_datetime)) * 24), 0) AS h
     FROM study_sessions WHERE roadmap_topic_id = ? AND status = 'Completed'`
  ).get(topicId).h;
  const newStatus = doneHours >= topic.estimated_hours ? 'Completed' : 'In Progress';
  if (newStatus !== topic.status) {
    db.prepare('UPDATE roadmap_topics SET status = ?, updated_at = ? WHERE id = ?')
      .run(newStatus, nowISO(), topicId);
  }
  recalcProgress(topic.roadmap_id);
}

/** Match roadmap topics against the shared resource library (top matches). */
function matchLibraryResources(userId, courseName, courseCode, topicTitles, limit = 5) {
  const viewer = db.prepare('SELECT institution FROM users WHERE id = ?').get(userId);
  const wanted = new Set([...tokens(courseName), ...tokens(courseCode), ...topicTitles.flatMap(tokens)]);
  const all = db.prepare(
    `SELECT id, title, course_name, course_code, category, institution, public_username,
            upvotes_count, views_count, downloads_count, created_at, description, file_type
     FROM resources`
  ).all();
  return all.map(r => {
    const rTokens = [...tokens(r.title), ...tokens(r.course_name), ...tokens(r.course_code)];
    const overlap = rTokens.filter(t => wanted.has(t)).length;
    const q = qualityScore(r, viewer?.institution);
    return { ...r, quality_score: q.score, quality_label: q.label, relevance: overlap };
  })
  .filter(r => r.relevance > 0)
  .sort((a, b) => (b.relevance * 20 + b.quality_score) - (a.relevance * 20 + a.quality_score))
  .slice(0, limit);
}

/**
 * Generate study sessions from roadmap topics (all pending, or one topic).
 * Sessions are placed in real availability windows, never in the past,
 * respect the roadmap deadline, and link back to the roadmap + topic.
 */
function scheduleRoadmap(userId, roadmap, onlyTopicId = null) {
  const now = new Date();
  const deadline = roadmap.deadline_date ? new Date(roadmap.deadline_date) : null;
  const horizon = deadline && deadline > now
    ? new Date(Math.min(deadline.getTime(), now.getTime() + 42 * 86400000))
    : new Date(now.getTime() + Math.min(roadmap.duration_days || 28, 42) * 86400000);

  const windows = buildFreeWindows(userId, now, horizon);
  if (windows.length === 0) {
    return { created: 0, messages: ['No free availability found — add availability slots first.'] };
  }

  let topics = db.prepare(
    `SELECT t.*, s.stage_order FROM roadmap_topics t
     JOIN roadmap_stages s ON s.id = t.stage_id
     WHERE t.roadmap_id = ? AND t.status IN ('Not Started','In Progress')
     ORDER BY s.stage_order, t.topic_order`
  ).all(roadmap.id);
  if (onlyTopicId) topics = topics.filter(t => t.id === onlyTopicId);
  if (topics.length === 0) return { created: 0, messages: ['No pending topics to schedule.'] };

  const insert = db.prepare(
    `INSERT INTO study_sessions
       (user_id, course_id, deadline_id, title, start_datetime, end_datetime, status,
        study_intensity, notes, roadmap_id, roadmap_topic_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'Planned', ?, ?, ?, ?, ?, ?)`
  );

  let created = 0;
  const messages = [];
  const MAX_CHUNK = 2, MIN_CHUNK = 0.5;

  for (const topic of topics) {
    // hours already planned/completed for this topic
    const already = db.prepare(
      `SELECT COALESCE(SUM((julianday(end_datetime) - julianday(start_datetime)) * 24), 0) AS h
       FROM study_sessions WHERE roadmap_topic_id = ? AND status IN ('Planned','Completed','Rescheduled')`
    ).get(topic.id).h;
    let remaining = Math.max(0, topic.estimated_hours - already);

    for (const w of windows) {
      if (remaining < MIN_CHUNK) break;
      if (deadline && w.start >= deadline) break;
      const usableEnd = deadline ? new Date(Math.min(w.end.getTime(), deadline.getTime())) : w.end;
      const available = (usableEnd - w.start) / 3600000;
      if (available < MIN_CHUNK) continue;

      const len = Math.max(MIN_CHUNK, Math.min(available, MAX_CHUNK, remaining));
      const sStart = new Date(w.start);
      const sEnd = new Date(sStart.getTime() + len * 3600000);
      const ts = nowISO();
      insert.run(
        userId, roadmap.course_id, roadmap.deadline_id,
        `🗺️ ${roadmap.course_code || roadmap.course_name}: ${topic.title}`,
        fmtLocal(sStart), fmtLocal(sEnd), w.intensity,
        `Roadmap "${roadmap.title}" — stage topic: ${topic.title}`,
        roadmap.id, topic.id, ts, ts
      );
      created++;
      remaining -= len;
      w.start = sEnd; // consume window for the next topic
    }
    if (remaining >= MIN_CHUNK) {
      messages.push(`Not enough free time for "${topic.title}" — ${remaining.toFixed(1)}h unplaced.`);
    }
  }

  if (created > 0) messages.unshift(`Created ${created} study session${created === 1 ? '' : 's'} from the roadmap.`);
  return { created, messages };
}

module.exports = { recalcProgress, syncTopicFromSessions, matchLibraryResources, scheduleRoadmap };
