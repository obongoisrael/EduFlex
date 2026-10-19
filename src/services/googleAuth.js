/**
 * Sign in with Google (OAuth 2.0 / OpenID Connect, authorization-code flow).
 *
 * Setup: create an OAuth client ("Web application") in Google Cloud Console and put
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env. The authorized redirect URI is
 *   <APP_URL>/api/auth/google/callback   (e.g. http://localhost:3000/api/auth/google/callback)
 *
 * The ID token is fetched by the server directly from Google's token endpoint over
 * HTTPS, so (per OpenID Connect Core §3.1.3.7) TLS authenticates the issuer; we then
 * check audience, issuer, expiry, nonce and that Google has verified the email.
 */
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
// Overridable only so the test suite can point at a local stub instead of Google.
const TOKEN_URL = process.env.EDUFLEX_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

const randomToken = () => crypto.randomBytes(24).toString('base64url');

/** URL that sends the browser to Google's account chooser. */
function authorizationUrl({ redirectUri, state, nonce }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

/** Decode a JWT payload (signature not needed here — see file header). */
function decodeJwtPayload(jwt) {
  const part = String(jwt || '').split('.')[1];
  if (!part) throw new Error('Malformed ID token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/**
 * Exchange the one-time code for the user's Google identity.
 * Returns { sub, email, given_name, family_name, name } or throws with a short reason.
 */
async function exchangeCode({ code, redirectUri, nonce }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error(`token exchange failed (${res.status} ${data.error || ''})`.trim());

  const claims = decodeJwtPayload(data.id_token);
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('ID token audience mismatch');
  if (!ISSUERS.includes(claims.iss)) throw new Error('ID token issuer mismatch');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('ID token expired');
  if (!nonce || claims.nonce !== nonce) throw new Error('ID token nonce mismatch');
  if (!claims.sub || !claims.email) throw new Error('ID token missing account details');
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    const err = new Error('Google email not verified');
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }
  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    given_name: claims.given_name || '',
    family_name: claims.family_name || '',
    name: claims.name || '',
  };
}

module.exports = { googleConfigured, authorizationUrl, exchangeCode, randomToken };
