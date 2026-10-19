/**
 * Outgoing email (verification + password reset links).
 *
 * Real sending: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM in .env
 * (any SMTP provider works — e.g. Gmail with an app password, Brevo, SendGrid, Mailgun).
 *
 * Without SMTP settings (local development) the email is printed to the server
 * console instead, so the link can still be clicked. The test runner also sets
 * EDUFLEX_MAIL_OUTBOX, a file each email is appended to as one JSON line.
 */
const fs = require('fs');
const nodemailer = require('nodemailer');

let transport = null;

function smtpConfigured() {
  return !!process.env.SMTP_HOST;
}

function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 465 = TLS from the start; 587 upgrades with STARTTLS
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

async function sendMail({ to, subject, text, html }) {
  if (process.env.EDUFLEX_MAIL_OUTBOX) {
    fs.appendFileSync(process.env.EDUFLEX_MAIL_OUTBOX, JSON.stringify({ to, subject, text }) + '\n');
  }
  if (!smtpConfigured()) {
    if (!process.env.EDUFLEX_MAIL_OUTBOX) {
      console.log(`\n📧 Email (SMTP not configured — shown here instead)\n   To: ${to}\n   Subject: ${subject}\n\n${text}\n`);
    }
    return;
  }
  await getTransport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to, subject, text, html,
  });
}

/** Base URL for links in emails: APP_URL in production, otherwise the address the request came in on. */
function appUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

/* ---------- templates ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, bodyHtml, buttonText, link) {
  return `<!doctype html><html><body style="margin:0;background:#faf7f1;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;font-weight:bold;color:#2f4579;margin-bottom:20px">🎓 EduFlex</div>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
      ${bodyHtml}
      <p style="margin:24px 0"><a href="${esc(link)}" style="background:#2f4579;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">${esc(buttonText)}</a></p>
      <p style="font-size:12px;color:#64748b;margin:0">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
    </div>
    <p style="font-size:12px;color:#94a3b8;margin-top:16px">If you didn't request this, you can ignore this email.</p>
  </div></body></html>`;
}

async function sendVerificationEmail(user, link) {
  await sendMail({
    to: user.email,
    subject: 'Confirm your EduFlex email',
    text: `Hi ${user.first_name},\n\nConfirm your email to activate your EduFlex account:\n${link}\n\nThis link expires in 24 hours. If you didn't sign up, ignore this email.`,
    html: layout('Confirm your email',
      `<p style="margin:0;line-height:1.6">Hi ${esc(user.first_name)}, welcome to EduFlex! Confirm your university email to activate your account. This link expires in 24 hours.</p>`,
      'Confirm my email', link),
  });
}

async function sendPasswordResetEmail(user, link) {
  await sendMail({
    to: user.email,
    subject: 'Reset your EduFlex password',
    text: `Hi ${user.first_name},\n\nReset your EduFlex password here:\n${link}\n\nThis link expires in 1 hour and can be used once. If you didn't ask for this, ignore this email — your password stays the same.`,
    html: layout('Reset your password',
      `<p style="margin:0;line-height:1.6">Hi ${esc(user.first_name)}, we received a request to reset your password. This link expires in 1 hour and can be used once.</p>`,
      'Choose a new password', link),
  });
}

/** Check the SMTP login without sending anything (used by `npm run test-email`). */
async function verifyConnection() {
  return getTransport().verify();
}

module.exports = { sendMail, smtpConfigured, verifyConnection, appUrl, sendVerificationEmail, sendPasswordResetEmail };
