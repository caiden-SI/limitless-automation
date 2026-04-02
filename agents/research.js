// Research Agent — LLM + web scraping for content intelligence.
// Trigger: Scheduled cron (daily or weekly).
//
// Steps:
//   1. Query Apify/Playwright for top-performing videos in target niche
//   2. Extract transcript from each video
//   3. Classify with Claude: hook_type, format, topic_tags, platform
//   4. Deduplicate against existing research_library entries
//   5. Write to research_library table

const { supabase } = require('../lib/supabase');
const { askJson } = require('../lib/claude');
const { log } = require('../lib/logger');

const AGENT_NAME = 'research';

const CLASSIFICATION_SYSTEM = `You are analyzing a social media video transcript to classify it for a content research library.
Classify the following transcript into:
- hook_type: one of [question, statement, story, stat, challenge, reveal]
- format: one of [talking-head, b-roll-heavy, montage, tutorial, day-in-life]
- topic_tags: array of 3-5 relevant topic strings
Return JSON only. No markdown, no explanation.`;

/**
 * Run the research scraping and classification pipeline.
 * @param {string} campusId - Campus UUID
 */
async function run(campusId) {
  try {
    await log({ campusId, agent: AGENT_NAME, action: 'research_run_started' });

    // TODO: Implement
    // 1. Call Apify or Playwright to scrape top videos
    // 2. For each video:
    //    a. Extract transcript (Apify transcript tool or Whisper)
    //    b. Classify with Claude
    //    c. Deduplicate against existing entries (check source_url)
    //    d. Insert into research_library

    await log({ campusId, agent: AGENT_NAME, action: 'research_run_complete' });
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
    prompt: `Platform: ${platform}\n\nTranscript:\n${transcript}`,
  });

  return result;
}

module.exports = { run, classifyTranscript };
