// Dropbox API client — thin wrapper over REST API.
// Uses long-lived access token from .env. If token expires, see docs/decisions.md
// for refresh token flow.

const DROPBOX_BASE = 'https://api.dropboxapi.com/2';

function headers() {
  return {
    Authorization: `Bearer ${process.env.DROPBOX_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Create a folder in Dropbox. No-op if folder already exists.
 * @param {string} path - Full Dropbox path (e.g., "/austin/My Video/[FOOTAGE]")
 * @returns {{ path: string, id: string } | null} - Folder metadata or null if already existed
 */
async function createFolder(path) {
  const res = await fetch(`${DROPBOX_BASE}/files/create_folder_v2`, {
    method: 'POST',
    headers: headers(),
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
  const res = await fetch(`${DROPBOX_BASE}/files/list_folder`, {
    method: 'POST',
    headers: headers(),
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

module.exports = { createFolder, listFolder };
