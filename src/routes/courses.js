/** Course CRUD — users can only touch their own courses (ownership enforced in every query). */
const express = require('express');
const { db, nowISO } = require('../db');
const { requireAuth, safe } = require('../middleware');

const router = express.Router();
router.use(requireAuth);

const DIFFICULTIES = ['Easy', 'Moderate', 'Hard'];

// GET /api/courses
router.get('/', safe((req, res) => {
  const courses = db.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM deadlines d WHERE d.course_id = c.id AND d.status = 'Pending') AS pending_deadlines
     FROM courses c WHERE c.user_id = ? ORDER BY c.created_at DESC`
  ).all(req.session.userId);
  res.json({ courses });
}));

// POST /api/courses
router.post('/', safe((req, res) => {
  const { title, code, difficulty, description } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Course title is required.' });
  if (!code || !code.trim()) return res.status(400).json({ error: 'Course code is required.' });
  if (!DIFFICULTIES.includes(difficulty)) return res.status(400).json({ error: 'Difficulty must be Easy, Moderate or Hard.' });

  const ts = nowISO();
  const info = db.prepare(
    'INSERT INTO courses (user_id, title, code, difficulty, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run(req.session.userId, title.trim(), code.trim().toUpperCase(), difficulty, (description || '').trim(), ts, ts);
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ course });
}));

// PUT /api/courses/:id
router.put('/:id', safe((req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.session.userId);
  if (!course) return res.status(404).json({ error: 'Course not found.' });

  const { title, code, difficulty, description } = req.body || {};
  if (difficulty && !DIFFICULTIES.includes(difficulty)) return res.status(400).json({ error: 'Invalid difficulty.' });

  db.prepare('UPDATE courses SET title=?, code=?, difficulty=?, description=?, updated_at=? WHERE id=?')
    .run(
      (title || course.title).trim(),
      (code || course.code).trim().toUpperCase(),
      difficulty || course.difficulty,
      description !== undefined ? String(description).trim() : course.description,
      nowISO(), course.id
    );
  res.json({ course: db.prepare('SELECT * FROM courses WHERE id = ?').get(course.id) });
}));

// DELETE /api/courses/:id — cascades to deadlines & sessions of this course
router.delete('/:id', safe((req, res) => {
  const info = db.prepare('DELETE FROM courses WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.session.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Course not found.' });
  res.json({ ok: true });
}));

module.exports = router;
