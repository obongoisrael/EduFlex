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

To create the first admin account:

1. Register a regular student account through the app.
2. Run the following SQL command against the SQLite database at [eduflex/data/eduflex.db](eduflex/data/eduflex.db):

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@eduflex.com';
```

Then sign in and visit the admin area at `/app.html#/admin/dashboard`.

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
  schema mirrors the PostgreSQL design in `PROMPT.md` and ports to Postgres/Supabase easily
- **Frontend:** Vanilla JS single-page app + Tailwind CSS
- **Uploads:** multer → `/uploads`, served only through an authenticated download route

## Project structure

```
eduflex/
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

Start the server, then:

```bash
node tests/api.test.js
```

Covers registration/login, initials generation, all CRUD modules, schedule
generation, calendar updates, focus completion, resource upload/search/upvote,
the privacy rule, and cross-user ownership protection.

## Resetting the demo

Delete `data/eduflex.db` and restart — the seed runs again automatically.
