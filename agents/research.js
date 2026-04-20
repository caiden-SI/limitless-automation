// Research Agent — LLM + web scraping for content intelligence.
// Trigger: Scheduled cron (daily at 6 AM).
//
// Steps:
//   1. Load search queries for each campus
//   2. Scrape TikTok + Instagram via Apify for top-performing videos
//   3. Extract/generate transcript for each video
//   4. Classify with Claude: hook_type, format, topic_tags
//   5. Deduplicate against existing research_library entries by source_url
//   6. Write new entries to research_library table

const { supabase } = require('../lib/supabase');
const { askJson, ask } = require('../lib/claude');
const { log } = require('../lib/logger');
const { scrapeTikTok, scrapeInstagram } = require('../tools/scraper');

const AGENT_NAME = 'research';

// Classification taxonomy. Shared with the Scripting Agent so concept
// hook_type values and research_library hook_type values can never drift.
const HOOK_TYPES = ['question', 'statement', 'story', 'stat', 'challenge', 'reveal', 'list', 'shock'];
const FORMAT_TYPES = ['talking-head', 'b-roll-heavy', 'montage', 'tutorial', 'day-in-life', 'interview', 'skit', 'slideshow'];

// Default search queries — aligned with Alpha School / Limitless content
const DEFAULT_QUERIES = [
  'student entrepreneur',
  'alpha school',
  'homeschool success',
  'teen startup',
  'alternative education',
];

const CLASSIFICATION_SYSTEM = `You are a content strategist analyzing social media videos for a research library.
Your job is to classify each video so content creators can find relevant reference material later.

Classify the video into:
- hook_type: exactly one of [question, statement, story, stat, challenge, reveal, list, shock]
- format: exactly one of [talking-head, b-roll-heavy, montage, tutorial, day-in-life, interview, skit, slideshow]
- topic_tags: array of 3-5 specific, lowercase topic strings (not generic — "teen entrepreneurship" not "business")

Return JSON only: { "hook_type": "...", "format": "...", "topic_tags": ["..."] }`;

const TRANSCRIPT_SYSTEM = `You are a transcript extraction assistant. Given a video description or caption, reconstruct what the speaker likely said in the video. Write it as a natural spoken transcript (first person, conversational). If the description is too short or vague to reconstruct, return the description as-is. Keep it concise — under 200 words.`;

/**
 * Run the full research pipeline for a campus.
 * @param {string} campusId - Campus UUID
 * @param {object} [options]
 * @param {string[]} [options.queries] - Override default search queries
 * @param {number} [options.maxPerPlatform] - Max results per platform (default 20)
 * @returns {Promise<{ scraped: number, new: number, duplicates: number, errors: number }>}
 */
