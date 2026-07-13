/** Availability slot CRUD — feeds the adaptive scheduling engine. */
const express = require('express');
const { db, nowISO } = require('../db');
const { requireAuth, safe } = require('../middleware');

const router = express.Router();
router.use(requireAuth);

const INTENSITIES = ['Light', 'Normal', 'Deep Focus'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate({ day_of_week, start_time, end_time, study_intensity }) {
  const d = Number(day_of_week);
  if (!Number.isInteger(d) || d < 0 || d > 6) return 'Day of week must be 0 (Sunday) to 6 (Saturday).';
  if (!TIME_RE.test(start_time || '')) return 'Start time must be HH:MM.';
  if (!TIME_RE.test(end_time || '')) return 'End time must be HH:MM.';
  if (end_time <= start_time) return 'End time must be after start time.';
  if (!INTENSITIES.includes(study_intensity)) return 'Invalid study intensity.';
  return null;
}

// GET /api/availability
router.get('/', safe((req, res) => {
  const slots = db.prepare(
    'SELECT * FROM availability_slots WHERE user_id = ? ORDER BY day_of_week, start_time'
  ).all(req.session.userId);
  res.json({ slots });
}));

// POST /api/availability
router.post('/', safe((req, res) => {
  const err = validate(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const { day_of_week, start_time, end_time, study_intensity } = req.body;
  const ts = nowISO();
  const info = db.prepare(
    `INSERT INTO availability_slots (user_id, day_of_week, start_time, end_time, study_intensity, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(req.session.userId, Number(day_of_week), start_time, end_time, study_intensity, ts, ts);
  res.status(201).json({ slot: db.prepare('SELECT * FROM availability_slots WHERE id = ?').get(Number(info.lastInsertRowid)) });
}));

// PUT /api/availability/:id
router.put('/:id', safe((req, res) => {
  const slot = db.prepare('SELECT * FROM availability_slots WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.session.userId);
  if (!slot) return res.status(404).json({ error: 'Slot not found.' });

  const merged = {
    day_of_week: req.body.day_of_week !== undefined ? req.body.day_of_week : slot.day_of_week,
    start_time: req.body.start_time || slot.start_time,
    end_time: req.body.end_time || slot.end_time,
    study_intensity: req.body.study_intensity || slot.study_intensity,
  };
  const err = validate(merged);
  if (err) return res.status(400).json({ error: err });

  db.prepare('UPDATE availability_slots SET day_of_week=?, start_time=?, end_time=?, study_intensity=?, updated_at=? WHERE id=?')
    .run(Number(merged.day_of_week), merged.start_time, merged.end_time, merged.study_intensity, nowISO(), slot.id);
  res.json({ slot: db.prepare('SELECT * FROM availability_slots WHERE id = ?').get(slot.id) });
}));

// DELETE /api/availability/:id
router.delete('/:id', safe((req, res) => {
  const info = db.prepare('DELETE FROM availability_slots WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.session.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Slot not found.' });
  res.json({ ok: true });
}));

module.exports = router;
