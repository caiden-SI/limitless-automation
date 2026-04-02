// QA Agent — LLM-powered quality gate before Frame.io delivery.
// Trigger: ClickUp task status changes to EDITED.
//
// Checks:
//   1. Caption spell check against brand_dictionary
//   2. Punctuation and formatting consistency
//   3. FFmpeg LUFS analysis (target: -14 LUFS for all platforms)
//   4. Stutter/filler word detection with timecodes
//
// Pass → Pipeline Agent uploads to Frame.io
// Fail → Post QA report to ClickUp task comments, hold status

const { supabase } = require('../lib/supabase');
const { ask } = require('../lib/claude');
const { log } = require('../lib/logger');

const AGENT_NAME = 'qa';

// LUFS targets per platform — all currently -14
const LUFS_TARGETS = {
  tiktok: -14,
  instagram: -14,
  youtube: -14,
};

/**
 * Run full QA suite on an edited video.
 * @param {string} videoId - Supabase video UUID
 * @param {string} campusId - Campus UUID
 * @returns {Promise<{ passed: boolean, issues: string[] }>}
 */
async function runQA(videoId, campusId) {
  const issues = [];

  try {
    await log({ campusId, agent: AGENT_NAME, action: 'qa_started', payload: { videoId } });

    // TODO: Implement each check
    // const captionIssues = await checkCaptions(videoId, campusId);
    // issues.push(...captionIssues);

    // const lufsIssues = await checkLUFS(videoId, campusId);
    // issues.push(...lufsIssues);

    // const stutterIssues = await checkStutter(videoId, campusId);
    // issues.push(...stutterIssues);

    const passed = issues.length === 0;

    // Write result to videos table
    // NOTE: qa_passed column must be added to schema — see CLAUDE.md Gotchas
    const { error } = await supabase
      .from('videos')
      .update({ qa_passed: passed, updated_at: new Date().toISOString() })
      .eq('id', videoId);

    if (error) throw new Error(`Failed to update qa_passed: ${error.message}`);

    await log({
      campusId,
      agent: AGENT_NAME,
      action: passed ? 'qa_passed' : 'qa_failed',
      payload: { videoId, issueCount: issues.length, issues },
    });

    return { passed, issues };
  } catch (err) {
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'qa_error',
      status: 'error',
      errorMessage: err.message,
      payload: { videoId, stack: err.stack },
    });
    throw err;
  }
}

/**
 * Check SRT captions against brand_dictionary for misspellings.
 */
async function checkCaptions(videoId, campusId) {
  // TODO: Implement
  // 1. Retrieve SRT file path from Dropbox via videos.dropbox_folder
  // 2. Parse SRT content
  // 3. Query brand_dictionary for campus terms
  // 4. Check each caption line for misspellings of brand terms
  // 5. Check punctuation and formatting consistency
  // 6. Return array of issue strings
  return [];
}

/**
 * Run FFmpeg LUFS analysis on exported video.
 */
async function checkLUFS(videoId, campusId) {
  // TODO: Implement
  // 1. Get exported video file path from Dropbox
  // 2. Run: ffmpeg -i {file} -af loudnorm=print_format=json -f null -
  // 3. Parse integrated loudness from output
  // 4. Compare against LUFS_TARGETS
  // 5. Return issue string if out of range
  return [];
}

/**
 * Detect stutter and filler words in transcript with timecodes.
 */
async function checkStutter(videoId, campusId) {
  // TODO: Implement
  // 1. Get transcript from transcripts table for this video
  // 2. Send to Claude for filler word detection ("um", "uh", false starts)
  // 3. Return array of issues with timecodes
  return [];
}

module.exports = { runQA };
