/**
 * EduFlex database layer.
 *
 * Uses Node's built-in SQLite driver (node:sqlite, available in Node 22.5+)
 * so the project has ZERO native dependencies and runs anywhere Node runs.
 * The schema mirrors the PostgreSQL design in PROMPT.md and can be ported
 * to Postgres/Supabase later with minimal changes.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'eduflex.db'));

// Enforce foreign keys (off by default in SQLite)
db.exec('PRAGMA foreign_keys = ON;');
// Wait up to 5s when another process holds the write lock (e.g. the test
// runner promoting an admin while the server is running) instead of failing.
db.exec('PRAGMA busy_timeout = 5000;');

/**
 * Schema. Datetimes are stored as local "YYYY-MM-DDTHH:MM" strings
 * (matching HTML datetime-local inputs) and created_at/updated_at as ISO strings.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  public_username TEXT NOT NULL,            -- initials only, e.g. "JD"
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  institution     TEXT NOT NULL,
  programme       TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'student',
  account_status  TEXT NOT NULL DEFAULT 'active',
  last_login_at   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  code        TEXT NOT NULL,
  difficulty  TEXT NOT NULL CHECK (difficulty IN ('Easy','Moderate','Hard')),
  description TEXT DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deadlines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('Assignment','CAT/Test','Exam','Project','Presentation','Other')),
  due_date        TEXT NOT NULL,            -- "YYYY-MM-DDTHH:MM"
  priority        TEXT NOT NULL CHECK (priority IN ('Low','Medium','High')),
  estimated_hours REAL NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Completed','Missed')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_slots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  start_time      TEXT NOT NULL,            -- "HH:MM"
  end_time        TEXT NOT NULL,            -- "HH:MM"
  study_intensity TEXT NOT NULL CHECK (study_intensity IN ('Light','Normal','Deep Focus')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  deadline_id     INTEGER REFERENCES deadlines(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  start_datetime  TEXT NOT NULL,            -- "YYYY-MM-DDTHH:MM"
  end_datetime    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned','Completed','Missed','Rescheduled')),
  study_intensity TEXT NOT NULL DEFAULT 'Normal',
  notes           TEXT DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT DEFAULT '',
  course_name        TEXT NOT NULL,
  course_code        TEXT DEFAULT '',
  category           TEXT NOT NULL CHECK (category IN ('Notes','Slides','PDF','Past Paper','Assignment Guide','Other')),
  institution        TEXT NOT NULL,
  public_username    TEXT NOT NULL,         -- privacy rule: only initials shown publicly
  file_url           TEXT NOT NULL,         -- stored filename inside /uploads
  file_original_name TEXT NOT NULL,
  file_type          TEXT DEFAULT '',
  file_size          INTEGER DEFAULT 0,
  upvotes_count      INTEGER NOT NULL DEFAULT 0,
  moderation_status  TEXT NOT NULL DEFAULT 'Approved',  -- auto-approved; admins can Reject
  moderation_note    TEXT DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resource_votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, resource_id)             -- one vote per user per resource
);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id                  INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  study_session_id           INTEGER REFERENCES study_sessions(id) ON DELETE SET NULL,
  title                      TEXT NOT NULL,
  study_duration_minutes     INTEGER NOT NULL DEFAULT 25,
  break_duration_minutes     INTEGER NOT NULL DEFAULT 5,
  completed_duration_minutes INTEGER NOT NULL DEFAULT 0,
  status                     TEXT NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress','Completed','Abandoned')),
  started_at                 TEXT NOT NULL,
  completed_at               TEXT,
  created_at                 TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_courses_user       ON courses(user_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_user     ON deadlines(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_slots_user         ON availability_slots(user_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_sessions_user      ON study_sessions(user_id, start_datetime);
CREATE INDEX IF NOT EXISTS idx_resources_search   ON resources(category, institution);
CREATE INDEX IF NOT EXISTS idx_focus_user         ON focus_sessions(user_id, started_at);
`);

/* ---------------------------------------------------------------------------
 * PHASE 2 migrations — run idempotently so existing databases upgrade in place.
 * ------------------------------------------------------------------------- */

/** Add a column if the table doesn't have it yet (SQLite has no IF NOT EXISTS for columns). */
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Admin ownership + moderation
addColumnIfMissing('users', 'role', "TEXT NOT NULL DEFAULT 'student'");
addColumnIfMissing('users', 'account_status', "TEXT NOT NULL DEFAULT 'active'");
addColumnIfMissing('users', 'last_login_at', 'TEXT');
addColumnIfMissing('resources', 'moderation_status', "TEXT NOT NULL DEFAULT 'Approved'");
// One-time migration from the old pending-by-default model: uploads are
// auto-approved (instant sharing); admins moderate by rejecting/deleting.
db.exec("UPDATE resources SET moderation_status = 'Approved' WHERE moderation_status = 'Pending'");
addColumnIfMissing('resources', 'moderation_note', 'TEXT DEFAULT ""');

