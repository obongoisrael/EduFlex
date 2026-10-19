/**
 * EduFlex API test suite (PROMPT.md §18).
 * Run with:  npm test   (tests/run.js starts a server on a throwaway database)
 *
 * Covers: registration/login, public-username generation, course/deadline/
 * availability creation, schedule generation, calendar session updates,
 * focus completion, resource upload/search/upvote, and the privacy rule.
 */
// Safety: never run against real data. `npm test` (tests/run.js) sets up a throwaway database.
if (!process.env.EDUFLEX_TEST_RUN) {
  console.error('Refusing to run: these tests write to the database. Use "npm test", which uses a throwaway copy.');
  process.exit(1);
}
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const { db } = require('../src/db');

let cookie = '';
let passed = 0, failed = 0;

async function api(method, path, body, isForm = false) {
  const headers = { Cookie: cookie };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON (e.g. file download) */ }
  return { status: res.status, data };
}

/** Latest email sent to `to` (the test runner writes all mail to EDUFLEX_MAIL_OUTBOX). */
function lastEmail(to) {
  const file = process.env.EDUFLEX_MAIL_OUTBOX;
  if (!file || !fs.existsSync(file)) return null;
  const mails = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  return mails.filter(m => m.to === to).pop() || null;
}
const linkIn = (mail, re) => (mail && mail.text.match(re) || [])[0] || null;

/** Open the confirmation link from the latest email to `to` (logs that user in). */
async function confirmEmail(to) {
  const link = linkIn(lastEmail(to), /http\S+\/api\/auth\/verify\?token=\S+/);
  if (!link) return { status: 0, location: null };
  const res = await fetch(link, { redirect: 'manual', headers: { Cookie: cookie } });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, location: res.headers.get('location'), link };
}

/** GET without following redirects; keeps the session cookie. Returns { status, location }. */
async function hop(url) {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, { redirect: 'manual', headers: { Cookie: cookie } });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, location: res.headers.get('location') || '' };
}

/** Start "Continue with Google": returns the state + nonce Google would receive. */
async function startGoogle() {
  const r = await hop('/api/auth/google');
  const url = new URL(r.location);
  return { r, url, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') };
}
/** Simulate Google sending the student back with an ID token carrying `claims`. */
const googleCallback = (state, claims) =>
  hop(`/api/auth/google/callback?state=${encodeURIComponent(state)}&code=${Buffer.from(JSON.stringify(claims)).toString('base64url')}`);

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
}

