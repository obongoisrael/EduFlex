# EduFlex 🎓

**Adaptive Learning and Resource Management System for Colleges and Universities**

EduFlex helps students plan study time, manage academic deadlines, stay focused,
and access shared learning resources — all from one clean, responsive dashboard.

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:3000**.

Demo account (seeded automatically on first run):

| Email | Password |
|---|---|
| `demo@eduflex.app` | `demo1234` |

## Admin module

To make an account an admin (e.g. the owner's):

1. Register the account through the app as normal.
2. Promote it from the project folder (works while the server is running):

```bash
npm run make-admin -- you@example.com
```

Then sign in and open **Admin** in the menu (or `/app.html#/admin`). From there you can
manage users (activate/deactivate, promote/demote, delete), moderate resources
(approve/reject/delete), and see courses, study sessions and reports.
Admins cannot demote, deactivate or delete their own account.

**Where the owner's data lives:** everything is in `data/eduflex.db` (one SQLite file)
plus the PDFs in `uploads/`. Neither folder is in git — back them up separately.

## Features

| Module | Description |
|---|---|
| **Authentication** | Register/login with private full names; public identity is initials only (e.g. John Doe → "JD") |
| **Dashboard** | Welcome banner, quick actions, upcoming deadlines, today's sessions, weekly progress |
| **Courses** | CRUD with difficulty levels (Easy / Moderate / Hard) |
| **Deadlines** | Assignments, CATs, exams, projects — sorted by urgency, with priority & estimated hours |
| **Availability** | Weekly free-time slots with study intensity (Light / Normal / Deep Focus) |
| **Adaptive Scheduler** | One-click study plan: urgent + high-priority work first, hard courses get longer sessions, big workloads split into 0.5–2h chunks, sessions only inside availability and never in the past |
| **Calendar** | Month / week / day views; Planned=blue, Completed=green, Missed=red, Rescheduled=purple; click to complete / miss / reschedule / delete |
| **Focus Mode** | Pomodoro timer (default 25/5, customizable) with pause/resume; completed time feeds weekly progress |
| **Progress** | Completion ring, 7-day study chart, per-course progress bars |
| **Resource Library** | Upload/browse/search/filter/upvote notes, slides, PDFs & past papers — contributors shown by **initials + institution only** (privacy rule) |

## Tech stack

- **Backend:** Node.js + Express, session-based auth (bcrypt password hashing)
- **Database:** SQLite via Node's built-in `node:sqlite` (zero native dependencies);
  schema is PostgreSQL-portable (see `EDUFLEX-MASTER-SPEC.md` §9) and ports to Postgres/Supabase easily
- **Frontend:** Vanilla JS single-page app + Tailwind CSS
- **Uploads:** multer → `/uploads`, served only through an authenticated download route

## Project structure

```
eduflex-v2/
├── server.js              # Express app entry point
├── src/
│   ├── db.js              # Schema + DB helpers (node:sqlite)
│   ├── seed.js            # Demo data (runs automatically on first start)
│   ├── scheduler.js       # Adaptive scheduling engine
│   ├── middleware.js      # Auth guard
│   └── routes/            # auth, courses, deadlines, availability,
│                          # studySessions, resources, focus, stats
├── public/
│   ├── index.html         # Landing page
│   ├── login.html / register.html
│   ├── app.html           # App shell (sidebar + topbar)
│   └── js/
│       ├── api.js, app.js # Fetch wrapper, router, shared UI helpers
│       └── views/         # dashboard, courses, deadlines, availability,
│                          # schedule, calendar, focus, resources, progress, profile
├── tests/api.test.js      # End-to-end API tests
├── data/                  # SQLite database (created at runtime)
└── uploads/               # Uploaded resource files
```

## Security

- Only authenticated users can access the dashboard and API.
- Every query is scoped to the session user — you can only edit/delete your own
  courses, deadlines, slots, sessions and resources (row-level ownership).
- Full student names are **never** exposed in resource listings (verified by tests).
- Passwords hashed with bcrypt; session cookie is httpOnly.
- Uploads are PDF-only (viewable in-browser and downloadable), capped at 20 MB,
  stored under random names, and only served through authenticated endpoints
  (no static /uploads).
- All forms validated client-side **and** server-side.

## Tests

```bash
npm test
```

This runs every suite against a **throwaway database and uploads folder** in the
system temp directory, on its own server and port. Your real data (`data/eduflex.db`,
`uploads/`) and any EduFlex server you have running are never touched, AI is
switched off so no paid Claude calls are made, and the temporary files are deleted
afterwards. Running a test file directly is refused for the same reason.

Covers registration/login, initials generation, all CRUD modules, schedule
generation, calendar updates, focus completion, resource upload/search/upvote,
the privacy rule, cross-user ownership protection, admin guards, EduFlex Plus
limits, and AI roadmap generation (offline, with a simulated Claude response).

To point the app itself at a different database or uploads folder, set
`EDUFLEX_DB_PATH` and `EDUFLEX_UPLOAD_DIR`.

## Resetting the demo

Delete `data/eduflex.db` and restart — the seed runs again automatically.
