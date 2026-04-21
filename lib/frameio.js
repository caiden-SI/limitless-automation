// Frame.io v2 REST client — thin wrapper over the v2 API.
//
// Auth: developer token in FRAMEIO_API_TOKEN. Long-lived per
// docs/decisions.md 2026-04-02. v4 (Adobe OAuth Server-to-Server) is
// documented but not used.
//
// Methods intentionally minimal: this file only needs to support what the
// Pipeline Agent calls today. Upload, comments, and other v2 endpoints are
// out of scope — add them in their own workflows.

const FRAMEIO_V2_BASE = 'https://api.frame.io/v2';

async function frameioFetch(path, opts = {}) {
  const token = process.env.FRAMEIO_API_TOKEN;
  if (!token) throw new Error('FRAMEIO_API_TOKEN not set in .env');

  const res = await fetch(`${FRAMEIO_V2_BASE}${path}`, {
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
      `Frame.io ${opts.method || 'GET'} ${path} failed (${res.status}): ${body.slice(0, 500)}`
    );
  }

  return res.json();
}

/**
 * Create a client-facing share link for an asset.
 *
 * v2 endpoint: POST /assets/{asset_id}/share_links — per docs/integrations.md.
 * workflows/frame-io-share-link.md line 60 flags an ambiguity between this and
 * /review_links depending on the account; if this endpoint 404s in live
 * testing, flip to /review_links.
 *
 * @param {string} assetId - Frame.io asset UUID
 * @param {object} [options]
 * @param {string} [options.name] - Link name shown in the Frame.io UI
 * @param {boolean} [options.passwordProtected=false]
 * @param {string|null} [options.expiresAt=null] - ISO timestamp
 * @param {boolean} [options.allowDownloading=false]
 * @returns {Promise<{ url: string, id: string, raw: object }>}
 */
async function createShareLink(assetId, options = {}) {
  if (!assetId) throw new Error('createShareLink: assetId is required');

  const body = {
    name: options.name || 'Client Share Link',
    password_protected: options.passwordProtected ?? false,
    expires_at: options.expiresAt ?? null,
    allow_downloading: options.allowDownloading ?? false,
  };

  const data = await frameioFetch(`/assets/${assetId}/share_links`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  // v2 returns short_url (https://f.io/xxx). Some accounts also populate a
  // longer app.frame.io URL — prefer whichever is present.
  const url = data.short_url || data.url || (data.id ? `https://app.frame.io/shares/${data.id}` : null);

  if (!url) {
    throw new Error(
      `Frame.io share_link response missing URL field: ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  return { url, id: data.id, raw: data };
}

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_REGEX_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Extract a Frame.io asset UUID from a URL pasted into ClickUp's
 * "E - Frame Link" custom field.
 *
 * Handles the common app.frame.io URL shapes:
 *   https://app.frame.io/player/{asset_id}
 *   https://app.frame.io/player/{asset_id}?version=...
 *   https://app.frame.io/reviews/{review_id}/{asset_id}
 *   https://app.frame.io/projects/{project_id}/view/{asset_id}
 *   https://app.frame.io/projects/{project_id}/files/{asset_id}
 *
 * Returns null for opaque or non-asset URLs:
 *   - f.io/xxx short URLs (would require following a redirect)
 *   - /presentations/ and /share/ pages (the UUID is a presentation/share id,
 *     not an asset id — resolving requires a separate Frame.io API call)
 *   - URLs with no UUID
 *
 * Case-insensitive. Returns the UUID lowercased for stable DB comparison.
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

  for (const kw of ['player', 'view', 'files']) {
    const re = new RegExp(`/${kw}/(${UUID_REGEX.source})`, 'i');
    const m = pathname.match(re);
    if (m) return m[1].toLowerCase();
  }

  const matches = pathname.match(UUID_REGEX_GLOBAL);
  if (matches && matches.length) return matches[matches.length - 1].toLowerCase();

  return null;
}

module.exports = { createShareLink, extractAssetIdFromUrl };
