/**
 * Test runner — `npm test`.
 *
 * Runs every test suite against a THROWAWAY database and uploads folder in the
 * system temp directory, on its own server and port. Real data (data/eduflex.db,
 * uploads/) and any running EduFlex server are never touched. AI is switched off
 * (empty API key), so tests never make paid Claude calls, and email is written to a
 * file instead of being sent. Everything is deleted afterwards.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Ask the OS for a free port. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

/** Run a node script, inheriting output; resolves with its exit code. */
function runNode(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: ROOT, env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * Stand-in for Google's token endpoint. The test passes the ID-token claims it wants,
 * base64url-encoded, as the "code"; the stub returns them as an (unsigned) ID token.
 */
function startGoogleStub(port, clientId) {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const code = new URLSearchParams(body).get('code') || '';
      let claims;
      try { claims = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')); }
      catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"invalid_grant"}'); }
      const payload = {
        iss: 'https://accounts.google.com', aud: clientId, exp: Math.floor(Date.now() / 1000) + 3600, ...claims,
      };
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id_token: `${b64({ alg: 'none' })}.${b64(payload)}.sig` }));
    });
  });
  return new Promise(resolve => srv.listen(port, () => resolve(srv)));
}

async function waitForServer(url, server, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('Test server exited during startup');
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Test server did not start in time');
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eduflex-test-'));
  const port = await freePort();
  const googlePort = await freePort();
  const env = {
    ...process.env,
    EDUFLEX_TEST_RUN: '1',
    EDUFLEX_DB_PATH: path.join(tmp, 'test.db'),
    EDUFLEX_UPLOAD_DIR: path.join(tmp, 'uploads'),
    PORT: String(port),
    BASE_URL: `http://localhost:${port}`,
    SESSION_SECRET: 'eduflex-test-secret',
    // Set but empty: overrides any key in .env, so AI stays off during tests
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    // Email: never really sent in tests (SMTP off); each message is written to an outbox file instead
    SMTP_HOST: '',
    EDUFLEX_MAIL_OUTBOX: path.join(tmp, 'outbox.jsonl'),
    APP_URL: `http://localhost:${port}`,
    EDUFLEX_SKIP_MX_CHECK: '1', // test domains have no real mail servers
    EDUFLEX_REQUIRE_EDU_EMAIL: '', // default: any email is allowed
    // Google sign-in against a local stub (never the real Google)
    GOOGLE_CLIENT_ID: 'eduflex-test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    EDUFLEX_GOOGLE_TOKEN_URL: `http://localhost:${googlePort}/token`,
  };
  console.log(`\nTest database: ${env.EDUFLEX_DB_PATH}\nTest server:   ${env.BASE_URL}\n`);

  let server = null;
  let failed = 0;
  const googleStub = await startGoogleStub(googlePort, env.GOOGLE_CLIENT_ID);
  try {
    // Offline unit tests (no server needed)
    if (await runNode('tests/aiRoadmap.test.js', env) !== 0) failed++;

    // API tests against a dedicated server on the throwaway database
    server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] });
    await waitForServer(`${env.BASE_URL}/`, server);
    if (await runNode('tests/api.test.js', env) !== 0) failed++;
  } catch (err) {
    console.error('Test run error:', err.message);
    failed++;
  } finally {
    if (server && server.exitCode === null) {
      await new Promise(resolve => { server.on('exit', resolve); server.kill(); });
    }
    googleStub.close();
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (err) { console.warn(`Could not remove ${tmp}: ${err.message}`); }
  }

  console.log(failed ? `\n❌ ${failed} test suite(s) failed\n` : '\n✅ All test suites passed\n');
  process.exit(failed ? 1 : 0);
})();