async function run(campusId, options = {}) {
  const queries = options.queries || DEFAULT_QUERIES;
  const maxPerPlatform = options.maxPerPlatform || 20;
  const stats = { scraped: 0, new: 0, duplicates: 0, errors: 0 };

  try {
    await log({ campusId, agent: AGENT_NAME, action: 'research_run_started', payload: { queries, maxPerPlatform } });

    // Scrape both platforms
    let videos = [];

    try {
      const tiktokResults = await scrapeTikTok(queries, maxPerPlatform);
      videos.push(...tiktokResults);
      await log({ campusId, agent: AGENT_NAME, action: 'tiktok_scrape_complete', payload: { count: tiktokResults.length } });
    } catch (err) {
      await log({ campusId, agent: AGENT_NAME, action: 'tiktok_scrape_error', status: 'error', errorMessage: err.message });
      stats.errors++;
    }

    try {
      const igResults = await scrapeInstagram(queries, maxPerPlatform);
      videos.push(...igResults);
      await log({ campusId, agent: AGENT_NAME, action: 'instagram_scrape_complete', payload: { count: igResults.length } });
    } catch (err) {
      await log({ campusId, agent: AGENT_NAME, action: 'instagram_scrape_error', status: 'error', errorMessage: err.message });
      stats.errors++;
    }

    stats.scraped = videos.length;

    if (videos.length === 0) {
      await log({ campusId, agent: AGENT_NAME, action: 'research_run_empty', status: 'warning', payload: { reason: 'no videos scraped' } });
      return stats;
    }

    // Get existing source URLs for deduplication
    const { data: existing } = await supabase
      .from('research_library')
      .select('source_url')
      .eq('campus_id', campusId);
    const existingUrls = new Set((existing || []).map((r) => r.source_url));

    // Process each video
    for (const video of videos) {
      try {
        // Deduplicate by source URL
        if (!video.url || existingUrls.has(video.url)) {
          stats.duplicates++;
          continue;
        }

        // Get or generate transcript
        let transcript = video.transcript;
        if (!transcript && video.description) {
          transcript = await generateTranscript(video.description, video.platform);
        }
        if (!transcript) {
          stats.errors++;
          continue;
        }

        // Classify with Claude
        const classification = await classifyTranscript(transcript, video.platform);

        // Insert into research_library
        const { error: insertErr } = await supabase.from('research_library').insert({
          campus_id: campusId,
          source_url: video.url,
          transcript,
          hook_type: classification.hook_type,
          format: classification.format,
          topic_tags: classification.topic_tags,
          platform: video.platform,
          view_count: video.viewCount || null,
          scraped_at: new Date().toISOString(),
        });

        if (insertErr) {
          // Unique constraint violation = duplicate we missed
          if (insertErr.code === '23505') {
            stats.duplicates++;
          } else {
            stats.errors++;
            await log({
              campusId,
              agent: AGENT_NAME,
              action: 'research_insert_error',
              status: 'error',
              errorMessage: insertErr.message,
              payload: { url: video.url },
            });
          }
        } else {
          stats.new++;
          existingUrls.add(video.url); // Track for in-batch dedup
        }
      } catch (err) {
        stats.errors++;
        await log({
          campusId,
          agent: AGENT_NAME,
          action: 'research_video_error',
          status: 'error',
          errorMessage: err.message,
          payload: { url: video.url },
        });
      }
    }

    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'research_run_complete',
      payload: stats,
    });

    return stats;
  } catch (err) {
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'research_run_error',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack },
    });
    throw err;
  }
}

/**
 * Classify a single transcript using Claude.
 * @param {string} transcript - Video transcript text
 * @param {string} platform - Source platform
 * @returns {Promise<{ hook_type: string, format: string, topic_tags: string[] }>}
 */
async function classifyTranscript(transcript, platform) {
  const result = await askJson({
    system: CLASSIFICATION_SYSTEM,
    prompt: `Platform: ${platform}\n\nTranscript:\n${transcript.slice(0, 2000)}`,
    maxTokens: 256,
  });

  return {
    hook_type: HOOK_TYPES.includes(result.hook_type) ? result.hook_type : 'statement',
    format: FORMAT_TYPES.includes(result.format) ? result.format : 'talking-head',
    topic_tags: Array.isArray(result.topic_tags) ? result.topic_tags.slice(0, 5) : [],
  };
}

/**
 * Generate an approximate transcript from a video description using Claude.
 * Used when the scraper doesn't return a transcript directly.
 * @param {string} description - Video caption/description
 * @param {string} platform - Source platform
 * @returns {Promise<string>}
 */
async function generateTranscript(description, platform) {
  const text = await ask({
    system: TRANSCRIPT_SYSTEM,
    prompt: `Platform: ${platform}\nVideo description: ${description.slice(0, 1000)}`,
    maxTokens: 512,
  });
  return text.trim();
}

/**
 * Run for all active campuses. Called by the cron scheduler.
 */
async function runAll() {
  const { data: campuses, error } = await supabase
    .from('campuses')
    .select('id, name')
    .eq('active', true);

  if (error) {
    await log({ agent: AGENT_NAME, action: 'run_all_error', status: 'error', errorMessage: error.message });
    return;
  }

  for (const campus of campuses) {
    try {
      await run(campus.id);
    } catch (err) {
      // Error already logged inside run() — continue to next campus
    }
  }
}

module.exports = { run, runAll, classifyTranscript, generateTranscript, HOOK_TYPES, FORMAT_TYPES };
