/**
 * Promote an existing account to admin (owner setup).
 *
 *   npm run make-admin -- you@example.com
 *
 * The account must already exist — register it through the app first.
 * Safe to run while the server is running (SQLite busy_timeout handles locking).
 */
const { db, nowISO } = require('../src/db');

const email = String(process.argv[2] || '').toLowerCase().trim();
if (!email) {
  console.error('Usage: npm run make-admin -- <email>');
  process.exit(1);
}

const user = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`No account found for ${email}. Register it in the app first, then run this again.`);
  process.exit(1);
}

db.prepare(`UPDATE users SET role = 'admin', account_status = 'active', updated_at = ? WHERE id = ?`)
  .run(nowISO(), user.id);
console.log(user.role === 'admin'
  ? `${email} was already an admin (account kept active).`
  : `${email} is now an admin. Sign in and open /app.html#/admin.`);
