// Adobe IMS OAuth Server-to-Server token client for Frame.io v4.
//
// Frame.io v4 API rejects legacy developer tokens. All requests must
// carry a bearer token obtained from Adobe IMS via the client_credentials
// grant against an Adobe Developer Console Server-to-Server credential.
//
// This module:
//   - Caches the access token in memory with proactive refresh ~5 min
//     before expiry
//   - Single-flights concurrent refresh attempts so we don't hit the IMS
//     endpoint multiple times during a token-flip window
//   - Fails loud on 4xx (likely bad creds → human action) and retries
//     once on 5xx / network blips
//
// Required env vars:
//   FRAMEIO_OAUTH_CLIENT_ID       Adobe Developer Console client ID
//   FRAMEIO_OAUTH_CLIENT_SECRET   Adobe Developer Console client secret
//   FRAMEIO_OAUTH_SCOPES          Space-separated scope list shown by
//                                 Adobe Developer Console for the
//                                 Frame.io v4 credential
//
// Optional env var:
//   FRAMEIO_OAUTH_IMS_ENDPOINT    Override IMS host (default
//                                 https://ims-na1.adobelogin.com).
//                                 Use a different region if Adobe
//                                 routed your account elsewhere.

const IMS_DEFAULT = 'https://ims-na1.adobelogin.com';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

let cachedToken = null;          // { accessToken, expiresAt }
let inflightRefresh = null;      // Promise<token> while a refresh is in progress

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env (required for Frame.io v4 OAuth)`);
  return v;
}

async function fetchNewToken() {
  const clientId = envOrThrow('FRAMEIO_OAUTH_CLIENT_ID');
  const clientSecret = envOrThrow('FRAMEIO_OAUTH_CLIENT_SECRET');
  const scopes = envOrThrow('FRAMEIO_OAUTH_SCOPES');
  const imsBase = process.env.FRAMEIO_OAUTH_IMS_ENDPOINT || IMS_DEFAULT;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: scopes,
  });

  const url = `${imsBase.replace(/\/$/, '')}/ims/token/v3`;

  // One retry on 5xx / network errors. 4xx fails fast (bad creds, bad
  // scope — needs human attention, retry won't help).
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (res.status >= 400 && res.status < 500) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Adobe IMS rejected credentials (${res.status}): ${errText.slice(0, 300)}`);
      }
      if (!res.ok) {
        lastErr = new Error(`Adobe IMS server error (${res.status})`);
        if (attempt === 2) throw lastErr;
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }

      const json = await res.json();
      if (!json.access_token || !json.expires_in) {
        throw new Error(`Adobe IMS response missing access_token or expires_in: ${JSON.stringify(json).slice(0, 300)}`);
      }

      const expiresAt = Date.now() + json.expires_in * 1000;
      return { accessToken: json.access_token, expiresAt };
    } catch (err) {
      lastErr = err;
      if (attempt === 2 || /rejected credentials/.test(err.message)) throw err;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

/**
 * Get a valid Frame.io v4 access token. Returns cached token if it has
 * more than REFRESH_BUFFER_MS remaining; otherwise refreshes.
 *
 * Single-flighted: concurrent callers during a refresh window all
 * receive the same in-flight Promise rather than triggering parallel
 * refreshes against IMS.
 *
 * @returns {Promise<string>} bearer access token
 */
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > REFRESH_BUFFER_MS) {
    return cachedToken.accessToken;
  }

  if (inflightRefresh) return (await inflightRefresh).accessToken;

  inflightRefresh = (async () => {
    try {
      const fresh = await fetchNewToken();
      cachedToken = fresh;
      return fresh;
    } finally {
      inflightRefresh = null;
    }
  })();

  return (await inflightRefresh).accessToken;
}

/**
 * Force a token refresh. Useful in scripts where you want to test that
 * the OAuth path works end-to-end without relying on cache state.
 */
async function forceRefresh() {
  cachedToken = null;
  inflightRefresh = null;
  return getAccessToken();
}

module.exports = { getAccessToken, forceRefresh };
