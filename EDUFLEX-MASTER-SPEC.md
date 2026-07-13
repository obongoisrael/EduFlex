# EduFlex — Master Project Document

**EduFlex: Adaptive Learning and Resource Management System for Colleges and Universities**

This is the single source of truth for the entire EduFlex project — every feature, decision, and requirement we agreed on across all build phases. Use this document to rebuild or extend the system.

---

## 1. Project Overview

EduFlex helps college and university students:
- Manage academic study schedules
- Organize deadlines
- Track study progress
- Use focus-based study sessions (Pomodoro)
- Share academic resources (notes, slides, PDFs, past papers)
- Follow structured learning roadmaps
- Get smart, adaptive guidance (risk warnings, recommendations, insights)

**Design principles:** modern, responsive (mobile-first — used mainly on phones, must also fit tablets, laptops, desktops), secure, student-friendly, privacy-aware, polished enough for a university project demonstration.

---

## 2. Tech Stack (as decided during the build)

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | Simple, well-known |
| Database | SQLite via Node's built-in `node:sqlite` | Zero native dependencies, runs anywhere Node 22.5+ runs; schema is PostgreSQL-portable |
| Auth | express-session + bcryptjs, sessions persisted in a SQLite table (survive server restarts) | httpOnly cookie, 7-day lifetime |
| Uploads | multer 2.x → `/uploads` folder, random filenames | Served ONLY through authenticated endpoints |
| Frontend | Vanilla JS single-page app (hash routing) + Tailwind CSS (CDN) + Inter font | No build step |
| Offline | Service worker (app-shell cache) + localStorage snapshots | |
| Server | Port 3000; `npm start`; static served with `Cache-Control: no-cache` so updates always load; request logger prints every API call `time METHOD path → status (ms)` | |

Project folder: `eduflex/` with `server.js`, `src/` (db.js, seed.js, scheduler.js, middleware.js, sessionStore.js, routes/, services/), `public/` (html, js/views/), `tests/api.test.js`, `data/` (eduflex.db), `uploads/`.

Demo account seeded on first run: **demo@eduflex.app / demo1234** (Jane Smith "JS", Kenyatta University) plus 2 peer users (AK, MO), 4 courses, 5 deadlines, 6 availability slots, sample sessions, focus history, and 5 shared PDF resources with upvotes. Reset by deleting `data/eduflex.db`.

---

## 3. Phase 1 — Core System

### 3.1 Authentication & User Management
- Register: first name, last name, email, password (min 6), institution, programme.
- **Public username auto-generated from initials** (John Doe → "JD"). Full name stored privately.
- **PRIVACY RULE (applies everywhere):** public areas show ONLY initials + institution. Full names never appear in resource sharing or peer features. (Admins may see full names inside the protected admin dashboard only.)
- Login / logout / profile management (name change regenerates initials; optional password change; email immutable).
- On ANY auth failure the app redirects to login — never a blank screen. Registration redirects into the Setup Wizard.

