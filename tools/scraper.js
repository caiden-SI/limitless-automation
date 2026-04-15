// Scraper tool — calls Apify actors to scrape TikTok and Instagram content.
// Uses Apify REST API directly (no SDK). Requires APIFY_API_TOKEN in .env.
//
// Actors used:
//   TikTok:    clockworks/free-tiktok-scraper
//   Instagram: apify/instagram-scraper
//
// Each returns video metadata: URL, description, view count, and (when available)
// transcript/caption text.

const APIFY_BASE = 'https://api.apify.com/v2';

function apifyHeaders() {
  return {
    Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Run an Apify actor synchronously and return the dataset items.
 * @param {string} actorId - e.g. "clockworks~free-tiktok-scraper"
 * @param {object} input - Actor input payload
 * @param {number} [timeoutSecs=120] - Max wait time
 * @returns {Promise<Array<object>>}
 */
async function runActor(actorId, input, timeoutSecs = 120) {
  if (!process.env.APIFY_API_TOKEN) {
    throw new Error('APIFY_API_TOKEN not set — cannot run scraper');
  }

  // Start actor run synchronously (waits for completion)
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
 * Scrape top-performing TikTok videos for given search queries.
 * @param {string[]} queries - Search terms (e.g. ["alpha school", "student entrepreneur"])
 * @param {number} [maxResults=20] - Max videos per query
 * @returns {Promise<Array<{ url: string, description: string, viewCount: number, transcript: string|null, platform: string }>>}
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
 * @param {string[]} queries - Hashtags or search terms
 * @param {number} [maxResults=20] - Max videos per query
 * @returns {Promise<Array<{ url: string, description: string, viewCount: number, transcript: string|null, platform: string }>>}
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
 * Used by the onboarding agent (Section 3) to auto-fetch transcripts.
 * @param {string} profileUrl - Profile URL or handle (e.g. "https://tiktok.com/@garyvee")
 * @param {'tiktok'|'instagram'} platform - Which platform to scrape
 * @param {number} [maxResults=5] - Max videos to return
 * @returns {Promise<Array<{ url: string, description: string, transcript: string|null, platform: string }>>}
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
      transcript: item.subtitleText || item.transcript || null,
      platform: 'tiktok',
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
        transcript: item.accessibilityCaption || null,
        platform: 'instagram',
      }));
  }

  throw new Error(`Unsupported platform for profile scrape: ${platform}`);
}

module.exports = { runActor, scrapeTikTok, scrapeInstagram, scrapeProfileVideos };
