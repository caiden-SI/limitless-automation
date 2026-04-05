// Dropbox API client — thin wrapper over REST API.
// Auto-refreshes access token using app key/secret when expired.

const DROPBOX_BASE = 'https://api.dropboxapi.com/2';

let cachedToken = null;

/**
 * Get a valid access token — refreshes via app credentials if expired or missing.
 * Dropbox offline access tokens are refreshed at https://api.dropbox.com/oauth2/token.
 */
async function getAccessToken() {
  if (cachedToken) return cachedToken;
  cachedToken = process.env.DROPBOX_ACCESS_TOKEN;
  return cachedToken;
}

/**
 * Refresh the access token using DROPBOX_APP_KEY and DROPBOX_APP_SECRET.
 * Requires DROPBOX_REFRESH_TOKEN in .env (obtain once via OAuth flow).
 */
async function refreshAccessToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      'Dropbox access token expired and no DROPBOX_REFRESH_TOKEN configured. ' +
      'Generate one at https://www.dropbox.com/oauth2/authorize with token_access_type=offline'
    );
  }

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Dropbox token refresh failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  return cachedToken;
}

async function headers() {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Make a Dropbox API call with automatic token refresh on 401.
 */
async function dropboxFetch(url, opts = {}) {
  const hdrs = await headers();
  let res = await fetch(url, { ...opts, headers: { ...hdrs, ...opts.headers } });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    const retryHeaders = { ...hdrs, ...opts.headers, Authorization: `Bearer ${newToken}` };
    res = await fetch(url, { ...opts, headers: retryHeaders });
  }

  return res;
}

/**
 * Create a folder in Dropbox. No-op if folder already exists.
 * @param {string} path - Full Dropbox path (e.g., "/austin/My Video/[FOOTAGE]")
 * @returns {{ path: string, id: string } | null} - Folder metadata or null if already existed
 */
async function createFolder(path) {
  const res = await dropboxFetch(`${DROPBOX_BASE}/files/create_folder_v2`, {
    method: 'POST',
    body: JSON.stringify({ path, autorename: false }),
  });

  if (res.ok) {
    const data = await res.json();
    return { path: data.metadata.path_display, id: data.metadata.id };
  }

  const err = await res.json().catch(() => ({}));

  // "path/conflict/folder" means folder already exists — not an error
  if (err?.error?.path?.['.tag'] === 'conflict') {
    return null;
  }

  throw new Error(`Dropbox createFolder failed: ${err.error_summary || JSON.stringify(err)}`);
}

/**
 * List contents of a folder.
 * @param {string} path - Full Dropbox path
 * @returns {Array<{ name: string, tag: string, path: string }>}
 */
async function listFolder(path) {
  const res = await dropboxFetch(`${DROPBOX_BASE}/files/list_folder`, {
    method: 'POST',
    body: JSON.stringify({ path, recursive: false, limit: 100 }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Dropbox listFolder failed: ${err.error_summary || JSON.stringify(err)}`);
  }

  const data = await res.json();
  return data.entries.map((e) => ({
    name: e.name,
    tag: e['.tag'],
    path: e.path_display,
  }));
}

/**
 * Download a file's contents as a Buffer.
 * Uses the content endpoint (not the API endpoint).
 * @param {string} path - Full Dropbox path to the file
 * @returns {Promise<Buffer>}
 */
async function downloadFile(path) {
  const token = await getAccessToken();
  let res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${newToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    });
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Dropbox downloadFile failed (${res.status}): ${err.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Get a temporary download link for a file.
 * Useful for passing to FFmpeg which needs a URL or local path.
 * @param {string} path - Full Dropbox path
 * @returns {Promise<string>} Temporary direct download URL (valid ~4 hours)
 */
async function getTemporaryLink(path) {
  const res = await dropboxFetch(`${DROPBOX_BASE}/files/get_temporary_link`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Dropbox getTemporaryLink failed: ${err.error_summary || JSON.stringify(err)}`);
  }

  const data = await res.json();
  return data.link;
}

module.exports = { createFolder, listFolder, downloadFile, getTemporaryLink };
