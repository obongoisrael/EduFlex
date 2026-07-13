/**
 * Smart Learning Roadmap routes.
 * Ownership is enforced on every query — students only see their own roadmaps.
 */
const express = require('express');
const { db, nowISO } = require('../db');
const { requireAuth, safe } = require('../middleware');
const { buildStructure } = require('../services/roadmapTemplates');
const { recalcProgress, matchLibraryResources, scheduleRoadmap } = require('../services/roadmaps');

const router = express.Router();
router.use(requireAuth);

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const STYLES = ['Theory-based', 'Practical', 'Project-based', 'Exam-focused', 'Mixed'];
const RM_STATUS = ['Not Started', 'In Progress', 'Completed', 'Paused'];
const ITEM_STATUS = ['Not Started', 'In Progress', 'Completed', 'Skipped'];

function ownRoadmap(req) {
  return db.prepare('SELECT * FROM learning_roadmaps WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.session.userId);
}

/** Is the roadmap behind schedule? (risk-prediction integration) */
function behindSchedule(rm) {
  if (rm.status === 'Completed' || rm.status === 'Paused') return false;
  const start = new Date(rm.created_at).getTime();
  const end = rm.deadline_date
    ? new Date(rm.deadline_date).getTime()
    : start + rm.duration_days * 86400000;
  const elapsed = (Date.now() - start) / Math.max(1, end - start);
  const expected = Math.min(100, Math.round(elapsed * 100));
  return expected - rm.progress_percentage > 15 && expected > 20;
}

// GET /api/roadmaps — list with progress, current stage, deadline, status
router.get('/', safe((req, res) => {
  const roadmaps = db.prepare(
    `SELECT * FROM learning_roadmaps WHERE user_id = ? ORDER BY created_at DESC`
  ).all(req.session.userId).map(rm => {
    const currentStage = db.prepare(
      `SELECT title FROM roadmap_stages WHERE roadmap_id = ? AND status != 'Completed' ORDER BY stage_order LIMIT 1`
    ).get(rm.id);
    const nextTopic = db.prepare(
      `SELECT t.title FROM roadmap_topics t JOIN roadmap_stages s ON s.id = t.stage_id
       WHERE t.roadmap_id = ? AND t.status IN ('Not Started','In Progress')
       ORDER BY s.stage_order, t.topic_order LIMIT 1`
    ).get(rm.id);
    return {
      ...rm,
      current_stage: currentStage ? currentStage.title : 'All stages complete',
      next_topic: nextTopic ? nextTopic.title : null,
      behind_schedule: behindSchedule(rm),
    };
  });
  res.json({ roadmaps });
}));

// POST /api/roadmaps/preview — generate a structure for editing (NOT saved)
router.post('/preview', safe((req, res) => {
  const b = req.body || {};
  if (!b.course_name || !b.course_name.trim()) return res.status(400).json({ error: 'Course or unit name is required.' });
  if (b.current_level && !LEVELS.includes(b.current_level)) return res.status(400).json({ error: 'Invalid level.' });
  if (b.preferred_learning_style && !STYLES.includes(b.preferred_learning_style)) return res.status(400).json({ error: 'Invalid learning style.' });
  const structure = buildStructure(b);
  res.json({ structure });
}));

// POST /api/roadmaps — save a (possibly edited) generated roadmap
router.post('/', safe((req, res) => {
  const b = req.body || {};
  const st = b.structure;
  if (!b.course_name || !b.course_name.trim()) return res.status(400).json({ error: 'Course name is required.' });
  if (!st || !Array.isArray(st.stages) || st.stages.length === 0) return res.status(400).json({ error: 'Roadmap structure is empty.' });
  if (!LEVELS.includes(b.current_level || 'Beginner')) return res.status(400).json({ error: 'Invalid level.' });
  if (!STYLES.includes(b.preferred_learning_style || 'Mixed')) return res.status(400).json({ error: 'Invalid learning style.' });

  const ts = nowISO();
  const uid = req.session.userId;

  // Course integration: link an existing course, or auto-create one so
  // roadmap study sessions always belong to a course.
  let courseId = b.course_id ? Number(b.course_id) : null;
  if (courseId) {
    const c = db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?').get(courseId, uid);
    if (!c) return res.status(400).json({ error: 'Course not found.' });
  } else {
    const code = (b.course_code || b.course_name.slice(0, 8)).trim().toUpperCase();
    const existing = db.prepare('SELECT id FROM courses WHERE user_id = ? AND (code = ? OR title = ?)')
      .get(uid, code, b.course_name.trim());
    courseId = existing ? existing.id : Number(db.prepare(
      'INSERT INTO courses (user_id, title, code, difficulty, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).run(uid, b.course_name.trim(), code, b.difficulty || 'Moderate',
      'Created automatically from a learning roadmap.', ts, ts).lastInsertRowid);
  }

  // Optional deadline link
  let deadlineId = null;
  if (b.deadline_id) {
    const d = db.prepare('SELECT id FROM deadlines WHERE id = ? AND user_id = ?').get(Number(b.deadline_id), uid);
    if (d) deadlineId = d.id;
  }

  const rmId = Number(db.prepare(
    `INSERT INTO learning_roadmaps
       (user_id, course_id, deadline_id, title, course_name, course_code, goal, current_level,
        target_level, preferred_learning_style, difficulty, duration_days, deadline_date,
        status, progress_percentage, source, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'Not Started', 0, ?, ?, ?)`
  ).run(
    uid, courseId, deadlineId,
    (b.title || `${b.course_name} Learning Roadmap`).trim().slice(0, 100),
    b.course_name.trim(), (b.course_code || '').trim().toUpperCase(),
    (b.goal || '').trim().slice(0, 300), b.current_level || 'Beginner',
    (b.target_level || '').trim(), b.preferred_learning_style || 'Mixed',
    b.difficulty || 'Moderate',
    Math.max(1, Math.min(180, Number(b.duration_days) || 14)),
    b.deadline_date || null, st.source || 'custom', ts, ts
  ).lastInsertRowid);

  // Stages → topics → tasks
  const insStage = db.prepare(
    `INSERT INTO roadmap_stages (roadmap_id, title, description, stage_order, estimated_hours, status, created_at, updated_at)
     VALUES (?,?,?,?,?, 'Not Started', ?, ?)`);
  const insTopic = db.prepare(
    `INSERT INTO roadmap_topics (roadmap_id, stage_id, title, description, topic_order, estimated_hours, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'Not Started', ?, ?)`);
  const insTask = db.prepare(
    `INSERT INTO roadmap_tasks (roadmap_id, stage_id, topic_id, title, task_type, estimated_minutes, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'Not Started', ?, ?)`);
  const insTool = db.prepare(
    `INSERT INTO roadmap_tools (roadmap_id, name, purpose, category, is_required, created_at) VALUES (?,?,?,?,?,?)`);
  const insRes = db.prepare(
    `INSERT INTO roadmap_resources (roadmap_id, topic_id, resource_id, resource_title, resource_type, source_type, quality_score, created_at)
     VALUES (?,?,?,?,?,?,?,?)`);

  const topicTitles = [];
  st.stages.forEach((stage, si) => {
    if (!stage.title || !Array.isArray(stage.topics) || stage.topics.length === 0) return;
    const hours = stage.topics.reduce((s, t) => s + (Number(t.hours) || 1), 0);
    const stageId = Number(insStage.run(rmId, String(stage.title).slice(0, 100),
      String(stage.description || ''), si, hours, ts, ts).lastInsertRowid);
    stage.topics.forEach((topic, ti) => {
      if (!topic.title) return;
      topicTitles.push(topic.title);
      const topicId = Number(insTopic.run(rmId, stageId, String(topic.title).slice(0, 150),
        String(topic.description || ''), ti, Math.max(0.5, Number(topic.hours) || 1), ts, ts).lastInsertRowid);
      (topic.tasks || []).forEach(task => {
        if (!task.title) return;
        insTask.run(rmId, stageId, topicId, String(task.title).slice(0, 200),
          ['Practice', 'Mini-project', 'Checkpoint', 'Reading'].includes(task.task_type) ? task.task_type : 'Practice',
          Math.max(5, Number(task.estimated_minutes) || 30), ts, ts);
      });
    });
  });
  (st.tools || []).forEach(t => {
    if (t.name) insTool.run(rmId, String(t.name).slice(0, 100), String(t.purpose || ''), String(t.category || ''), t.is_required ? 1 : 0, ts);
  });

  // Smart resource recommendations stored per roadmap (library matches)
  for (const r of matchLibraryResources(uid, b.course_name, b.course_code, topicTitles, 5)) {
    insRes.run(rmId, null, r.id, r.title, r.category, 'library', r.quality_score, ts);
  }

  res.status(201).json({ id: rmId });
}));

// GET /api/roadmaps/:id — full detail
router.get('/:id', safe((req, res) => {
  const rm = ownRoadmap(req);
  if (!rm) return res.status(404).json({ error: 'Roadmap not found.' });
  recalcProgress(rm.id);
  const fresh = db.prepare('SELECT * FROM learning_roadmaps WHERE id = ?').get(rm.id);

  const stages = db.prepare('SELECT * FROM roadmap_stages WHERE roadmap_id = ? ORDER BY stage_order').all(rm.id)
    .map(s => ({
      ...s,
      topics: db.prepare('SELECT * FROM roadmap_topics WHERE stage_id = ? ORDER BY topic_order').all(s.id)
        .map(t => ({
          ...t,
          tasks: db.prepare('SELECT * FROM roadmap_tasks WHERE topic_id = ? ORDER BY id').all(t.id),
          session_count: db.prepare('SELECT COUNT(*) AS n FROM study_sessions WHERE roadmap_topic_id = ?').get(t.id).n,
        })),
    }));
  const tools = db.prepare('SELECT * FROM roadmap_tools WHERE roadmap_id = ?').all(rm.id);
  const resources = db.prepare('SELECT * FROM roadmap_resources WHERE roadmap_id = ?').all(rm.id);
  const nextTopic = stages.flatMap(s => s.topics).find(t => t.status === 'Not Started' || t.status === 'In Progress') || null;

  res.json({
    roadmap: { ...fresh, behind_schedule: behindSchedule(fresh) },
    stages, tools, resources,
    next_topic: nextTopic ? { id: nextTopic.id, title: nextTopic.title } : null,
  });
}));

// PUT /api/roadmaps/:id — update meta (title, goal, status, deadline…)
router.put('/:id', safe((req, res) => {
  const rm = ownRoadmap(req);
  if (!rm) return res.status(404).json({ error: 'Roadmap not found.' });
  const b = req.body || {};
  if (b.status && !RM_STATUS.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
  if (b.current_level && !LEVELS.includes(b.current_level)) return res.status(400).json({ error: 'Invalid level.' });
  if (b.preferred_learning_style && !STYLES.includes(b.preferred_learning_style)) return res.status(400).json({ error: 'Invalid style.' });

  db.prepare(
    `UPDATE learning_roadmaps SET title=?, goal=?, current_level=?, preferred_learning_style=?,
       difficulty=?, duration_days=?, deadline_date=?, status=?, updated_at=? WHERE id=?`
  ).run(
    (b.title || rm.title).trim().slice(0, 100),
    b.goal !== undefined ? String(b.goal).slice(0, 300) : rm.goal,
    b.current_level || rm.current_level,
    b.preferred_learning_style || rm.preferred_learning_style,
    ['Easy', 'Moderate', 'Hard'].includes(b.difficulty) ? b.difficulty : rm.difficulty,
    b.duration_days !== undefined ? Math.max(1, Math.min(180, Number(b.duration_days) || rm.duration_days)) : rm.duration_days,
    b.deadline_date !== undefined ? (b.deadline_date || null) : rm.deadline_date,
    b.status || rm.status, nowISO(), rm.id
  );
  res.json({ ok: true });
}));

// DELETE /api/roadmaps/:id — cascades to stages/topics/tasks/resources/tools
router.delete('/:id', safe((req, res) => {
  const rm = ownRoadmap(req);
  if (!rm) return res.status(404).json({ error: 'Roadmap not found.' });
  db.prepare('DELETE FROM learning_roadmaps WHERE id = ?').run(rm.id);
  res.json({ ok: true });
}));

// POST /api/roadmaps/:id/schedule — Generate Study Schedule from Roadmap
router.post('/:id/schedule', safe((req, res) => {
  const rm = ownRoadmap(req);
  if (!rm) return res.status(404).json({ error: 'Roadmap not found.' });
  const topicId = req.body && req.body.topic_id ? Number(req.body.topic_id) : null;
  res.json(scheduleRoadmap(req.session.userId, rm, topicId));
}));

/* ---- structural editing (edit page) + status updates ---- */

// PATCH /api/roadmaps/topics/:topicId — status / rename / hours
router.patch('/topics/:topicId', safe((req, res) => {
  const t = db.prepare(
    `SELECT t.* FROM roadmap_topics t JOIN learning_roadmaps r ON r.id = t.roadmap_id
     WHERE t.id = ? AND r.user_id = ?`
  ).get(Number(req.params.topicId), req.session.userId);
  if (!t) return res.status(404).json({ error: 'Topic not found.' });
  const b = req.body || {};
  if (b.status && !ITEM_STATUS.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
  db.prepare('UPDATE roadmap_topics SET title=?, status=?, estimated_hours=?, updated_at=? WHERE id=?')
    .run(
      b.title !== undefined ? String(b.title).trim().slice(0, 150) : t.title,
      b.status || t.status,
      b.estimated_hours !== undefined ? Math.max(0.5, Number(b.estimated_hours) || t.estimated_hours) : t.estimated_hours,
      nowISO(), t.id
    );
  const pct = recalcProgress(t.roadmap_id);
  res.json({ ok: true, progress_percentage: pct });
}));

// PATCH /api/roadmaps/tasks/:taskId — status
router.patch('/tasks/:taskId', safe((req, res) => {
  const t = db.prepare(
    `SELECT t.* FROM roadmap_tasks t JOIN learning_roadmaps r ON r.id = t.roadmap_id
     WHERE t.id = ? AND r.user_id = ?`
  ).get(Number(req.params.taskId), req.session.userId);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  const { status } = req.body || {};
  if (!ITEM_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  db.prepare('UPDATE roadmap_tasks SET status=?, updated_at=? WHERE id=?').run(status, nowISO(), t.id);
  res.json({ ok: true });
}));

// POST /api/roadmaps/:id/stages — add a stage (edit page)
router.post('/:id/stages', safe((req, res) => {
  const rm = ownRoadmap(req);
  if (!rm) return res.status(404).json({ error: 'Roadmap not found.' });
  const title = (req.body && req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Stage title is required.' });
  const order = db.prepare('SELECT COALESCE(MAX(stage_order),-1)+1 AS o FROM roadmap_stages WHERE roadmap_id=?').get(rm.id).o;
  const ts = nowISO();
  const info = db.prepare(
    `INSERT INTO roadmap_stages (roadmap_id, title, description, stage_order, estimated_hours, status, created_at, updated_at)
     VALUES (?,?,?,?,0,'Not Started',?,?)`
  ).run(rm.id, title.slice(0, 100), '', order, ts, ts);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

// POST /api/roadmaps/stages/:stageId/topics — add a topic
router.post('/stages/:stageId/topics', safe((req, res) => {
  const s = db.prepare(
    `SELECT s.* FROM roadmap_stages s JOIN learning_roadmaps r ON r.id = s.roadmap_id
     WHERE s.id = ? AND r.user_id = ?`
  ).get(Number(req.params.stageId), req.session.userId);
  if (!s) return res.status(404).json({ error: 'Stage not found.' });
  const title = (req.body && req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Topic title is required.' });
  const order = db.prepare('SELECT COALESCE(MAX(topic_order),-1)+1 AS o FROM roadmap_topics WHERE stage_id=?').get(s.id).o;
  const ts = nowISO();
  const info = db.prepare(
    `INSERT INTO roadmap_topics (roadmap_id, stage_id, title, description, topic_order, estimated_hours, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'Not Started', ?, ?)`
  ).run(s.roadmap_id, s.id, title.slice(0, 150), '', order,
        Math.max(0.5, Number(req.body.hours) || 2), ts, ts);
  recalcProgress(s.roadmap_id);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

// DELETE /api/roadmaps/topics/:topicId
router.delete('/topics/:topicId', safe((req, res) => {
  const t = db.prepare(
    `SELECT t.* FROM roadmap_topics t JOIN learning_roadmaps r ON r.id = t.roadmap_id
     WHERE t.id = ? AND r.user_id = ?`
  ).get(Number(req.params.topicId), req.session.userId);
  if (!t) return res.status(404).json({ error: 'Topic not found.' });
  db.prepare('DELETE FROM roadmap_topics WHERE id = ?').run(t.id);
  recalcProgress(t.roadmap_id);
  res.json({ ok: true });
}));

// DELETE /api/roadmaps/stages/:stageId
router.delete('/stages/:stageId', safe((req, res) => {
  const s = db.prepare(
    `SELECT s.* FROM roadmap_stages s JOIN learning_roadmaps r ON r.id = s.roadmap_id
     WHERE s.id = ? AND r.user_id = ?`
  ).get(Number(req.params.stageId), req.session.userId);
  if (!s) return res.status(404).json({ error: 'Stage not found.' });
  db.prepare('DELETE FROM roadmap_stages WHERE id = ?').run(s.id);
  recalcProgress(s.roadmap_id);
  res.json({ ok: true });
}));

module.exports = router;
