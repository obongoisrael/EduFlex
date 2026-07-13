/**
 * EduFlex — Adaptive Learning and Resource Management System
 * Express server: serves the API and the static frontend.
 *
 *   npm start   →  http://localhost:3000
 */
const express = require('express');
const session = require('express-session');
const path = require('path');

const { seedIfEmpty } = require('./src/seed');
const { db } = require('./src/db');
const { SQLiteStore } = require('./src/sessionStore');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logger: prints every API call to the console so you can watch
// backend activity live (method, path, status code, response time).
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      console.log(`${new Date().toLocaleTimeString()}  ${req.method.padEnd(6)} ${req.originalUrl}  →  ${res.statusCode} (${Date.now() - t0}ms)`);
    }
  });
  next();
});

// Session-based authentication (cookie is httpOnly; 7-day lifetime).
// Sessions are persisted in SQLite so restarts don't log users out.
app.use(session({
  store: new SQLiteStore(db),
  secret: process.env.SESSION_SECRET || 'eduflex-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// ---- API routes ----
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/courses', require('./src/routes/courses'));
app.use('/api/deadlines', require('./src/routes/deadlines'));
app.use('/api/availability', require('./src/routes/availability'));
app.use('/api/sessions', require('./src/routes/studySessions'));
app.use('/api/resources', require('./src/routes/resources'));
app.use('/api/focus', require('./src/routes/focus'));
app.use('/api/stats', require('./src/routes/stats'));
app.use('/api/smart', require('./src/routes/smart'));   // Phase 2: risk, recommendations, insights, reminders, recovery
app.use('/api/peers', require('./src/routes/peers'));   // Phase 2: peer study matching, requests, groups
app.use('/api/roadmaps', require('./src/routes/roadmaps')); // Smart Learning Roadmap
app.use('/api/admin', require('./src/routes/admin'));

// NOTE: /uploads is intentionally NOT served statically — files are only
// reachable through the authenticated /api/resources/:id/download route.

// ---- Static frontend ----
// no-cache: browsers must revalidate JS/HTML on every load, so app updates
// are picked up immediately instead of serving stale cached files blankly.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// Fallback: unknown API routes → 404 JSON; anything else → landing page
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

seedIfEmpty();

app.listen(PORT, () => {
  console.log(`\nEduFlex is running →  http://localhost:${PORT}`);
  console.log('Demo login: demo@eduflex.app / demo1234\n');
});
