/**
 * Resource library: upload, browse/search/filter, download, upvote toggle.
 *
 * PRIVACY RULE (PROMPT.md §10/§13): resource listings expose ONLY the
 * contributor's public username initials + institution — never first_name
 * or last_name. The SELECT below never joins user names into results.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, nowISO, UPLOAD_DIR } = require('../db');
const { requireAuth, isPlus, safe } = require('../middleware');
const { qualityScore } = require('../services/quality');

const router = express.Router();
router.use(requireAuth);


const CATEGORIES = ['Notes', 'Slides', 'PDF', 'Past Paper', 'Assignment Guide', 'Other'];
// PDF only: guarantees every resource can be viewed in the browser AND downloaded.
const ALLOWED_EXT = ['.pdf'];

// Uploads are kept in memory, then stored in the resource_files table (backed up with
// the rest of the database) and only served through the authenticated routes below.
// file_url = FILE_IN_DB marks those; older uploads may still be files in UPLOAD_DIR.
const FILE_IN_DB = 'db';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB cap
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return cb(new Error('Only PDF files are allowed, so every resource can be viewed in the browser.'));
    cb(null, true);
  },
});

// GET /api/resources?search=&category=&institution=&course=&sort=recent|top|quality&mine=1&top_quality=1
router.get('/', safe((req, res) => {
  const { search, category, institution, course, sort, mine, top_quality } = req.query;
  // Premium: the quality filter and quality ranking are EduFlex Plus features
  if ((top_quality === '1' || sort === 'quality') && !isPlus(req.session.userId)) {
    return res.status(402).json({ error: 'Quality filters are an EduFlex Plus feature.', premium: true });
  }
  let sql =
    `SELECT r.id, r.title, r.description, r.course_name, r.course_code, r.category,
            r.institution, r.public_username, r.file_original_name, r.file_type,
            r.file_size, r.upvotes_count, r.views_count, r.downloads_count,
            r.created_at, r.user_id,
            EXISTS(SELECT 1 FROM resource_votes v WHERE v.resource_id = r.id AND v.user_id = ?) AS voted_by_me
     FROM resources r
     WHERE (r.moderation_status = 'Approved' OR r.user_id = ?)`; // owners always see their own uploads
  const params = [req.session.userId, req.session.userId];

  if (mine === '1') { sql += ' AND r.user_id = ?'; params.push(req.session.userId); }
  if (search) {
    sql += ` AND (r.title LIKE ? OR r.course_name LIKE ? OR r.course_code LIKE ? OR r.institution LIKE ? OR r.category LIKE ?)`;
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (category) { sql += ' AND r.category = ?'; params.push(category); }
  if (institution) { sql += ' AND r.institution LIKE ?'; params.push(`%${institution}%`); }
  if (course) { sql += ' AND (r.course_name LIKE ? OR r.course_code LIKE ?)'; params.push(`%${course}%`, `%${course}%`); }

  sql += sort === 'top' ? ' ORDER BY r.upvotes_count DESC, r.created_at DESC'
                        : ' ORDER BY r.created_at DESC';

  // Quality score is computed live so it always reflects current votes/views
  const viewer = db.prepare('SELECT institution FROM users WHERE id = ?').get(req.session.userId);
  let rows = db.prepare(sql).all(...params).map(r => {
    const q = qualityScore(r, viewer?.institution);
    return {
      ...r,
      is_owner: r.user_id === req.session.userId,
      user_id: undefined, // don't leak internal owner ids to other users
      quality_score: q.score,
      quality_label: q.label,
    };
  });
  if (top_quality === '1') rows = rows.filter(r => r.quality_score >= 80);
  if (sort === 'quality') rows.sort((a, b) => b.quality_score - a.quality_score);
  res.json({ resources: rows });
}));

// GET /api/resources/institutions — distinct institutions for the filter dropdown
router.get('/institutions', safe((req, res) => {
  const rows = db.prepare('SELECT DISTINCT institution FROM resources ORDER BY institution').all();
  res.json({ institutions: rows.map(r => r.institution) });
}));

// POST /api/resources — upload (multipart form)
router.post('/', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    try {
      const { title, description, course_name, course_code, category } = req.body || {};
      if (!req.file) return res.status(400).json({ error: 'A file is required.' });
      if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required.' });
      if (!course_name || !course_name.trim()) return res.status(400).json({ error: 'Course name is required.' });
      if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });

      // Contributor is shown by initials + institution only (privacy rule)
      const user = db.prepare('SELECT public_username, institution FROM users WHERE id = ?')
        .get(req.session.userId);
      const ts = nowISO();
      let id;
      db.exec('BEGIN');
      try {
        id = Number(db.prepare(
          `INSERT INTO resources (user_id, title, description, course_name, course_code, category,
                                  institution, public_username, file_url, file_original_name,
                                  file_type, file_size, upvotes_count, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`
        ).run(
          req.session.userId, title.trim(), (description || '').trim(),
          course_name.trim(), (course_code || '').trim().toUpperCase(), category,
          user.institution, user.public_username,
          FILE_IN_DB, req.file.originalname,
          path.extname(req.file.originalname).slice(1).toLowerCase(), req.file.size,
          ts, ts
        ).lastInsertRowid);
        db.prepare('INSERT INTO resource_files (resource_id, data) VALUES (?, ?)').run(id, req.file.buffer);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      res.status(201).json({ id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

/** A resource the current user may open: approved, or their own upload (rejected files stay hidden). */
function visibleResource(req) {
  return db.prepare(
    `SELECT * FROM resources WHERE id = ? AND (moderation_status = 'Approved' OR user_id = ?)`
  ).get(Number(req.params.id), req.session.userId);
}