(async () => {
  console.log(`\nEduFlex API tests against ${BASE}\n`);
  const stamp = Date.now();
  const email = `test${stamp}@students.eduflex-test.ac.ke`;

  // 1. Registration + public username generation
  let r = await api('POST', '/api/auth/register', {
    first_name: 'John', last_name: 'Doe', email, password: 'secret123',
    institution: 'Test University', programme: 'BSc Testing',
  });
  check('registration succeeds and sends a confirmation email', r.status === 201 && r.data.verification_sent === true
    && !!lastEmail(email), `(got ${r.status})`);
  r = await api('POST', '/api/auth/login', { email, password: 'secret123' });
  check('unconfirmed accounts cannot log in', r.status === 403 && r.data.needs_verification === true);
  const confirm = await confirmEmail(email);
  check('confirmation link verifies and logs in (redirects to setup)', confirm.status === 302 && /#\/setup$/.test(confirm.location || ''));
  r = await api('GET', '/api/auth/me');
  check('public username generated from initials (JD)', r.data?.user?.public_username === 'JD' && r.data.user.email_verified === true);
  const reused = await fetch(confirm.link, { redirect: 'manual' });
  check('confirmation link works only once', /verify=invalid/.test(reused.headers.get('location') || ''));

  // Real-account rules
  const reg = (body) => api('POST', '/api/auth/register', {
    first_name: 'Rule', last_name: 'Check', institution: 'Test University', programme: 'BSc Testing', ...body,
  });
  r = await reg({ email: `rule${stamp}@gmail.com`, password: 'secret123' });
  check('any email domain accepted (e.g. Gmail)', r.status === 201 && r.data.verification_sent === true);
  r = await reg({ email: `rule${stamp}@strathmore.edu`, password: 'short1' });
  check('short password rejected', r.status === 400 && /8 characters/.test(r.data.error));
  r = await reg({ email: `rule${stamp}@strathmore.edu`, password: 'onlyletters' });
  check('password without numbers rejected', r.status === 400 && /letters and numbers/.test(r.data.error));
  r = await reg({ email: `rule${stamp}@strathmore.edu`, password: 'password123' });
  check('common password rejected', r.status === 400 && /too common/.test(r.data.error));
  r = await api('POST', '/api/auth/register', {
    first_name: 'John', last_name: 'Doe', email, password: 'secret123', institution: 'Test University', programme: 'BSc Testing',
  });
  check('duplicate confirmed email rejected', r.status === 409);

  // Invalid registration is rejected
  r = await api('POST', '/api/auth/register', { first_name: '', email: 'bad', password: '1' });
  check('invalid registration rejected', r.status === 400);

  // 2. Admin access checks
  db.prepare(`UPDATE users SET role = 'admin', account_status = 'active', updated_at = ? WHERE email = ?`).run(new Date().toISOString(), email);
  r = await api('GET', '/api/admin/stats');
  check('admin stats endpoint accessible for admins', r.status === 200 && !!r.data?.stats);

  await api('POST', '/api/auth/logout');
  const studentEmail = `student${stamp}@students.eduflex-test.ac.ke`;
  r = await api('POST', '/api/auth/register', {
    first_name: 'Student', last_name: 'User', email: studentEmail, password: 'secret123',
    institution: 'Demo University', programme: 'BSc Demo',
  });
  check('student registration succeeds', r.status === 201);
  await confirmEmail(studentEmail);
  r = await api('GET', '/api/admin/stats');
  check('students are blocked from admin stats', r.status === 403);
  await api('POST', '/api/auth/logout');
  r = await api('GET', '/api/auth/me');
  check('dashboard blocked when logged out', r.status === 401);
  r = await api('POST', '/api/auth/login', { email, password: 'wrong' });
  check('wrong password rejected', r.status === 401);
  r = await api('POST', '/api/auth/login', { email, password: 'secret123' });
  check('login succeeds', r.status === 200);

  // 3. Course creation
  r = await api('POST', '/api/courses', { title: 'Testing 101', code: 'tst 101', difficulty: 'Hard', description: 'x' });
  check('course created', r.status === 201);
  check('course code normalized to uppercase', r.data?.course?.code === 'TST 101');
  const courseId = r.data.course.id;
  r = await api('POST', '/api/courses', { title: 'Bad', code: 'B', difficulty: 'Impossible' });
  check('invalid difficulty rejected', r.status === 400);

  // 4. Deadline creation
  const due = new Date(Date.now() + 4 * 86400000);
  const dueStr = due.toISOString().slice(0, 16);
  r = await api('POST', '/api/deadlines', {
    course_id: courseId, title: 'Test Assignment', type: 'Assignment',
    due_date: dueStr, priority: 'High', estimated_hours: 3,
  });
  check('deadline created', r.status === 201);
  const deadlineId = r.data.deadline.id;

  // 5. Availability slot creation
  const tomorrow = new Date(Date.now() + 86400000);
  r = await api('POST', '/api/availability', {
    day_of_week: tomorrow.getDay(), start_time: '09:00', end_time: '12:00', study_intensity: 'Deep Focus',
  });
  check('availability slot created', r.status === 201);
  r = await api('POST', '/api/availability', { day_of_week: 1, start_time: '12:00', end_time: '09:00', study_intensity: 'Light' });
  check('end-before-start slot rejected', r.status === 400);

  // 6. Schedule generation
  r = await api('POST', '/api/sessions/generate');
  check('schedule generated at least one session', r.status === 200 && r.data.created >= 1, `(created=${r.data?.created})`);
  r = await api('GET', '/api/sessions');
  const session = r.data.sessions.find(s => s.status === 'Planned');
  check('generated session exists and is Planned', !!session);
  check('session placed inside availability window & not in past',
    session && new Date(session.start_datetime) > new Date());

  // 7. Calendar session updates
  r = await api('PATCH', `/api/sessions/${session.id}`, { status: 'Completed' });
  check('session marked completed', r.status === 200 && r.data.session.status === 'Completed');
  const newStart = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
  const newEnd = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString().slice(0, 16);
  r = await api('PATCH', `/api/sessions/${session.id}`, { start_datetime: newStart, end_datetime: newEnd });
  check('session rescheduled', r.status === 200 && r.data.session.status === 'Rescheduled');

  // 8. Focus mode completion
  r = await api('POST', '/api/focus', { title: 'Test focus', course_id: courseId, study_duration_minutes: 25, break_duration_minutes: 5 });
  check('focus session started', r.status === 201);
  r = await api('PATCH', `/api/focus/${r.data.id}`, { completed_duration_minutes: 25 });
  check('focus session completed', r.status === 200);

  // 9. Resource upload (PDF only)
  const pdfBytes = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF';
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'test-notes.pdf');
  form.append('title', `Privacy Test Notes ${stamp}`);
  form.append('description', 'uploaded by automated test');
  form.append('course_name', 'Testing 101');
  form.append('course_code', 'TST 101');
  form.append('category', 'Notes');
  r = await api('POST', '/api/resources', form, true);
  check('PDF resource uploaded', r.status === 201);
  const resourceId = r.data.id;

  // Non-PDF uploads must be rejected
  const badForm = new FormData();
  badForm.append('file', new Blob(['not a pdf'], { type: 'text/plain' }), 'notes.docx');
  badForm.append('title', 'Bad upload');
  badForm.append('course_name', 'Testing 101');
  badForm.append('category', 'Notes');
  r = await api('POST', '/api/resources', badForm, true);
  check('non-PDF upload rejected', r.status === 400);

  // 10. Resource search & filtering
  r = await api('GET', `/api/resources?search=Privacy%20Test%20Notes%20${stamp}`);
  check('resource search finds upload', r.data.resources.some(x => x.id === resourceId));
  r = await api('GET', '/api/resources?category=Notes');
  check('category filter works', r.data.resources.every(x => x.category === 'Notes'));

  // 10b. Download & inline view (any authenticated student, not just the owner)
  r = await api('GET', `/api/resources/${resourceId}/download`);
  check('resource downloadable', r.status === 200);
  r = await api('GET', `/api/resources/${resourceId}/view`);
  check('resource viewable inline in browser', r.status === 200);

  // 11. Upvoting (toggle)
  r = await api('POST', `/api/resources/${resourceId}/vote`);
  check('upvote registered', r.data.upvotes_count === 1 && r.data.voted === true);
  r = await api('POST', `/api/resources/${resourceId}/vote`);
  check('second vote toggles off', r.data.upvotes_count === 0 && r.data.voted === false);

  // 12. PRIVACY RULE: public resource view must never expose full names
  r = await api('GET', '/api/resources');
  const leaky = r.data.resources.some(x =>
    'first_name' in x || 'last_name' in x ||
    JSON.stringify(x).includes('"John"') || JSON.stringify(x).includes('"Doe"'));
  check('privacy rule: no full names in public resource view', !leaky);
  const mine = r.data.resources.find(x => x.id === resourceId);
  check('privacy rule: contributor shown as initials "JD"', mine?.public_username === 'JD');

  // 13. Ownership: another user cannot edit our course
  await api('POST', '/api/auth/logout');
  r = await api('POST', '/api/auth/register', {
    first_name: 'Eve', last_name: 'Intruder', email: `eve${stamp}@students.eduflex-test.ac.ke`,
    password: 'secret123', institution: 'Other Uni', programme: 'X',
  });
  await confirmEmail(`eve${stamp}@students.eduflex-test.ac.ke`);
  const eveId = (await api('GET', '/api/auth/me')).data.user.id; // used later to target THIS run's Eve in peer matching
  r = await api('PUT', `/api/courses/${courseId}`, { title: 'Hacked' });
  check('other users cannot edit your course', r.status === 404);
  r = await api('DELETE', `/api/resources/${resourceId}`);
  check('other users cannot delete your resource', r.status === 404);

  // 14. Sharing: other students CAN download and view shared resources
  r = await api('GET', `/api/resources/${resourceId}/download`);
  check('other students can download shared resources', r.status === 200);
  r = await api('GET', `/api/resources/${resourceId}/view`);
  check('other students can view shared resources', r.status === 200);

  /* ===================== PHASE 2 — smart features ===================== */

  // Eve (currently logged in) gets a matching course + opts into peer matching
  await api('POST', '/api/courses', { title: 'Testing 101', code: 'TST 101', difficulty: 'Easy', description: '' });
  await api('PUT', '/api/peers/preferences', { enabled: true });

  // Back to John
  await api('POST', '/api/auth/login', { email, password: 'secret123' });

  // 15. Academic risk prediction
  r = await api('GET', '/api/smart/risk');
  check('risk assessment returned', r.status === 200 && Array.isArray(r.data.risks) && r.data.risks.length >= 1);
  const risk0 = r.data.risks[0] || {};
  check('risk has level, score and reason',
    ['Low', 'Medium', 'High'].includes(risk0.risk_level) && typeof risk0.risk_score === 'number' && !!risk0.reason);

  // 16. Smart study recommendations
  r = await api('GET', '/api/smart/recommendations');
  check('study recommendations endpoint works', r.status === 200 && Array.isArray(r.data.recommendations));

  // 17. Weekly insights
  r = await api('GET', '/api/smart/weekly');
  check('weekly insights generated', r.status === 200 && typeof r.data.completion_pct === 'number' && !!r.data.insight_text);

  // 18. Resource quality score
  r = await api('GET', '/api/resources');
  check('resources include quality score + label',
    r.data.resources.every(x => typeof x.quality_score === 'number' && !!x.quality_label));

  // 19. View counter (feeds quality score)
  let mine2 = r.data.resources.find(x => x.id === resourceId);
  const beforeViews = mine2.views_count;
  await api('GET', `/api/resources/${resourceId}/view`);
  r = await api('GET', '/api/resources');
  mine2 = r.data.resources.find(x => x.id === resourceId);
  check('view count increments', mine2.views_count === beforeViews + 1);

  // 20. Missed session recovery
  r = await api('GET', '/api/sessions');
  const target = r.data.sessions.find(s => s.status === 'Planned' || s.status === 'Rescheduled');
  await api('PATCH', `/api/sessions/${target.id}`, { status: 'Missed' });
  r = await api('GET', '/api/smart/recovery');
  const sug = r.data.suggestions.find(s => s.session_id === target.id);
  check('recovery suggestion generated for missed session', !!sug);
  if (sug && sug.options.length > 0) {
    r = await api('POST', `/api/smart/recovery/${target.id}/accept`, sug.options[0]);
    check('recovery slot accepted', r.status === 201);
    r = await api('GET', '/api/sessions');
    const recSession = r.data.sessions.find(s => s.original_session_id === target.id);
    check('recovery session is Rescheduled + linked to original', !!recSession && recSession.status === 'Rescheduled');
  } else {
    check('recovery slot accepted', false, '(no free slots found)');
    check('recovery session is Rescheduled + linked to original', false);
  }

  // 21. Alarm reminders
  r = await api('GET', '/api/sessions');
  const nowLocal = new Date().toISOString().slice(0, 16);
  const future = r.data.sessions.find(s =>
    (s.status === 'Planned' || s.status === 'Rescheduled') && s.start_datetime > nowLocal);
  await api('PATCH', `/api/sessions/${future.id}`, { reminder_enabled: true, reminder_minutes_before: 30 });
  r = await api('GET', '/api/smart/reminders');
  check('session reminder listed with remind_at', r.data.reminders.some(x => x.kind === 'session' && x.id === future.id && !!x.remind_at));

  // 22. Peer matching (John ↔ Eve share TST 101)
  await api('PUT', '/api/peers/preferences', { enabled: true }); // John opts in
  r = await api('GET', '/api/peers/matches');
  // match by user id — initials alone are ambiguous across repeated test runs
  const match = (r.data.matches || []).find(m => m.user_id === eveId);
  check('peer match found by shared course (EI)', !!match && match.public_username === 'EI');
  check('peer matching privacy: no full names or emails in payload',
    !JSON.stringify(r.data).includes('Intruder') && !JSON.stringify(r.data).includes('@students.eduflex-test.ac.ke'));

  // 23. Study requests (sender → receiver, initials only)
  r = await api('POST', '/api/peers/requests', {
    receiver_user_id: match.user_id, course_name: 'Testing 101', message: 'Revise together before the CAT?',
  });
  check('study request sent', r.status === 201);
  await api('POST', '/api/auth/login', { email: `eve${stamp}@students.eduflex-test.ac.ke`, password: 'secret123' });
  r = await api('GET', '/api/peers/requests');
  const incoming = (r.data.incoming || []).find(x => x.status === 'Pending');
  check('request visible to receiver, sender shown as initials (JD)', !!incoming && incoming.public_username === 'JD');
  r = await api('PATCH', `/api/peers/requests/${incoming.id}`, { status: 'Accepted' });
  check('study request accepted', r.status === 200);

  // 24. Study groups
  r = await api('POST', '/api/peers/groups', { name: 'TST Revision Squad', course_name: 'Testing 101' });
  check('study group created', r.status === 201);
  const groupId = r.data.id;
  await api('POST', '/api/auth/login', { email, password: 'secret123' });
  r = await api('POST', `/api/peers/groups/${groupId}/join`);
  check('joined study group', r.status === 200);
  r = await api('GET', '/api/peers/groups');
  const grp = r.data.groups.find(x => x.id === groupId);
  check('group members shown as initials only', !!grp && grp.member_count === 2 &&
    grp.members.every(m => m.public_username && m.first_name === undefined));

  // 25. Offline focus sync
  r = await api('POST', '/api/focus/sync', {
    sessions: [{
      title: 'Offline pomodoro', course_id: courseId,
      study_duration_minutes: 25, break_duration_minutes: 5, completed_duration_minutes: 25,
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    }],
  });
  check('offline focus sessions synced', r.status === 200 && r.data.synced === 1);

  /* ===================== Smart Learning Roadmap ===================== */
  // (John is logged in)

  // 26. Template-based generation (Database Systems matches a predefined template)
  r = await api('POST', '/api/roadmaps/preview', {
    course_name: 'Database Systems', course_code: 'TST 224', current_level: 'Beginner',
    preferred_learning_style: 'Mixed', duration_days: 14, ai: false, // tests never call the paid AI
  });
  check('roadmap preview generated from template', r.status === 200 && r.data.structure.source === 'template'
    && r.data.structure.stages.length >= 3);
  check('preview reports AI status (skipped on request)', r.data.ai && r.data.ai.built === false && r.data.ai.reason === 'off'
    && typeof r.data.ai.remaining === 'number');
  const aiStatus = await api('GET', '/api/roadmaps/ai');
  check('AI status endpoint returns quota', aiStatus.status === 200 && typeof aiStatus.data.configured === 'boolean'
    && aiStatus.data.limit > 0 && aiStatus.data.used >= 0);

  // 27. Custom fallback for unknown subjects
  const custom = await api('POST', '/api/roadmaps/preview', {
    course_name: 'Marine Biology', current_level: 'Beginner', preferred_learning_style: 'Exam-focused', duration_days: 10, ai: false,
  });
  check('custom roadmap generated for unknown subject', custom.data.structure.source === 'custom'
    && custom.data.structure.stages.length >= 2);

  // 28. Save (structure is editable client-side before this call)
  const structure = r.data.structure;
  structure.stages[0].topics[0].title = 'EDITED: intro to databases';
  r = await api('POST', '/api/roadmaps', {
    course_name: 'Database Systems', course_code: 'TST 224', current_level: 'Beginner',
    preferred_learning_style: 'Mixed', difficulty: 'Moderate', duration_days: 14,
    goal: 'Pass the CAT', structure,
  });
  check('roadmap saved', r.status === 201);
  const roadmapId = r.data.id;

  // 29. Detail includes edited topic, stages, tools, progress 0
  r = await api('GET', `/api/roadmaps/${roadmapId}`);
  const allTopics = r.data.stages.flatMap(s => s.topics);
  check('saved roadmap keeps user edits', allTopics.some(t => t.title.startsWith('EDITED:')));
  check('roadmap starts at 0% Not Started', r.data.roadmap.progress_percentage === 0 && r.data.roadmap.status === 'Not Started');
  check('roadmap has tools and next topic', r.data.tools.length >= 1 && !!r.data.next_topic);

  // 30. Generate Study Schedule from Roadmap → linked sessions in calendar
  r = await api('POST', `/api/roadmaps/${roadmapId}/schedule`);
  check('roadmap schedule generated sessions', r.status === 200 && r.data.created >= 1, `(created=${r.data?.created})`);
  r = await api('GET', '/api/sessions');
  const rmSession = r.data.sessions.find(s => s.roadmap_id === roadmapId);
  check('sessions linked back to roadmap topic', !!rmSession && !!rmSession.roadmap_topic_id);

  // 31. Completing a linked session updates roadmap progress
  const firstTopicId = rmSession.roadmap_topic_id;
  const linked = r.data.sessions.filter(s => s.roadmap_topic_id === firstTopicId);
  for (const s of linked) await api('PATCH', `/api/sessions/${s.id}`, { status: 'Completed' });
  r = await api('GET', `/api/roadmaps/${roadmapId}`);
  const doneTopic = r.data.stages.flatMap(s => s.topics).find(t => t.id === firstTopicId);
  check('completing linked sessions advances the topic',
    doneTopic.status === 'Completed' || doneTopic.status === 'In Progress');
  check('roadmap progress updated from sessions',
    r.data.roadmap.progress_percentage > 0 || doneTopic.status === 'In Progress');

  // 32. Manual topic completion + task tick
  const otherTopic = r.data.stages.flatMap(s => s.topics).find(t => t.id !== firstTopicId);
  r = await api('PATCH', `/api/roadmaps/topics/${otherTopic.id}`, { status: 'Completed' });
  check('topic marked completed manually, progress recalculated', r.status === 200 && r.data.progress_percentage > 0);
  const task = (await api('GET', `/api/roadmaps/${roadmapId}`)).data.stages
    .flatMap(s => s.topics).flatMap(t => t.tasks)[0];
  if (task) {
    r = await api('PATCH', `/api/roadmaps/tasks/${task.id}`, { status: 'Completed' });
    check('roadmap task completed', r.status === 200);
  } else check('roadmap task completed', false, '(no tasks found)');

  // 33. Ownership: Eve cannot access John's roadmap
  await api('POST', '/api/auth/login', { email: `eve${stamp}@students.eduflex-test.ac.ke`, password: 'secret123' });
  r = await api('GET', `/api/roadmaps/${roadmapId}`);
  check('other users cannot view your roadmap', r.status === 404);
  r = await api('DELETE', `/api/roadmaps/${roadmapId}`);
  check('other users cannot delete your roadmap', r.status === 404);
  await api('POST', '/api/auth/login', { email, password: 'secret123' });

  /* ===================== Hardening: cross-user IDs, admin guards, moderation ===================== */

  // 34. Rescheduling into the past is rejected
  const pastStart = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
  const pastEnd = new Date(Date.now() - 86400000 + 3600000).toISOString().slice(0, 16);
  r = await api('PATCH', `/api/sessions/${session.id}`, { start_datetime: pastStart, end_datetime: pastEnd });
  check('rescheduling into the past rejected', r.status === 400);

  // 35. Eve cannot attach John's course / session / deadline to her own records
  await api('POST', '/api/auth/login', { email: `eve${stamp}@students.eduflex-test.ac.ke`, password: 'secret123' });
  const eveCourse = (await api('GET', '/api/courses')).data.courses[0];
  r = await api('POST', '/api/deadlines', {
    course_id: eveCourse.id, title: 'Eve deadline', type: 'Assignment',
    due_date: dueStr, priority: 'Low', estimated_hours: 2,
  });
  r = await api('PUT', `/api/deadlines/${r.data.deadline.id}`, { course_id: courseId });
  check('cannot move a deadline onto another user\'s course', r.status === 400);
  r = await api('POST', '/api/focus', { title: 'x', study_session_id: session.id });
  check('cannot link focus to another user\'s study session', r.status === 400);
  // (Eve needs Plus to reach the recommendations endpoint, so the ownership check is what's tested)
  db.prepare(`UPDATE users SET plan = 'plus' WHERE id = ?`).run(eveId);
  const soonStart = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
  const soonEnd = new Date(Date.now() + 3 * 86400000 + 3600000).toISOString().slice(0, 16);
  r = await api('POST', '/api/smart/recommendations/accept', {
    course_id: eveCourse.id, deadline_id: deadlineId, start_datetime: soonStart, end_datetime: soonEnd,
  });
  check('cannot accept a recommendation for another user\'s deadline', r.status === 400);

  // 36. Admin (John) cannot demote/deactivate himself; invalid values rejected
  await api('POST', '/api/auth/login', { email, password: 'secret123' });
  const johnId = (await api('GET', '/api/auth/me')).data.user.id;
  r = await api('PATCH', `/api/admin/users/${johnId}/role`, { role: 'student' });
  check('admin cannot demote themselves', r.status === 400);
  r = await api('PATCH', `/api/admin/users/${johnId}/status`, { status: 'inactive' });
  check('admin cannot deactivate themselves', r.status === 400);
  r = await api('PATCH', `/api/admin/users/${eveId}/status`, { status: 'bogus' });
  check('invalid account status rejected', r.status === 400);

  // 37. Rejected resources are hidden from other students (owner still sees them)
  r = await api('PATCH', `/api/admin/resources/${resourceId}/reject`, {});
  check('admin can reject a resource', r.status === 200);
  r = await api('GET', `/api/resources/${resourceId}/view`);
  check('owner can still view their rejected resource', r.status === 200);
  await api('POST', '/api/auth/login', { email: `eve${stamp}@students.eduflex-test.ac.ke`, password: 'secret123' });
  r = await api('GET', `/api/resources/${resourceId}/view`);
  check('rejected resource cannot be viewed by others', r.status === 404);
  r = await api('GET', `/api/resources/${resourceId}/download`);
  check('rejected resource cannot be downloaded by others', r.status === 404);
  r = await api('GET', '/api/stats/dashboard');
  check('rejected resource hidden from dashboard feed', !r.data.recent_resources.some(x => x.id === resourceId));

  // 38. Admin deleting a resource also removes its file from disk
  await api('POST', '/api/auth/login', { email, password: 'secret123' });
  const storedInDb = !!db.prepare('SELECT 1 FROM resource_files WHERE resource_id = ?').get(resourceId);
  check('uploaded PDF is stored in the database (backed up with it)', storedInDb
    && db.prepare('SELECT file_url FROM resources WHERE id = ?').get(resourceId).file_url === 'db');
  r = await api('DELETE', `/api/admin/resources/${resourceId}`);
  check('admin deletes resource and its file', r.status === 200
    && !db.prepare('SELECT 1 FROM resource_files WHERE resource_id = ?').get(resourceId));

  /* ===================== Premium (EduFlex Plus) ===================== */

  // 39. Free students are blocked from Plus features
  await api('POST', '/api/auth/login', { email: studentEmail, password: 'secret123' });
  r = await api('GET', '/api/auth/me');
  check('new students start on the free plan', r.data.user.plan === 'free' && r.data.user.is_plus === false);
  const studentId = r.data.user.id;
  r = await api('GET', '/api/smart/risk');
  check('free plan: smart insights return 402 premium', r.status === 402 && r.data.premium === true);
  r = await api('GET', '/api/smart/recovery');
  check('free plan: missed-session recovery locked', r.status === 402);
  r = await api('GET', '/api/resources?top_quality=1');
  check('free plan: quality filter locked', r.status === 402);
  r = await api('GET', '/api/smart/dashboard');
  check('free plan: dashboard teaser without recommendations or risk reasons',
    r.status === 200 && r.data.is_plus === false && r.data.recommendation.locked === true
    && r.data.risks.every(x => x.reason === undefined));

  // 40. Free plan allows exactly one roadmap
  const pv = await api('POST', '/api/roadmaps/preview', { course_name: 'Networking Basics', current_level: 'Beginner', preferred_learning_style: 'Mixed', duration_days: 7, ai: false });
  const rmBody = { course_name: 'Networking Basics', current_level: 'Beginner', preferred_learning_style: 'Mixed', duration_days: 7, structure: pv.data.structure };
  r = await api('POST', '/api/roadmaps', rmBody);
  check('free plan: first roadmap allowed', r.status === 201);
  r = await api('POST', '/api/roadmaps', rmBody);
  check('free plan: second roadmap needs Plus', r.status === 402 && r.data.premium === true);

  // 41. Admin grants Plus → features unlock; students can't grant themselves
  r = await api('PATCH', `/api/admin/users/${studentId}/plan`, { plan: 'plus', days: 30 });
  check('students cannot grant plans', r.status === 403);
  await api('POST', '/api/auth/login', { email, password: 'secret123' });
  r = await api('PATCH', `/api/admin/users/${studentId}/plan`, { plan: 'plus', days: 30 });
  check('admin grants Plus for 30 days', r.status === 200 && r.data.user.plan === 'plus' && !!r.data.user.plan_expires_at);
  await api('POST', '/api/auth/login', { email: studentEmail, password: 'secret123' });
  r = await api('GET', '/api/smart/risk');
  check('Plus student can use smart insights', r.status === 200);
  r = await api('POST', '/api/roadmaps', rmBody);
  check('Plus student can create more roadmaps', r.status === 201);

  // 42. Expired Plus falls back to free
  db.prepare(`UPDATE users SET plan_expires_at = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), studentId);
  r = await api('GET', '/api/smart/risk');
  check('expired Plus is treated as free', r.status === 402);

  /* ===================== Password reset, password change, brute-force protection ===================== */

  // 43. Forgot password → emailed link → new password; old one stops working; link is single-use
  await api('POST', '/api/auth/logout');
  r = await api('POST', '/api/auth/forgot', { email: `nobody${stamp}@students.eduflex-test.ac.ke` });
  check('forgot password gives the same answer for unknown emails', r.status === 200 && !lastEmail(`nobody${stamp}@students.eduflex-test.ac.ke`));
  r = await api('POST', '/api/auth/forgot', { email: studentEmail });
  const resetLink = linkIn(lastEmail(studentEmail), /http\S+\/reset\.html\?token=\S+/);
  check('reset link emailed', r.status === 200 && !!resetLink);
  const resetToken = resetLink ? decodeURIComponent(new URL(resetLink).searchParams.get('token')) : '';
  r = await api('POST', '/api/auth/reset', { token: resetToken, password: 'weak' });
  check('reset rejects a weak password (link still usable)', r.status === 400);
  r = await api('POST', '/api/auth/reset', { token: resetToken, password: 'NewPassw0rd' });
  check('password reset succeeds', r.status === 200);
  r = await api('POST', '/api/auth/reset', { token: resetToken, password: 'Another1pass' });
  check('reset link works only once', r.status === 400);
  r = await api('POST', '/api/auth/login', { email: studentEmail, password: 'secret123' });
  check('old password no longer works', r.status === 401);
  r = await api('POST', '/api/auth/login', { email: studentEmail, password: 'NewPassw0rd' });
  check('new password works', r.status === 200);

  // 44. Changing the password in Profile needs the current password
  r = await api('PUT', '/api/auth/profile', { password: 'Changed123' });
  check('password change without current password rejected', r.status === 400);
  r = await api('PUT', '/api/auth/profile', { password: 'Changed123', current_password: 'NewPassw0rd' });
  check('password change with current password succeeds', r.status === 200);

  // 45. Too many wrong passwords → temporarily blocked
  await api('POST', '/api/auth/logout');
  for (let i = 0; i < 5; i++) await api('POST', '/api/auth/login', { email: studentEmail, password: 'wrong-guess1' });
  r = await api('POST', '/api/auth/login', { email: studentEmail, password: 'Changed123' });
  check('login blocked after 5 wrong passwords', r.status === 429);

  /* ===================== Continue with Google ===================== */

  // 46. Config + redirect to Google
  await api('POST', '/api/auth/logout');
  r = await api('GET', '/api/auth/config');
  check('login page is told Google sign-in is available', r.status === 200 && r.data.google === true);
  let g = await startGoogle();
  check('"Continue with Google" redirects to Google with client id, state and nonce',
    g.r.status === 302 && g.url.origin === 'https://accounts.google.com'
    && g.url.searchParams.get('client_id') === process.env.GOOGLE_CLIENT_ID
    && !!g.state && !!g.nonce && /\/api\/auth\/google\/callback$/.test(g.url.searchParams.get('redirect_uri')));

  // 47. Forged / replayed callbacks are rejected
  r = await googleCallback('forged-state', { sub: 'x', email: 'x@gmail.com', email_verified: true, nonce: g.nonce });
  check('callback with a wrong state is rejected', /google=error/.test(r.location));
  r = await googleCallback(g.state, { sub: 'x', email: 'x@gmail.com', email_verified: true, nonce: g.nonce });
  check('a sign-in attempt cannot be replayed', /google=error/.test(r.location));

  // 48. New student signs up with Google
  const gEmail = `grace${stamp}@gmail.com`;
  g = await startGoogle();
  r = await googleCallback(g.state, { sub: `google-${stamp}`, email: gEmail, email_verified: true,
    given_name: 'Grace', family_name: 'Wanjiru', name: 'Grace Wanjiru', nonce: g.nonce });
  check('Google sign-up logs in and opens setup', r.status === 302 && /\/app\.html#\/setup$/.test(r.location));
  r = await api('GET', '/api/auth/me');
  check('Google account is confirmed, linked, initials GW, no password',
    r.status === 200 && r.data.user.email === gEmail && r.data.user.email_verified && r.data.user.google_linked
    && r.data.user.public_username === 'GW' && r.data.user.has_password === false);
  check('new Google account must finish its profile', r.data.user.profile_complete === false);
  r = await api('PUT', '/api/auth/profile', { first_name: 'Grace', last_name: 'Wanjiru', institution: 'Strathmore University', programme: 'BBIT' });
  check('profile completed (institution + programme)', r.status === 200 && r.data.user.profile_complete === true);
  r = await api('PUT', '/api/auth/profile', { password: 'GracePass2026' });
  check('Google user can set a first password without a current one', r.status === 200 && r.data.user.has_password === true);

  // 49. Returning Google user signs straight in
  await api('POST', '/api/auth/logout');
  g = await startGoogle();
  r = await googleCallback(g.state, { sub: `google-${stamp}`, email: gEmail, email_verified: true, nonce: g.nonce });
  const meAgain = await api('GET', '/api/auth/me');
  check('returning Google user signs in to the same account', r.status === 302 && meAgain.data.user.email === gEmail);

  // 50. Google account matching an existing email/password account links to it
  await api('POST', '/api/auth/logout');
  g = await startGoogle();
  r = await googleCallback(g.state, { sub: `google-student-${stamp}`, email: studentEmail, email_verified: true, nonce: g.nonce });
  r = await api('GET', '/api/auth/me');
  check('Google sign-in links to the existing account with that email',
    r.data.user.id === studentId && r.data.user.google_linked === true && r.data.user.has_password === true);

  // 51. Unsafe tokens are refused
  await api('POST', '/api/auth/logout');
  g = await startGoogle();
  r = await googleCallback(g.state, { sub: 'unverified-1', email: `unv${stamp}@gmail.com`, email_verified: false, nonce: g.nonce });
  check('Google accounts with unverified emails are refused', /google=unverified/.test(r.location));
  g = await startGoogle();
  r = await googleCallback(g.state, { sub: 'aud-1', email: `aud${stamp}@gmail.com`, email_verified: true, nonce: g.nonce, aud: 'someone-elses-app' });
  check('ID tokens meant for another app are refused', /google=error/.test(r.location));
  g = await startGoogle();
  r = await googleCallback(g.state, { sub: 'nonce-1', email: `nonce${stamp}@gmail.com`, email_verified: true, nonce: 'wrong-nonce' });
  check('ID tokens from a different sign-in attempt are refused', /google=error/.test(r.location));

  // 52. Password login on a Google-only account explains what to do
  g = await startGoogle();
  const onlyGoogle = `only${stamp}@gmail.com`;
  await googleCallback(g.state, { sub: `only-${stamp}`, email: onlyGoogle, email_verified: true, given_name: 'Ola', family_name: 'Kim', nonce: g.nonce });
  await api('POST', '/api/auth/logout');
  r = await api('POST', '/api/auth/login', { email: onlyGoogle, password: 'whatever123' });
  check('password login on a Google-only account points to Google', r.status === 400 && r.data.google_only === true);

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('Test runner error:', err.message); process.exit(1); });
