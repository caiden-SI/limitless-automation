// Frame.io v4 REST client. Migrated from v2 on 2026-05-08 because the
// v2 webhook UI doesn't recognize v4 teams (Scott's account is on v4).
//
// Auth: Adobe IMS OAuth bearer token via lib/frameio-oauth.js. The
// legacy FRAMEIO_API_TOKEN env var is no longer used and can be removed
// from .env once the migration is verified end-to-end.
//
// All endpoints nest under /v4/. Webhook ops additionally nest under
// /accounts/{account_id}/workspaces/{workspace_id}/ — those IDs come
// from FRAMEIO_ACCOUNT_ID and FRAMEIO_WORKSPACE_ID env vars.
//
// Methods exported: createShareLink (preserved from v2 — endpoint
// shape may need verification in v4), webhook CRUD (new), and
// extractAssetIdFromUrl (preserved).

const { getAccessToken } = require('./frameio-oauth');

const FRAMEIO_V4_BASE = 'https://api.frame.io/v4';

async function frameioFetch(path, opts = {}) {
  const token = await getAccessToken();

  const res = await fetch(`${FRAMEIO_V4_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Frame.io v4 ${opts.method || 'GET'} ${path} failed (${res.status}): ${body.slice(0, 500)}`
    );
  }

  // 204 No Content on DELETE has no body
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Webhook CRUD
// ---------------------------------------------------------------------------

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env (required for Frame.io v4 webhook ops)`);
  return v;
}

/**
 * Register a new webhook on the configured workspace. Returns the
 * full response including the signing secret, which is ONLY exposed
 * in this initial create response and must be persisted by the caller.
 *
 * @param {object} input
 * @param {string} input.name           Human-readable webhook name
 * @param {string} input.url            Public HTTPS endpoint receiving the events
 * @param {string[]} input.events       Event types, e.g. ['comment.created']
 * @returns {Promise<{ id, name, url, events, signing_secret, ... }>}
 */
async function createWebhook({ name, url, events }) {
  if (!name || !url || !Array.isArray(events) || events.length === 0) {
    throw new Error('createWebhook: name, url, and events[] are all required');
  }
  const accountId = envOrThrow('FRAMEIO_ACCOUNT_ID');
  const workspaceId = envOrThrow('FRAMEIO_WORKSPACE_ID');

  return frameioFetch(
    `/accounts/${accountId}/workspaces/${workspaceId}/webhooks`,
    {
      method: 'POST',
      body: JSON.stringify({ data: { name, url, events } }),
    }
  );
}

/**
 * List all webhooks on the configured workspace.
 */
async function listWebhooks() {
  const accountId = envOrThrow('FRAMEIO_ACCOUNT_ID');
  const workspaceId = envOrThrow('FRAMEIO_WORKSPACE_ID');
  return frameioFetch(`/accounts/${accountId}/workspaces/${workspaceId}/webhooks`);
}

/**
 * Fetch one webhook by ID. Note: signing_secret is NOT returned here,
 * only on initial creation.
 */
async function getWebhook(webhookId) {
  if (!webhookId) throw new Error('getWebhook: webhookId required');
  return frameioFetch(`/webhooks/${webhookId}`);
}

/**
 * Update a webhook (url, events, is_active).
 */
async function updateWebhook(webhookId, patch) {
  if (!webhookId) throw new Error('updateWebhook: webhookId required');
  return frameioFetch(`/webhooks/${webhookId}`, {
    method: 'PATCH',
    body: JSON.stringify({ data: patch }),
  });
}

/**
 * Delete a webhook. Stops deliveries immediately.
 */
async function deleteWebhook(webhookId) {
  if (!webhookId) throw new Error('deleteWebhook: webhookId required');
  return frameioFetch(`/webhooks/${webhookId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Share links (preserved from v2 — endpoint may need verification in v4)
// ---------------------------------------------------------------------------

/**
 * Create a client-facing share link for a file (formerly "asset" in v2).
 *
 * NOTE: The v2 share_links endpoint shape is preserved here on faith.
 * If v4 changed the endpoint path or body schema, this call will 404 or
 * 422 and need updating. The v4 docs available at migration time
 * focused on webhooks, so verify share_link behavior on first call
 * against a real file.
 */
async function createShareLink(fileId, options = {}) {
  if (!fileId) throw new Error('createShareLink: fileId is required');

  const body = {
    name: options.name || 'Client Share Link',
    password_protected: options.passwordProtected ?? false,
    expires_at: options.expiresAt ?? null,
    allow_downloading: options.allowDownloading ?? false,
  };

  // v2 path was /assets/{id}/share_links — keeping under /files/{id}/share_links
  // in v4 since assets were renamed to files. Update if 404s.
  const data = await frameioFetch(`/files/${fileId}/share_links`, {
    method: 'POST',
    body: JSON.stringify({ data: body }),
  });

  const url =
    data?.data?.short_url ||
    data?.data?.url ||
    data?.short_url ||
    data?.url ||
    (data?.data?.id ? `https://app.frame.io/shares/${data.data.id}` : null);

  if (!url) {
    throw new Error(
      `Frame.io v4 share_link response missing URL field: ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  return { url, id: data?.data?.id || data?.id, raw: data };
}

// ---------------------------------------------------------------------------
// URL parsing (preserved — both v2 and v4 URL shapes covered)
// ---------------------------------------------------------------------------

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_REGEX_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Extract a Frame.io file/asset UUID from a URL pasted into ClickUp's
 * "E - Frame Link" custom field. Handles both the legacy app.frame.io
 * URL shapes and the v4 next.frame.io shapes.
 */
function extractAssetIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;

  if (/\bf\.io\//i.test(url)) return null;
  if (/\/(presentations|share)\//i.test(url)) return null;

  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/)[0];
  }

  // Both legacy /player|view|files/ and new /files|projects/.../files/ prefixes
  for (const kw of ['player', 'view', 'files']) {
    const re = new RegExp(`/${kw}/(${UUID_REGEX.source})`, 'i');
    const m = pathname.match(re);
    if (m) return m[1].toLowerCase();
  }

  const matches = pathname.match(UUID_REGEX_GLOBAL);
  if (matches && matches.length) return matches[matches.length - 1].toLowerCase();

  return null;
}

module.exports = {
  // Webhook ops
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  // Share links
  createShareLink,
  // Helpers
  extractAssetIdFromUrl,
};