/** The stored file: { data } from the database, or { filePath } for older uploads on disk; null if gone. */
function loadFile(r) {
  if (r.file_url === FILE_IN_DB) {
    const row = db.prepare('SELECT data FROM resource_files WHERE resource_id = ?').get(r.id);
    return row ? { data: Buffer.from(row.data) } : null;
  }
  const filePath = path.join(UPLOAD_DIR, path.basename(r.file_url)); // basename() blocks path traversal
  return fs.existsSync(filePath) ? { filePath } : null;
}

const safeFilename = (name) => name.replace(/[^\w.\- ]/g, '_');

// GET /api/resources/:id/download — authenticated download (files are not public)
router.get('/:id/download', safe((req, res) => {
  const r = visibleResource(req);
  if (!r) return res.status(404).json({ error: 'Resource not found.' });
  const file = loadFile(r);
  if (!file) return res.status(410).json({ error: 'File no longer available.' });
  db.prepare('UPDATE resources SET downloads_count = downloads_count + 1 WHERE id = ?').run(r.id);
  if (file.filePath) return res.download(file.filePath, r.file_original_name);
  res.attachment(safeFilename(r.file_original_name));
  res.type(r.file_type || 'application/octet-stream');
  res.end(file.data);
}));

// Types the browser can render inline; anything else falls back to download.
const INLINE_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
};

// GET /api/resources/:id/view — open the file in the browser (new tab) instead of downloading
router.get('/:id/view', safe((req, res) => {
  const r = visibleResource(req);
  if (!r) return res.status(404).json({ error: 'Resource not found.' });
  const file = loadFile(r);
  if (!file) return res.status(410).json({ error: 'File no longer available.' });
  db.prepare('UPDATE resources SET views_count = views_count + 1 WHERE id = ?').run(r.id);

  const mime = INLINE_TYPES[(r.file_type || '').toLowerCase()];
  if (!mime) { // e.g. docx/pptx/zip → download
    if (file.filePath) return res.download(file.filePath, r.file_original_name);
    res.attachment(safeFilename(r.file_original_name));
    return res.end(file.data);
  }

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename(r.file_original_name)}"`);
  if (file.filePath) return fs.createReadStream(file.filePath).pipe(res);
  res.end(file.data);
}));

// POST /api/resources/:id/vote — toggle upvote (one per user, enforced by UNIQUE constraint)
router.post('/:id/vote', safe((req, res) => {
  const r = db.prepare('SELECT id FROM resources WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Resource not found.' });

  const existing = db.prepare('SELECT id FROM resource_votes WHERE user_id = ? AND resource_id = ?')
    .get(req.session.userId, r.id);
  if (existing) {
    db.prepare('DELETE FROM resource_votes WHERE id = ?').run(existing.id);
    db.prepare('UPDATE resources SET upvotes_count = upvotes_count - 1 WHERE id = ?').run(r.id);
  } else {
    db.prepare('INSERT INTO resource_votes (user_id, resource_id, created_at) VALUES (?,?,?)')
      .run(req.session.userId, r.id, nowISO());
    db.prepare('UPDATE resources SET upvotes_count = upvotes_count + 1 WHERE id = ?').run(r.id);
  }
  const updated = db.prepare('SELECT upvotes_count FROM resources WHERE id = ?').get(r.id);
  res.json({ upvotes_count: updated.upvotes_count, voted: !existing });
}));

// DELETE /api/resources/:id — owner only; removes the stored file too
router.delete('/:id', safe((req, res) => {
  const r = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.session.userId);
  if (!r) return res.status(404).json({ error: 'Resource not found (or not yours).' });
  db.prepare('DELETE FROM resources WHERE id = ?').run(r.id); // cascades to resource_files
  if (r.file_url !== FILE_IN_DB) {
    const filePath = path.join(UPLOAD_DIR, path.basename(r.file_url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  res.json({ ok: true });
}));

module.exports = router;