// Alarm reminders (sessions + deadlines)
addColumnIfMissing('study_sessions', 'reminder_enabled', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('study_sessions', 'reminder_minutes_before', 'INTEGER NOT NULL DEFAULT 15');
// Missed session recovery
addColumnIfMissing('study_sessions', 'original_session_id', 'INTEGER');
addColumnIfMissing('study_sessions', 'recovery_status', 'TEXT'); // NULL | Recovered | Ignored
addColumnIfMissing('deadlines', 'reminder_enabled', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('deadlines', 'reminder_minutes_before', 'INTEGER NOT NULL DEFAULT 1440');
// Resource quality score inputs
addColumnIfMissing('resources', 'views_count', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('resources', 'downloads_count', 'INTEGER NOT NULL DEFAULT 0');
// Peer matching + notification preferences
addColumnIfMissing('users', 'peer_matching_enabled', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'notification_preferences', "TEXT NOT NULL DEFAULT '{}'");
// Offline focus sync
addColumnIfMissing('focus_sessions', 'synced', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('focus_sessions', 'offline_created', 'INTEGER NOT NULL DEFAULT 0');
// Smart Learning Roadmap links on study sessions
addColumnIfMissing('study_sessions', 'roadmap_id', 'INTEGER');
addColumnIfMissing('study_sessions', 'roadmap_topic_id', 'INTEGER');
addColumnIfMissing('study_sessions', 'roadmap_task_id', 'INTEGER');

// Peer study tables
db.exec(`
CREATE TABLE IF NOT EXISTS study_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_name      TEXT DEFAULT '',
  message          TEXT DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Accepted','Declined')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  course_name TEXT DEFAULT '',
  institution TEXT DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_group_members (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id  INTEGER NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_requests_receiver ON study_requests(receiver_user_id, status);
CREATE INDEX IF NOT EXISTS idx_members_group     ON study_group_members(group_id);

-- ==================== Smart Learning Roadmap ====================

CREATE TABLE IF NOT EXISTS learning_roadmaps (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id                INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  deadline_id              INTEGER REFERENCES deadlines(id) ON DELETE SET NULL,
  title                    TEXT NOT NULL,
  course_name              TEXT NOT NULL,
  course_code              TEXT DEFAULT '',
  goal                     TEXT DEFAULT '',
  current_level            TEXT NOT NULL DEFAULT 'Beginner' CHECK (current_level IN ('Beginner','Intermediate','Advanced')),
  target_level             TEXT DEFAULT '',
  preferred_learning_style TEXT NOT NULL DEFAULT 'Mixed'
                           CHECK (preferred_learning_style IN ('Theory-based','Practical','Project-based','Exam-focused','Mixed')),
  difficulty               TEXT NOT NULL DEFAULT 'Moderate' CHECK (difficulty IN ('Easy','Moderate','Hard')),
  duration_days            INTEGER NOT NULL DEFAULT 14,
  deadline_date            TEXT,
  status                   TEXT NOT NULL DEFAULT 'Not Started'
                           CHECK (status IN ('Not Started','In Progress','Completed','Paused')),
  progress_percentage      INTEGER NOT NULL DEFAULT 0,
  source                   TEXT DEFAULT 'custom',        -- template | custom
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmap_stages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id      INTEGER NOT NULL REFERENCES learning_roadmaps(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  stage_order     INTEGER NOT NULL DEFAULT 0,
  estimated_hours REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'Not Started'
                  CHECK (status IN ('Not Started','In Progress','Completed','Skipped')),
  start_date      TEXT,
  end_date        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmap_topics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id      INTEGER NOT NULL REFERENCES learning_roadmaps(id) ON DELETE CASCADE,
  stage_id        INTEGER NOT NULL REFERENCES roadmap_stages(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  topic_order     INTEGER NOT NULL DEFAULT 0,
  estimated_hours REAL NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'Not Started'
                  CHECK (status IN ('Not Started','In Progress','Completed','Skipped')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmap_tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id        INTEGER NOT NULL REFERENCES learning_roadmaps(id) ON DELETE CASCADE,
  stage_id          INTEGER REFERENCES roadmap_stages(id) ON DELETE CASCADE,
  topic_id          INTEGER REFERENCES roadmap_topics(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT DEFAULT '',
  task_type         TEXT NOT NULL DEFAULT 'Practice'
                    CHECK (task_type IN ('Practice','Mini-project','Checkpoint','Reading')),
  estimated_minutes INTEGER NOT NULL DEFAULT 30,
  status            TEXT NOT NULL DEFAULT 'Not Started'
                    CHECK (status IN ('Not Started','In Progress','Completed','Skipped')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmap_resources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id     INTEGER NOT NULL REFERENCES learning_roadmaps(id) ON DELETE CASCADE,
  stage_id       INTEGER REFERENCES roadmap_stages(id) ON DELETE CASCADE,
  topic_id       INTEGER REFERENCES roadmap_topics(id) ON DELETE CASCADE,
  resource_id    INTEGER REFERENCES resources(id) ON DELETE CASCADE,  -- internal library match
  resource_title TEXT NOT NULL,
  resource_type  TEXT DEFAULT '',
  resource_url   TEXT DEFAULT '',
  source_type    TEXT NOT NULL DEFAULT 'suggested',  -- library | suggested
  quality_score  INTEGER DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmap_tools (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id  INTEGER NOT NULL REFERENCES learning_roadmaps(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  purpose     TEXT DEFAULT '',
  category    TEXT DEFAULT '',
  is_required INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_roadmaps_user   ON learning_roadmaps(user_id, status);
CREATE INDEX IF NOT EXISTS idx_rtopics_roadmap ON roadmap_topics(roadmap_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_rtasks_topic    ON roadmap_tasks(topic_id);
`);

/** Current timestamp as ISO string (for created_at / updated_at). */
function nowISO() {
  return new Date().toISOString();
}

/** Format a Date as local "YYYY-MM-DDTHH:MM" (matches datetime-local inputs). */
function fmtLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Generate the public username from initials, e.g. John Doe -> "JD". */
function makePublicUsername(firstName, lastName) {
  const a = (firstName || '').trim().charAt(0).toUpperCase();
  const b = (lastName || '').trim().charAt(0).toUpperCase();
  return `${a}${b}`;
}

module.exports = { db, nowISO, fmtLocal, makePublicUsername };
