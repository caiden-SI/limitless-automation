// Performance Analysis Agent — LLM-powered pattern recognition.
// Trigger: Scheduled every Monday morning.
//
// Steps:
//   1. Query performance table for last 4 weeks of view data
//   2. Query transcripts for top/bottom performing videos
//   3. Query research_library for external benchmarks
//   4. Send to Claude for pattern analysis
//   5. Write structured signals to performance_signals
//
// NOTE: Pattern recognition becomes meaningful at ~50+ videos.
// Early outputs will have limited signal — this is expected.

const { supabase } = require('../lib/supabase');
const { askJson } = require('../lib/claude');
const { log } = require('../lib/logger');

const AGENT_NAME = 'performance';

const ANALYSIS_SYSTEM = `You are analyzing video performance data for a student content agency.
Given view count data and transcripts for the top and bottom performing videos,
identify patterns in hooks, formats, topics, and pacing that correlate with high performance.
Output a structured JSON with: top_hooks[], top_formats[], top_topics[], and a plain English summary
suitable for a non-technical team member to act on.
Return JSON only. No markdown, no explanation.`;

/**
 * Run weekly performance analysis.
 * @param {string} campusId - Campus UUID
 */
async function run(campusId) {
  try {
    await log({ campusId, agent: AGENT_NAME, action: 'performance_run_started' });

    // TODO: Implement
    // 1. Query performance table for last 4 weeks: view counts per video per platform
    // 2. Identify top 10 and bottom 10 by view count
    // 3. Query transcripts for those videos
    // 4. Query research_library for recent external benchmarks
    // 5. Send combined context to Claude
    // 6. Write result to performance_signals table

    await log({ campusId, agent: AGENT_NAME, action: 'performance_run_complete' });
  } catch (err) {
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'performance_run_error',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack },
    });
    throw err;
  }
}

module.exports = { run };
