/**
 * Check your email settings by sending a test message.
 *
 *   npm run test-email -- you@example.com
 *
 * Reads SMTP_* and MAIL_FROM from .env, logs in to your email provider,
 * and sends one test email to the address you give. Explains common errors.
 */
try { process.loadEnvFile(); } catch { /* no .env — handled below */ }

const { smtpConfigured, verifyConnection, sendMail } = require('../src/services/mailer');

const to = process.argv[2];

(async () => {
  if (!smtpConfigured()) {
    console.error('\n✗ SMTP_HOST is empty. Add your email provider settings to .env first (see .env.example).\n');
    process.exit(1);
  }
  if (!to || !to.includes('@')) {
    console.error('\nUsage: npm run test-email -- you@example.com\n');
    process.exit(1);
  }

  console.log(`\nProvider: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587} as ${process.env.SMTP_USER || '(no login)'}`);
  try {
    process.stdout.write('1. Logging in to the email provider… ');
    await verifyConnection();
    console.log('OK');

    process.stdout.write(`2. Sending a test email to ${to}… `);
    await sendMail({
      to,
      subject: 'EduFlex email test',
      text: 'Your EduFlex email settings work. Students will now receive confirmation and password-reset emails.',
      html: '<p style="font-family:Arial,sans-serif">✅ Your <strong>EduFlex</strong> email settings work. Students will now receive confirmation and password-reset emails.</p>',
    });
    console.log('OK');
    console.log(`\n✓ Done. Check ${to} (and its spam folder). Then restart EduFlex with npm start.\n`);
  } catch (err) {
    console.log('FAILED\n');
    const hints = {
      EAUTH: 'The provider rejected the username/password. For Gmail, SMTP_PASS must be a 16-character App Password (not your normal password), and SMTP_USER your full Gmail address. For Brevo, use the SMTP login and SMTP key from Brevo → SMTP & API.',
      ESOCKET: 'Could not open a secure connection. Use SMTP_PORT=587 (or 465) and check SMTP_HOST is spelled correctly.',
      ECONNECTION: 'Could not reach the email server. Check SMTP_HOST / SMTP_PORT and your internet connection (some networks block port 587 — try 465).',
      ETIMEDOUT: 'The email server did not answer in time. Your network may block this port — try SMTP_PORT=465, or another network.',
      EDNS: `Could not find the server "${process.env.SMTP_HOST}". Check the spelling of SMTP_HOST.`,
      EENVELOPE: 'The provider refused the sender or recipient. Check MAIL_FROM is an address your provider allows you to send from.',
    };
    console.error(`✗ ${hints[err.code] || err.message}`);
    if (hints[err.code]) console.error(`  (details: ${err.message})`);
    console.error('');
    process.exit(1);
  }
})();
