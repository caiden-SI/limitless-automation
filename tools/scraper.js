// Scraper tool — calls Apify actors to scrape TikTok, Instagram, YouTube content.
// Uses Apify REST API directly (no SDK). Requires APIFY_API_TOKEN in .env.
//
// Two scraping modes are exposed:
//
//   1. scrapeProfileVideos / scrapeTikTok / scrapeInstagram (legacy)
//      Channel-level — feeds in a profile URL or hashtag query and returns
//      whatever the platform shows on that page. Used by the Onboarding
//      Agent (Section 3) to fetch transcripts of an influencer's recent posts.
//
//   2. scrapeVideosByUrls (URL-based)
//      Used by the Profile Views Agent rebuild (docs/profile-views-rebuild-spec.md).
//      Takes a list of post URLs and returns one item per URL with the
//      current cumulative viewCount, likes, shares. Same actors but the
//      input shape (postURLs / directUrls / startUrls) targets specific
//      posts, so pinned-video distortion and partial-channel-coverage gaps
//      go away.
//
// Actor IDs (verified during 2026-05-08 manual recovery):
//   TikTok:    clockworks~tiktok-scraper        ($3 / 1k results, paid)
//   Instagram: apify~instagram-scraper          ($2.70 / 1k results)
//   YouTube:   streamers~youtube-scraper        ($3 / 1k videos)
//
// The legacy `scrapeProfileVideos` continues to use the FREE TikTok scraper
// (clockworks~free-tiktok-scraper) because Onboarding only needs channel
// browsing, not per-URL scrapes — keeping it on the free tier avoids
// burning Apify credits on transcript discovery.

const APIFY_BASE = 'https://api.apify.com/v2';

