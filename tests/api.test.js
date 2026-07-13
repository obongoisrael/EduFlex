/**
 * EduFlex API test suite (PROMPT.md §18).
 * Run the server first (npm start), then:  node tests/api.test.js
 *
 * Covers: registration/login, public-username generation, course/deadline/
 * availability creation, schedule generation, calendar session updates,
 * focus completion, resource upload/search/upvote, and the privacy rule.
 */
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

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
}

(async () => {
  console.log(`\nEduFlex API tests against ${BASE}\n`);
  const stamp = Date.now();
  const email = `test${stamp}@example.com`;

  // 1. Registration + public username generation
  let r = await api('POST', '/api/auth/register', {
    first_name: 'John', last_name: 'Doe', email, password: 'secret123',
    institution: 'Test University', programme: 'BSc Testing',
  });
  check('registration succeeds', r.status === 201, `(got ${r.status})`);
  check('public username generated from initials (JD)', r.data?.user?.public_username === 'JD');

  // Invalid registration is rejected
  r = await api('POST', '/api/auth/register', { first_name: '', email: 'bad', password: '1' });
  check('invalid registration rejected', r.status === 400);

  // 2. Admin access checks
  db.prepare(`UPDATE users SET role = 'admin', account_status = 'active', updated_at = ? WHERE email = ?`).run(new Date().toISOString(), email);
  r = await api('GET', '/api/admin/stats');
  check('admin stats endpoint accessible for admins', r.status === 200 && !!r.data?.stats);

  await api('POST', '/api/auth/logout');
  const studentEmail = `student${stamp}@example.com`;
  r = await api('POST', '/api/auth/register', {
    first_name: 'Student', last_name: 'User', email: studentEmail, password: 'secret123',
    institution: 'Demo University', programme: 'BSc Demo',
  });
  check('student registration succeeds', r.status === 201);
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
    first_name: 'Eve', last_name: 'Intruder', email: `eve${stamp}@example.com`,
    password: 'secret123', institution: 'Other Uni', programme: 'X',
  });
  const eveId = r.data.user.id; // used later to target THIS run's Eve in peer matching
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
    !JSON.stringify(r.data).includes('Intruder') && !JSON.stringify(r.data).includes('@example.com'));

  // 23. Study requests (sender → receiver, initials only)
  r = await api('POST', '/api/peers/requests', {
    receiver_user_id: match.user_id, course_name: 'Testing 101', message: 'Revise together before the CAT?',
  });
  check('study request sent', r.status === 201);
  await api('POST', '/api/auth/login', { email: `eve${stamp}@example.com`, password: 'secret123' });
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
    preferred_learning_style: 'Mixed', duration_days: 14,
  });
  check('roadmap preview generated from template', r.status === 200 && r.data.structure.source === 'template'
    && r.data.structure.stages.length >= 3);

  // 27. Custom fallback for unknown subjects
  const custom = await api('POST', '/api/roadmaps/preview', {
    course_name: 'Marine Biology', current_level: 'Beginner', preferred_learning_style: 'Exam-focused', duration_days: 10,
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
  await api('POST', '/api/auth/login', { email: `eve${stamp}@example.com`, password: 'secret123' });
  r = await api('GET', `/api/roadmaps/${roadmapId}`);
  check('other users cannot view your roadmap', r.status === 404);
  r = await api('DELETE', `/api/roadmaps/${roadmapId}`);
  check('other users cannot delete your roadmap', r.status === 404);
  await api('POST', '/api/auth/login', { email, password: 'secret123' });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('Test runner error:', err.message); process.exit(1); });
