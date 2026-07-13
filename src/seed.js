/**
 * Seed realistic placeholder data for demonstration.
 * Runs automatically on first launch (when the users table is empty).
 *
 * Demo account:  demo@eduflex.app  /  demo1234
 */
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { db, nowISO, fmtLocal, makePublicUsername } = require('./db');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

/**
 * Build a minimal one-page PDF (no external libraries) so seeded resources
 * are real PDFs that open in the browser, matching the PDF-only upload rule.
 */
function makeSimplePdf(title, lines) {
  const escText = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let content = `BT /F1 16 Tf 72 720 Td (${escText(title)}) Tj ET\n`;
  let y = 688;
  for (const line of lines) {
    content += `BT /F1 11 Tf 72 ${y} Td (${escText(line)}) Tj ET\n`;
    y -= 18;
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return false;

  console.log('Seeding demo data...');
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ts = nowISO();

  const insertUser = db.prepare(
    `INSERT INTO users (first_name, last_name, public_username, email, password_hash, institution, programme, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const hash = bcrypt.hashSync('demo1234', 10);

  const demoId = Number(insertUser.run('Jane', 'Smith', makePublicUsername('Jane', 'Smith'),
    'demo@eduflex.app', hash, 'Kenyatta University', 'BSc Computer Science', ts, ts).lastInsertRowid);
  const peerId = Number(insertUser.run('Ali', 'Khan', makePublicUsername('Ali', 'Khan'),
    'ali@eduflex.app', hash, 'University of Nairobi', 'BSc Information Technology', ts, ts).lastInsertRowid);
  const peer2Id = Number(insertUser.run('Mary', 'Otieno', makePublicUsername('Mary', 'Otieno'),
    'mary@eduflex.app', hash, 'Strathmore University', 'BBIT', ts, ts).lastInsertRowid);

  // ---- Courses for the demo user ----
  const insertCourse = db.prepare(
    'INSERT INTO courses (user_id, title, code, difficulty, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  );
  const courses = [
    ['Data Structures and Algorithms', 'CSC 211', 'Hard', 'Trees, graphs, sorting, complexity analysis.'],
    ['Database Systems', 'CSC 224', 'Moderate', 'Relational model, SQL, normalization, transactions.'],
    ['Operating Systems', 'CSC 301', 'Hard', 'Processes, memory management, file systems.'],
    ['Communication Skills', 'COM 101', 'Easy', 'Academic writing and presentation skills.'],
  ].map(([title, code, diff, desc]) =>
    Number(insertCourse.run(demoId, title, code, diff, desc, ts, ts).lastInsertRowid));

  // ---- Deadlines (relative to today so the demo always looks fresh) ----
  const insertDeadline = db.prepare(
    `INSERT INTO deadlines (user_id, course_id, title, type, due_date, priority, estimated_hours, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  const inDays = (d, h = 17) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return fmtLocal(x); };
  insertDeadline.run(demoId, courses[0], 'Graph Algorithms Assignment', 'Assignment', inDays(3), 'High', 6, 'Pending', ts, ts);
  insertDeadline.run(demoId, courses[1], 'SQL Practical CAT', 'CAT/Test', inDays(5, 9), 'High', 4, 'Pending', ts, ts);
  insertDeadline.run(demoId, courses[2], 'OS Scheduling Project', 'Project', inDays(10), 'Medium', 10, 'Pending', ts, ts);
  insertDeadline.run(demoId, courses[3], 'Group Presentation', 'Presentation', inDays(7, 14), 'Low', 2, 'Pending', ts, ts);
  insertDeadline.run(demoId, courses[1], 'ER Modelling Assignment', 'Assignment', inDays(-2), 'Medium', 3, 'Completed', ts, ts);

  // ---- Availability slots (Mon-Sat evenings + weekend mornings) ----
  const insertSlot = db.prepare(
    `INSERT INTO availability_slots (user_id, day_of_week, start_time, end_time, study_intensity, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  );
  insertSlot.run(demoId, 1, '18:00', '21:00', 'Deep Focus', ts, ts); // Monday
  insertSlot.run(demoId, 2, '19:00', '21:00', 'Normal', ts, ts);     // Tuesday
  insertSlot.run(demoId, 3, '18:00', '20:30', 'Normal', ts, ts);     // Wednesday
  insertSlot.run(demoId, 4, '19:00', '21:00', 'Light', ts, ts);      // Thursday
  insertSlot.run(demoId, 6, '09:00', '13:00', 'Deep Focus', ts, ts); // Saturday
  insertSlot.run(demoId, 0, '14:00', '17:00', 'Normal', ts, ts);     // Sunday

  // ---- A few past study sessions so Progress has history ----
  const insertSession = db.prepare(
    `INSERT INTO study_sessions (user_id, course_id, deadline_id, title, start_datetime, end_datetime, status, study_intensity, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const past = (d, h, len) => {
    const s = new Date(); s.setDate(s.getDate() - d); s.setHours(h, 0, 0, 0);
    const e = new Date(s.getTime() + len * 3600000);
    return [fmtLocal(s), fmtLocal(e)];
  };
  let [s, e] = past(1, 18, 1.5);
  insertSession.run(demoId, courses[0], null, 'CSC 211: revision — trees & heaps', s, e, 'Completed', 'Deep Focus', '', ts, ts);
  [s, e] = past(2, 19, 2);
  insertSession.run(demoId, courses[1], null, 'CSC 224: SQL joins practice', s, e, 'Completed', 'Normal', '', ts, ts);
  [s, e] = past(3, 18, 1);
  insertSession.run(demoId, courses[2], null, 'CSC 301: process scheduling notes', s, e, 'Missed', 'Normal', '', ts, ts);
  [s, e] = past(5, 9, 2);
  insertSession.run(demoId, courses[0], null, 'CSC 211: graph traversal drills', s, e, 'Completed', 'Deep Focus', '', ts, ts);

  // ---- Completed focus sessions for weekly stats ----
  const insertFocus = db.prepare(
    `INSERT INTO focus_sessions (user_id, course_id, study_session_id, title, study_duration_minutes,
       break_duration_minutes, completed_duration_minutes, status, started_at, completed_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const dAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
  insertFocus.run(demoId, courses[0], null, 'Pomodoro: algorithms', 25, 5, 50, 'Completed', dAgo(1), dAgo(1), ts);
  insertFocus.run(demoId, courses[1], null, 'Pomodoro: SQL revision', 25, 5, 25, 'Completed', dAgo(2), dAgo(2), ts);

  // ---- Shared resources (placeholder files, uploaded by several students) ----
  const insertResource = db.prepare(
    `INSERT INTO resources (user_id, title, description, course_name, course_code, category, institution,
       public_username, file_url, file_original_name, file_type, file_size, upvotes_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const sampleResources = [
    [peerId, 'AK', 'University of Nairobi', 'Data Structures Summary Notes', 'Concise revision notes covering arrays, linked lists, trees and graphs.', 'Data Structures and Algorithms', 'CSC 211', 'Notes'],
    [peerId, 'AK', 'University of Nairobi', 'DBMS Past Paper 2024', 'End-of-semester examination paper with marking hints.', 'Database Systems', 'CSC 224', 'Past Paper'],
    [peer2Id, 'MO', 'Strathmore University', 'Operating Systems Lecture Slides Week 1-6', 'Slides covering processes, threads and CPU scheduling.', 'Operating Systems', 'CSC 301', 'Slides'],
    [peer2Id, 'MO', 'Strathmore University', 'Academic Writing Assignment Guide', 'Step-by-step guide for structuring academic essays.', 'Communication Skills', 'COM 101', 'Assignment Guide'],
    [demoId, 'JS', 'Kenyatta University', 'SQL Cheat Sheet', 'One-page reference for SELECT, JOIN, GROUP BY and subqueries.', 'Database Systems', 'CSC 224', 'Notes'],
  ];
  let votes = 0;
  const insertVote = db.prepare('INSERT INTO resource_votes (user_id, resource_id, created_at) VALUES (?,?,?)');
  for (const [uid, initials, inst, title, desc, cname, ccode, cat] of sampleResources) {
    // create a small real PDF so viewing AND downloading work out of the box
    const fname = `seed-${Math.random().toString(36).slice(2, 10)}.pdf`;
    const body = makeSimplePdf(title, [
      desc,
      '',
      `Course: ${cname} (${ccode})`,
      `Category: ${cat}`,
      `Shared on EduFlex by ${initials} — ${inst}`,
      '',
      '(Placeholder demonstration file.)',
    ]);
    fs.writeFileSync(path.join(UPLOAD_DIR, fname), body);
    const rid = Number(insertResource.run(uid, title, desc, cname, ccode, cat, inst, initials,
      fname, `${title.replace(/[^a-z0-9]+/gi, '_')}.pdf`, 'pdf', body.length, 0, ts, ts).lastInsertRowid);
    // sprinkle some upvotes
    const voters = [demoId, peerId, peer2Id].filter(() => Math.random() > 0.4);
    for (const v of voters) {
      try { insertVote.run(v, rid, ts); votes++; } catch { /* unique constraint */ }
    }
    db.prepare('UPDATE resources SET upvotes_count = (SELECT COUNT(*) FROM resource_votes WHERE resource_id = ?) WHERE id = ?').run(rid, rid);
  }

  console.log(`Seed complete: 3 users, 4 courses, 5 deadlines, 6 availability slots, sample sessions & ${sampleResources.length} resources.`);
  console.log('Demo login: demo@eduflex.app / demo1234');
  return true;
}

module.exports = { seedIfEmpty };

// Allow "npm run seed" to force-run standalone
if (require.main === module) seedIfEmpty();