### 3.2 Student Dashboard
Welcome banner (name, initials, institution, programme, weekly % complete, streak), quick actions (Add Course, Add Deadline, Add Availability, Generate Schedule, Upload Resource, Start Focus Mode), stat cards (courses, upcoming deadlines, today's sessions, hours studied this week), upcoming deadlines list, today's sessions, weekly progress bar, recently shared resources. Phase-2 cards listed in §4. Keep it **compact and scannable** — short rows, not paragraphs (full explanations live on Smart Insights).

### 3.3 Courses
CRUD: title, code (auto-uppercased), difficulty (Easy/Moderate/Hard), description. Card grid with pending-deadline counts.

### 3.4 Deadlines
CRUD: course, title, type (Assignment / CAT-Test / Exam / Project / Presentation / Other), due datetime, priority (Low/Medium/High), estimated study hours, status (Pending/Completed/Missed). Listed by urgency (closest due first). Smart default hours by type: Exam 8, Project 10, CAT 4, Assignment 3, Presentation 2, Other 2 (follows type until user edits). Reminder toggle (1 day / 1 hour before).

### 3.5 Availability Slots
CRUD: day of week, start/end time, intensity (Light / Normal / Deep Focus). Weekly grid display Mon–Sun.
**One-click presets:** 🌆 Weekday evenings (Mon–Fri 19:00–21:00 Normal) · 🌤️ Weekend mornings (Sat+Sun 09:00–12:00 Deep Focus) · 🌅 Early bird (Mon–Fri 06:00–08:00 Deep Focus).

### 3.6 Adaptive Scheduling Engine (`src/scheduler.js`)
Generates study sessions from availability + deadlines + course difficulty:
- Closest deadlines first; priority breaks ties (High grabs the earliest slots).
- Hard courses get longer chunks: max session Hard 2h, Moderate 1.5h, Easy 1h; min chunk 0.5h.
- Sessions only inside availability windows, never in the past, never after the deadline, never overlapping existing sessions (busy windows are subtracted).
- Big estimates split into chunks; accounts for hours already planned/completed per deadline (idempotent regeneration).
- Horizon: up to 28 days. Reports honestly when hours can't fit ("Not enough free time before X — add availability").
- **Auto-regenerate:** silently reruns after adding/editing a deadline or availability slot; toasts when new sessions appear.

### 3.7 Calendar
Month / week / day views. Colors: Planned=blue, Completed=green, Missed=red, Rescheduled=purple. Today highlighted. Click session → modal: details, mark completed/missed, reschedule (datetime inputs), delete, reminder toggle + time (at start/5/15/30/60 min). 🔔 shown on chips with reminders. Missed sessions link to recovery.

### 3.8 Focus Mode
Pomodoro timer: title, optional course, optional link to today's session, study/break durations (default 25/5; presets 25/5, 50/10, 90/15). Start/Pause/Resume/End; auto-switches study↔break with toasts. On end: saves minutes, updates weekly progress, offers to mark linked session completed. Timer survives navigation within the app. **Works fully offline** (see §4.6). Prefillable from a roadmap topic.

### 3.9 Progress Tracking
Totals (completed/planned/missed sessions), completion % ring (SVG), studied-this-week hours, total focus minutes, hours-per-day bar chart (last 7 days), per-course progress bars, plus Phase-2 weekly insight banner, risk-by-deadline list, courses needing attention.

### 3.10 Resource Library
Upload/browse/search/filter/upvote academic resources.
- **PDF-only uploads** (so every resource is viewable in-browser AND downloadable); 20 MB cap; random stored filenames; client + server validation with a friendly "convert to PDF" hint.
- Fields: title, description, course name/code, category (Notes/Slides/PDF/Past Paper/Assignment Guide/Other), institution, contributor initials, upload date, upvotes, views_count, downloads_count.
- Actions per card: ▲ upvote (toggle, one per user), 👁 View (inline in new tab), ⬇ Download, delete (owner only).
- Search across title/course/code/institution/category; filters: category, institution, course, mine-only, **⭐ Highly recommended only (quality ≥ 80)**; sort: most recent / most upvoted / **highest quality**.
- Quality score badge on every card (§4.9). Smart recommendations strip at top (§4.3).
- Files served only via authenticated `/api/resources/:id/view` (inline; counts a view) and `/:id/download` (counts a download). No static /uploads.

### 3.11 Landing / Auth pages
Landing page: hero ("Study smarter with adaptive planning"), tagline: *"An adaptive learning and resource management system that helps college and university students plan study time, manage academic deadlines, stay focused, and access shared learning resources."*, 6 key-feature cards, how-it-works (4 steps), benefits list, CTA panel, footer. Login + Register pages (register shows live initials preview).

---

## 4. Phase 2 — Nine Smart Features

### 4.1 Academic Risk Prediction (`services/risk.js`)
Per pending deadline, score 0–100 from: remaining hours vs free availability before due (ratio ×35, max 50), days left (≤2 → +20, ≤5 → +10), missed sessions (+5 each, max 15), rescheduling (+2 each, max 6), priority (High +8/Med +4), difficulty (Hard +8/Mod +4), minus progress (≥80% done −20, ≥50% −10). Levels: ≥65 High (red), ≥35 Medium (amber), else Low (green). Human-readable reason text (e.g. *"Database Systems CAT is due in 2 days. You have completed only 2 of 8 required study hours and missed 2 sessions. EduFlex recommends scheduling extra focus time."*). Shown compactly on Dashboard ("Needs your attention" rows with mini progress bars), fully on Smart Insights, and on Progress.

### 4.2 Smart Study Recommendation Engine (`services/recommend.js`)
Suggests what to study next: course, duration (Hard 120 / Moderate 90 / Easy 60 min, capped by window and remaining hours), a real future slot inside availability, reason sentence, related deadline, one-click "Add to schedule". Highest risk first; never in the past; prompts to add availability if none. Auto-shown on dashboard; "✨ Generate Smart Recommendation" button on Smart Insights; panel on Schedule page.

### 4.3 Smart Resource Recommendations
Matches library resources to the student's courses (exact code +40, token overlap up to +30), upcoming deadline types (CAT/Exam→Past Paper+Notes, Assignment→Assignment Guide+Notes, Project→Guide+Slides, Presentation→Slides+Notes, +15), institution (+5), own uploads deprioritized; ranked with quality score. Shown on Dashboard (3) and Resource Library strip.

### 4.4 Missed Session Recovery (`services/recovery.js`)
Detects missed sessions (recovery_status NULL), proposes up to 3 future free slots (next 7 days). Accept / custom time / ignore. Acceptance creates a new session marked **Rescheduled** with `original_session_id` link; original marked Recovered. Alerts on Dashboard + Schedule page; hint in the calendar's missed-session modal.

### 4.5 Weekly Progress Insights (`services/insights.js`)
Week = Mon–Sun. Computes planned vs completed hours/sessions, missed count, completion %, focus sessions + minutes, most/least studied course, courses needing attention (<50% completion), best study day (last 28 days), study streak (consecutive days with completed study/focus; today doesn't break it). Produces insight text + a suggestion. Shown on Dashboard (compact chips + one tip), Progress (gradient banner), Smart Insights.

### 4.6 Offline-Friendly Study Plan
Service worker caches the app shell (network-first, cache fallback, versioned `eduflex-shell-vN`); today's plan + active roadmaps cached to localStorage on dashboard load; amber offline banner (online/offline events); offline dashboard renders the cached plan; **focus timer works offline** — completed sessions queue in `ef_focus_queue` and sync via `POST /api/focus/sync` on reconnect (toast confirms); uploads blocked offline with a clear message; profile shows sync status.

### 4.7 Alarm Reminders
Per-session and per-deadline reminder toggle + lead time (0/5/15/30/60 min; deadlines 60/1440). `GET /api/smart/reminders` lists upcoming (3 days). Client polls every 30s: fires browser Notification (if permitted — permission requested politely only on user action) + WebAudio beep (sound preference) + in-app modal with **Snooze 5/10/15 min** and Dismiss (state in localStorage). Dashboard shows upcoming reminders + "Enable browser notifications" button. Preferences (browser/sound) stored per user in `notification_preferences` JSON.

### 4.8 Peer Study Matching (privacy-aware)
**Opt-in** ("Allow Peer Study Matching", off by default; toggle on Peer Study page + Profile). Matching: shared course codes (exact) or title token overlap — courses AND roadmap subjects count; same institution bonus; overlapping availability (same weekday, time overlap) shown as common slot; match reason text. Cards show **initials + institution only — never names or emails**. Study requests: send (with course + message ≤300 chars, no duplicate pending), receiver accepts/declines; visible only to sender + receiver. Study groups: create (creator = owner-member), join/leave (empty groups auto-delete), members shown as initials avatars. Tables: study_requests, study_groups, study_group_members.

### 4.9 Resource Quality Score (`services/quality.js`)
0–100: upvotes ×8 (max 30) + (views+downloads) ×2 (max 20) + metadata completeness (title ≥8 chars 6, description ≥20 chars 8, code 6, category 5, institution 5 = max 30) + recency (≤30d 15, ≤90d 10, ≤1y 6, older 2 — unless ≥3 upvotes then 6) + same-institution +5 (highlight, never dominant). Labels: 80–100 **Highly Recommended**, 60–79 Good Resource, 40–59 Average, <40 Low Confidence. Badge `⭐ 87% · Highly Recommended` everywhere resources appear.

**New pages Phase 2:** 💡 Smart Insights (weekly banner + full risk cards + recommendations with Generate button) and 🤝 Peer Study. Sidebar order: Dashboard, Courses, Deadlines, Availability, Schedule, Calendar, Roadmaps, Smart Insights, Focus Mode, Resources, Peer Study, Progress, Profile, (Admin), Logout.

---

## 5. Onboarding Efficiency Features

1. **Setup Wizard** (`#/setup`, auto after registration; green dashboard banner if 0 courses): Step 1 rapid-add courses (Enter to add) → Step 2 add deadlines (smart default hours) → Step 3 availability presets or custom → **"⚡ Finish & generate my schedule"** auto-generates and lands on a live dashboard. Skippable; progress dots with checkmarks.
2. **Availability presets** (see §3.5) on wizard + Availability page.
3. **Auto-regenerate** (see §3.6).
4. **Smart default hours** (see §3.4).

---

## 6. Smart Learning Roadmap

Student enters a course/unit/topic → structured learning roadmap.

**Pages:** `#/roadmaps` (cards: progress %, course, current stage, next topic, deadline, status, ⚠ behind-schedule) · `#/roadmaps/new` (form → generate → **editable preview** → save) · `#/roadmaps/:id` (detail) · `#/roadmaps/:id/edit`.

**Form:** course/unit name (datalist of own courses), code, link existing course, connect to a deadline, current level (Beginner/Intermediate/Advanced), learning style (Theory-based/Practical/Project-based/Exam-focused/Mixed), difficulty, duration days, optional deadline date, preferred resource type, target goal.

**Hybrid generation** (`services/roadmapTemplates.js`):
1. Templates for: Database Systems, Web Development, Programming Fundamentals, Software Engineering, Data Structures & Algorithms, Networking, Research Methods, Cybersecurity — each with 3 stages × ~3 topics × tasks (Practice/Mini-project/Checkpoint/Reading with minutes) + tools (with purpose/category/required).
2. Custom fallback for any other subject: Foundations (skipped for Advanced) → Core Concepts → Applied Practice (for Practical/Project/Mixed) → Revision & Self-Assessment (for Exam/Theory/Mixed), topics templated on the subject name.
3. Topic hours scaled to duration (≈1h/day, clamped 8–60h total).
4. Preview fully editable before saving (rename/remove/add stages & topics, adjust hours).

**Detail page:** header (badges, goal, status select, progress bar, behind-schedule warning), **⚡ Generate Study Schedule from Roadmap**, Edit, Delete; "Recommended next" topic card with 🗓 Schedule this topic + 🎯 Start focus session; tools chips; **vertical stage timeline** (numbered circles, ✓ when complete) with topic checklists (mark complete/skip, hours, session count, per-topic schedule/focus buttons) and task checkboxes; stored recommended resources with quality badges + view/download.

**Scheduling from roadmap:** pending topics (in stage/topic order) → sessions ≤2h inside availability, respecting roadmap deadline, never past, titled `🗺️ CODE: topic`, linked via roadmap_id + roadmap_topic_id.

**Progress loop:** completing a linked session → topic In Progress/Completed (when completed hours ≥ estimate) → roadmap % (hour-weighted, Skipped excluded) and stage statuses recalculated. Manual mark-complete too. Statuses: roadmap Not Started/In Progress/Completed/Paused; stage/topic/task + Skipped.

**Integrations:** courses (link or auto-create), deadlines, calendar, focus prefill, resource matching at save (top 5 library matches stored in roadmap_resources), behind-schedule risk (expected-vs-actual > 15 pts), peer matching includes roadmap subjects, dashboard active-roadmap card, offline cache, reminders (roadmap sessions are normal sessions).

---

## 7. Admin Ownership & Management Module

**RBAC:** users.role ('student' default | 'admin'), users.account_status ('active' | 'inactive'), users.last_login_at. Middleware: `requireAuth` (also blocks inactive accounts) and `requireAdmin` (role must be admin).

**Admin API (all behind requireAdmin):**
`GET /api/admin/stats` (total users, active users, resources, courses, study sessions, recent registrations, recent uploads, moderation list) · `GET /api/admin/users` (search by email/institution/programme) · `GET /api/admin/users/:id` · `PATCH /api/admin/users/:id/status` · `PATCH /api/admin/users/:id/role` · `DELETE /api/admin/users/:id` · `GET /api/admin/resources` · `PATCH /api/admin/resources/:id/approve` · `PATCH /api/admin/resources/:id/reject` · `DELETE /api/admin/resources/:id` · `GET /api/admin/courses` · `GET /api/admin/study-sessions` · `GET /api/admin/reports`.

**Admin pages** (`#/admin/dashboard`, `/users`, `/resources`, `/courses`, `/reports`, `/settings`): stats overview, user management (view/search/activate/deactivate/promote/demote/delete), resource moderation (approve/reject/delete), courses + sessions overview, reports.

**Rules:** students blocked from admin pages/APIs (client hides the 🛡️ Admin nav item unless role=admin; server enforces). Admins may see full names ONLY inside the admin dashboard. Admins can't demote/deactivate/delete themselves. First admin: register normally, then `UPDATE users SET role='admin' WHERE email='...';` (documented; helper script ok).

---

## 8. UI / Design Requirements (final direction)

- **Mobile-first**: primary target is phones; must scale to tablets, laptops, desktops. Bottom-friendly tap targets, large touch buttons, single-column layouts on small screens, grids expanding at sm/lg breakpoints. Sidebar: slide-in drawer with backdrop on mobile (hamburger), fixed on lg+.
- **Theme:** dark navy sidebar (slate-900, white text, blue-500 active pill, red-400 logout) + light content area (slate-50 bg, white rounded-2xl cards, blue-600 primary). Status colors always meaningful: green success/completed, red missed/High risk, amber Medium risk/pending, purple rescheduled/recovery, blue planned.
- **User feedback wanted MORE visual appeal:** richer gradients on hero/summary cards, better button styling (rounded-xl, shadows, hover transitions, consistent sizing), polished responsive buttons.
- Keep dashboards **scannable**: compact rows with badges and mini progress bars, not paragraphs.
- Components: cards, modals (max-h-90vh scrollable), toasts (bottom-right, 3.5s), confirm dialogs, empty states with icon + hint + CTA, skeleton "Loading…" states, initial "Loading EduFlex…" so the screen is never blank, startup error card with Reload button.

---

## 9. Database Schema (SQLite; PostgreSQL-portable)

- **users**: id, first_name, last_name, public_username, email UNIQUE, password_hash, institution, programme, peer_matching_enabled (0), notification_preferences ('{}'), role ('student'), account_status ('active'), last_login_at, created_at, updated_at
- **courses**: id, user_id FK, title, code, difficulty, description, created_at, updated_at
- **deadlines**: id, user_id, course_id, title, type, due_date, priority, estimated_hours, status, reminder_enabled (0), reminder_minutes_before (1440), created_at, updated_at
- **availability_slots**: id, user_id, day_of_week 0–6, start_time, end_time, study_intensity, created_at, updated_at
- **study_sessions**: id, user_id, course_id, deadline_id NULL, title, start_datetime, end_datetime, status (Planned/Completed/Missed/Rescheduled), study_intensity, notes, reminder_enabled, reminder_minutes_before (15), original_session_id, recovery_status (NULL/Recovered/Ignored), roadmap_id, roadmap_topic_id, roadmap_task_id, created_at, updated_at
- **resources**: id, user_id, title, description, course_name, course_code, category, institution, public_username, file_url, file_original_name, file_type, file_size, upvotes_count, views_count, downloads_count, (moderation status for admin), created_at, updated_at
- **resource_votes**: id, user_id, resource_id, created_at, UNIQUE(user_id, resource_id)
- **focus_sessions**: id, user_id, course_id, study_session_id, title, study/break/completed_duration_minutes, status (In Progress/Completed/Abandoned), started_at, completed_at, created_at, synced (1), offline_created (0)
- **sessions**: sid PK, sess JSON, expires (login persistence)
- **study_requests**: id, sender_user_id, receiver_user_id, course_name, message, status (Pending/Accepted/Declined), created_at, updated_at
- **study_groups**: id, name, course_name, institution, created_by, created_at
- **study_group_members**: id, group_id, user_id, role (owner/member), joined_at, UNIQUE(group_id, user_id)
- **learning_roadmaps**: id, user_id, course_id, deadline_id, title, course_name, course_code, goal, current_level, target_level, preferred_learning_style, difficulty, duration_days, deadline_date, status, progress_percentage, source (template/custom), created_at, updated_at
- **roadmap_stages**: id, roadmap_id, title, description, stage_order, estimated_hours, status, start_date, end_date, created_at, updated_at
- **roadmap_topics**: id, roadmap_id, stage_id, title, description, topic_order, estimated_hours, status, created_at, updated_at
- **roadmap_tasks**: id, roadmap_id, stage_id, topic_id, title, description, task_type, estimated_minutes, status, created_at, updated_at
- **roadmap_resources**: id, roadmap_id, stage_id, topic_id, resource_id, resource_title, resource_type, resource_url, source_type (library/suggested), quality_score, created_at
- **roadmap_tools**: id, roadmap_id, name, purpose, category, is_required, created_at

Datetimes stored as local `YYYY-MM-DDTHH:MM` strings (match datetime-local inputs); created_at/updated_at as ISO. Foreign keys ON; migrations are idempotent (`addColumnIfMissing`, CREATE TABLE IF NOT EXISTS) so existing databases upgrade in place.

---

## 10. API Route Inventory

- `/api/auth`: POST register, POST login, POST logout, GET me, PUT profile
- `/api/courses`, `/api/deadlines`, `/api/availability`: GET/POST/PUT/DELETE (ownership-scoped)
- `/api/sessions`: GET (?from&to), POST generate, PATCH :id (status/reschedule/reminders), DELETE :id
- `/api/resources`: GET (search/category/institution/course/sort/mine/top_quality), GET institutions, POST (multipart, PDF only), GET :id/view, GET :id/download, POST :id/vote, DELETE :id
- `/api/focus`: GET, POST, PATCH :id, POST sync
- `/api/stats`: GET dashboard, GET progress
- `/api/smart`: GET risk, GET recommendations, POST recommendations/accept, GET resources, GET weekly, GET reminders, GET recovery, POST recovery/:sessionId/accept|ignore, GET dashboard (bundle)
- `/api/peers`: GET/PUT preferences, GET matches, GET/POST requests, PATCH requests/:id, GET/POST groups, POST groups/:id/join|leave
- `/api/roadmaps`: GET, POST preview, POST, GET :id, PUT :id, DELETE :id, POST :id/schedule (optional topic_id), PATCH topics/:id, PATCH tasks/:id, POST :id/stages, POST stages/:id/topics, DELETE topics/:id, DELETE stages/:id
- `/api/admin`: see §7

---

## 11. Security Summary

Auth required for all app APIs; every query scoped to session user (row-level ownership); privacy rule (initials only) enforced in resource + peer payloads and test-verified; bcrypt password hashing; httpOnly session cookie; persisted sessions; PDF-only 20MB uploads with random names behind auth endpoints; path traversal blocked (basename); client + server form validation; admin routes behind requireAdmin; inactive accounts blocked; no secrets in frontend.

---

## 12. Testing (tests/api.test.js — 66 checks, all passing before the loss)

Registration/login/initials, auth blocking, course/deadline/availability CRUD + validation, schedule generation (inside windows, not past), session complete/reschedule, focus start/complete, PDF-only upload + rejection, search/filter, download + inline view (incl. by other students), upvote toggle, privacy rules, cross-user ownership (404s), risk shape, recommendations, weekly insights, quality score + labels, view counter increment, recovery flow (suggest→accept→linked Rescheduled), reminders listing, peer match by shared course (by user id — initials collide across runs), privacy in peer payloads, request send/receive/accept (initials only), groups create/join/members-initials, offline focus sync, roadmap template + custom preview, save keeps user edits, 0%/Not Started start, tools + next topic, roadmap scheduling + linked sessions, progress sync from sessions, manual topic complete, task complete, roadmap ownership (404 for others). Admin tests to add: student blocked from admin APIs, admin stats/users/moderation flows.

---

## 13. Rebuild Plan (current state on this machine)

**Already intact (do NOT rebuild):** entire backend (`server.js`, all `src/routes/*` including admin.js, all `src/services/*`, scheduler, db.js with all migrations incl. role/account_status, seed.js, sessionStore.js, middleware with requireAuth+requireAdmin, tests), `data/eduflex.db` (all user data), package.json.

**Lost / to rebuild (frontend):**
1. `public/js/app.js` — full shell: hash router with sub-routes (roadmaps/:id), titles, helpers (esc, badge sets, fmtDT, dueLabel, modal/confirm/toast, field/INPUT_CLS/emptyState, qualityBadge, RISK_BADGE), offline handling, reminder loop, focus sync queue, AVAIL_PRESETS, DEFAULT_HOURS, autoRegenerate. Keep the new admin nav-visibility + admin route guard.
2. `public/js/views/`: dashboard, courses, deadlines, availability, schedule, calendar, focus, resources, progress, profile, insights, peers, setup, roadmaps (+ keep existing admin.js, finish its pages).
3. `public/app.html` — restore full nav (incl. Roadmaps/Insights/Peer Study) + all script tags + offline banner (admin link already present).
4. `public/index.html` — restore the full landing page (currently a redirect stub).
5. `public/login.html` — restore polished version (error box, demo hint).
6. `public/sw.js` — restore app-shell caching (currently pass-through stub).
7. Apply the **mobile-first + improved colors/buttons** pass (§8) while rebuilding.
8. Finish + verify admin frontend; add admin tests; run full suite.
9. **Commit to git immediately after rebuild** (init repo in eduflex/, .gitignore already excludes node_modules/data/uploads) — so this never happens again.