function apifyHeaders() {
  return {
    Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Run an Apify actor synchronously and return the dataset items.
 * @param {string} actorId - e.g. "clockworks~tiktok-scraper"
 * @param {object} input - Actor input payload
 * @param {number} [timeoutSecs=120] - Max wait time
 * @returns {Promise<Array<object>>}
 */
async function runActor(actorId, input, timeoutSecs = 120) {
  if (!process.env.APIFY_API_TOKEN) {
    throw new Error('APIFY_API_TOKEN not set — cannot run scraper');
  }

  const res = await fetch(
    `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?timeout=${timeoutSecs}`,
    {
      method: 'POST',
      headers: apifyHeaders(),
      body: JSON.stringify(input),
    }
  );

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Apify actor ${actorId} failed (${res.status}): ${err.slice(0, 300)}`);
  }

  return res.json();
}

/**
 * Canonicalize a post URL for matching against scraped output.
 *
 * Rules:
 *   - Strip query string and fragment (`?is_from_webapp=...`, `?img_index=1`,
 *     `#section`)
 *   - Lowercase host
 *   - Strip trailing slashes
 *   - Instagram: rewrite `/reel/<code>` → `/p/<code>` so reels match the
 *     posts shape Apify normalizes its `url` output to
 *
 * Returns null for unparseable input or non-http(s) protocols. Both the
 * stored `videos.post_url_<platform>` and the Apify-returned `url` go
 * through this same function so a stored URL canonicalizes identically to
 * its scraped counterpart, which is the whole point of having a separate
 * helper.
 *
 * Sibling implementations: `agents/profile-views.canonicalizePostUrl`,
 * `scripts/sync-performance-tracker.canonicalizeUrl`,
 * `scripts/backfill-post-urls.canonicalizeUrl`. The platform-aware variant
 * here is the one new code should use; the others stay for backward
 * compatibility with their callers but should drift toward this rule.
 *
 * @param {string} url
 * @param {'tiktok'|'instagram'|'youtube'|'twitter'} [platform]
 * @returns {string|null}
 */
function canonicalizePostUrl(url, platform) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.host) return null;
  u.search = '';
  u.hash = '';
  let pathname = u.pathname;
  if (platform === 'instagram') {
    // /reel/<code>/ and /p/<code>/ point at the same post; Apify's `url`
    // output normalizes to /p/, so we do the same on the input side.
    pathname = pathname.replace(/^\/reel\//i, '/p/');
  }
  return `${u.protocol}//${u.host.toLowerCase()}${pathname}`.replace(/\/+$/, '');
}

/**
 * Detect the platform from a post URL host. Used by the sheet-pull
 * direction where the operator pasted a URL and the Platform column may
 * disagree (URL is the ground truth; column is a label).
 *
 * @param {string} url
 * @returns {'tiktok'|'instagram'|'youtube'|'twitter'|null}
 */
function detectPlatformFromUrl(url) {
  if (!url) return null;
  let host;
  try {
    host = new URL(String(url).trim()).host.toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith('tiktok.com')) return 'tiktok';
  if (host.endsWith('instagram.com')) return 'instagram';
  if (host.endsWith('youtube.com') || host.endsWith('youtu.be')) return 'youtube';
  if (host.endsWith('twitter.com') || host === 'x.com' || host.endsWith('.x.com')) return 'twitter';
  return null;
}

/**
 * Scrape top-performing TikTok videos for given search queries.
 * Channel-mode (free actor) — used by Onboarding for transcript discovery.
 */
async function scrapeTikTok(queries, maxResults = 20) {
  const items = await runActor('clockworks~free-tiktok-scraper', {
    searchQueries: queries,
    resultsPerPage: maxResults,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  });

  return items.map((item) => ({
    url: item.webVideoUrl || item.url || `https://www.tiktok.com/@${item.authorMeta?.name}/video/${item.id}`,
    description: item.text || item.desc || '',
    viewCount: item.playCount || item.stats?.playCount || 0,
    transcript: item.subtitleText || item.transcript || null,
    platform: 'tiktok',
    author: item.authorMeta?.name || item.author || null,
    likes: item.diggCount || item.stats?.diggCount || 0,
    shares: item.shareCount || item.stats?.shareCount || 0,
  }));
}

/**
 * Scrape top-performing Instagram Reels for given hashtags/queries.
 * Channel-mode — used by Onboarding for transcript discovery.
 */
async function scrapeInstagram(queries, maxResults = 20) {
  const items = await runActor('apify~instagram-scraper', {
    search: queries.join(', '),
    searchType: 'hashtag',
    resultsType: 'posts',
    resultsLimit: maxResults,
    searchLimit: 1,
  });

  return items
    .filter((item) => item.type === 'Video' || item.videoUrl)
    .map((item) => ({
      url: item.url || item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : '',
      description: item.caption || '',
      viewCount: item.videoViewCount || item.playCount || 0,
      transcript: item.accessibilityCaption || null,
      platform: 'instagram',
      author: item.ownerUsername || null,
      likes: item.likesCount || 0,
      shares: 0,
    }));
}

/**
 * Scrape recent videos from a specific influencer profile.
 * Used by the Onboarding Agent (Section 3) for transcript auto-fetch.
 *
 * Channel-mode — feeds the profile URL and gets whatever appears.
 * NOT used by the Profile Views Agent anymore (rebuilt to URL-based via
 * scrapeVideosByUrls); pinned-video distortion and partial-coverage gaps
 * made channel-mode unsuitable for tracking specific posts week over week.
 */
async function scrapeProfileVideos(profileUrl, platform, maxResults = 5) {
  if (platform === 'tiktok' || profileUrl.includes('tiktok.com')) {
    const items = await runActor('clockworks~free-tiktok-scraper', {
      profiles: [profileUrl],
      resultsPerPage: maxResults,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    }, 60);

    return items.map((item) => ({
      url: item.webVideoUrl || item.url || '',
      description: item.text || item.desc || '',
      viewCount: item.playCount || item.stats?.playCount || 0,
      likes: item.diggCount || item.stats?.diggCount || 0,
      shares: item.shareCount || item.stats?.shareCount || 0,
      transcript: item.subtitleText || item.transcript || null,
      platform: 'tiktok',
      author: item.authorMeta?.name || item.author || null,
    }));
  }

  if (platform === 'instagram' || profileUrl.includes('instagram.com')) {
    const items = await runActor('apify~instagram-scraper', {
      directUrls: [profileUrl],
      resultsType: 'posts',
      resultsLimit: maxResults,
    }, 60);

    return items
      .filter((item) => item.type === 'Video' || item.videoUrl)
      .map((item) => ({
        url: item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : ''),
        description: item.caption || '',
        viewCount: item.videoViewCount || item.playCount || 0,
        likes: item.likesCount || 0,
        shares: 0,
        transcript: item.accessibilityCaption || null,
        platform: 'instagram',
        author: item.ownerUsername || null,
      }));
  }

  throw new Error(`Unsupported platform for profile scrape: ${platform}`);
}

/**
 * Scrape per-URL view counts and engagement for a list of post URLs on a
 * single platform. Returns one entry per input URL — items the actor did
 * not return surface as `{ url, error: 'not_found' }` so the caller knows
 * which URLs are unaccounted for. Twitter is stubbed out (no working actor
 * for view counts) and returns `{ error: 'manual' }` for every URL.
 *
 * Matching strategy: Apify normalizes its output `url` (e.g. strips query
 * strings, rewrites `/reel/` → `/p/` for Instagram). So we canonicalize
 * BOTH the input URL and the actor's output URL via the same
 * `canonicalizePostUrl(url, platform)` and match on the canonical key.
 *
 * @param {string[]} urls       List of post URLs (all same platform)
 * @param {'tiktok'|'instagram'|'youtube'|'twitter'} platform
 * @returns {Promise<Array<{
 *   url: string,
 *   canonicalUrl: string|null,
 *   viewCount: number|null,
 *   likes: number,
 *   shares: number,
 *   scrapedAt: string,
 *   error: 'manual'|'image_post_no_view_count'|'not_found'|'invalid_url'|null
 * }>>}
 */
async function scrapeVideosByUrls(urls, platform) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const scrapedAt = new Date().toISOString();

  // Twitter: no working view-count actor, return manual stubs without
  // touching Apify so we don't waste credits.
  if (platform === 'twitter') {
    return list.map((url) => ({
      url,
      canonicalUrl: canonicalizePostUrl(url, platform),
      viewCount: null,
      likes: 0,
      shares: 0,
      scrapedAt,
      error: 'manual',
    }));
  }

  if (list.length === 0) return [];

  // Pre-canonicalize input URLs once so the post-scrape lookup is O(1) per
  // returned item. Items whose input URL won't parse get returned upfront
  // with `error: 'invalid_url'` and never sent to Apify.
  const inputs = list.map((url) => ({
    url,
    canonical: canonicalizePostUrl(url, platform),
  }));
  const validInputs = inputs.filter((x) => x.canonical);
  const invalidInputs = inputs.filter((x) => !x.canonical);

  if (validInputs.length === 0) {
    return invalidInputs.map((x) => ({
      url: x.url,
      canonicalUrl: null,
      viewCount: null,
      likes: 0,
      shares: 0,
      scrapedAt,
      error: 'invalid_url',
    }));
  }

  let actorId;
  let actorInput;
  if (platform === 'tiktok') {
    actorId = 'clockworks~tiktok-scraper';
    actorInput = {
      postURLs: validInputs.map((x) => x.url),
      // Without an explicit resultsPerPage, the actor caps at 1 result per
      // batch and silently drops the rest of the input URLs — observed as
      // 8 TikTok scrape_url_not_returned warnings on the rebuild's first
      // verification run. 100 matches the actor's manual-paste default
      // and is enough headroom for our 51-URL batch.
      resultsPerPage: 100,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    };
  } else if (platform === 'instagram') {
    actorId = 'apify~instagram-scraper';
    actorInput = {
      directUrls: validInputs.map((x) => x.url),
      resultsType: 'posts',
      resultsLimit: validInputs.length,
    };
  } else if (platform === 'youtube') {
    actorId = 'streamers~youtube-scraper';
    actorInput = {
      startUrls: validInputs.map((x) => ({ url: x.url })),
      maxResults: validInputs.length,
    };
  } else {
    throw new Error(`scrapeVideosByUrls: unsupported platform ${platform}`);
  }

  const items = await runActor(actorId, actorInput, 180);
  if (!Array.isArray(items)) {
    throw new Error(`scrapeVideosByUrls: actor ${actorId} returned non-array`);
  }

  // Build canonical-URL → scraped-fields map. Apify can return items in
  // any order and may return fewer items than we asked for (deleted posts,
  // private accounts). Anything missing surfaces as `not_found` below.
  const byCanonical = new Map();
  for (const item of items) {
    let outUrl;
    let viewCount = null;
    let likes = 0;
    let shares = 0;
    let itemError = null;

    if (platform === 'tiktok') {
      outUrl = item.webVideoUrl || item.url;
      viewCount = numberOrNull(item.playCount ?? item.stats?.playCount);
      likes = toInt(item.diggCount ?? item.stats?.diggCount);
      shares = toInt(item.shareCount ?? item.stats?.shareCount);
    } else if (platform === 'instagram') {
      outUrl = item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : null);
      const isVideo = item.type === 'Video' || !!item.videoPlayCount || !!item.videoViewCount;
      if (!isVideo) {
        // Sidecar (image) posts have likes/comments but no view count.
        viewCount = null;
        itemError = 'image_post_no_view_count';
      } else {
        viewCount = numberOrNull(item.videoPlayCount ?? item.videoViewCount ?? item.playCount);
      }
      likes = toInt(item.likesCount);
      shares = 0;
    } else if (platform === 'youtube') {
      outUrl = item.url;
      viewCount = numberOrNull(item.viewCount);
      likes = toInt(item.likes);
      shares = 0;
    }

    const canonical = canonicalizePostUrl(outUrl, platform);
    if (!canonical) continue;
    byCanonical.set(canonical, { viewCount, likes, shares, error: itemError });
  }

  const out = validInputs.map((x) => {
    const hit = byCanonical.get(x.canonical);
    if (!hit) {
      return {
        url: x.url,
        canonicalUrl: x.canonical,
        viewCount: null,
        likes: 0,
        shares: 0,
        scrapedAt,
        error: 'not_found',
      };
    }
    return {
      url: x.url,
      canonicalUrl: x.canonical,
      viewCount: hit.viewCount,
      likes: hit.likes,
      shares: hit.shares,
      scrapedAt,
      error: hit.error,
    };
  });

  for (const inv of invalidInputs) {
    out.push({
      url: inv.url,
      canonicalUrl: null,
      viewCount: null,
      likes: 0,
      shares: 0,
      scrapedAt,
      error: 'invalid_url',
    });
  }

  return out;
}

function numberOrNull(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function toInt(v) {
  const n = numberOrNull(v);
  return n == null ? 0 : n;
}

module.exports = {
  runActor,
  scrapeTikTok,
  scrapeInstagram,
  scrapeProfileVideos,
  scrapeVideosByUrls,
  canonicalizePostUrl,
  detectPlatformFromUrl,
};
