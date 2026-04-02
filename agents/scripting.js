// Scripting Agent — LLM-powered content generation.
// Trigger: Google Calendar event when a student is scheduled for filming.
//
// Steps:
//   1. Read student name from calendar event
//   2. Query students table for brand voice, UVP, story, positioning
//   3. Query performance_signals for latest weekly signals
//   4. Query research_library for top recent entries matching niche
//   5. Generate 3 concept options via Claude (title, hook, script, format)
//   6. Create ClickUp tasks in IDEA status
//   7. Write drafts to videos table
//
// NOTE: Google Calendar event format needs confirmation from Scott —
// what's in the title/description? Does it include the student name explicitly?

const { supabase } = require('../lib/supabase');
const { askJson } = require('../lib/claude');
const { log } = require('../lib/logger');

const AGENT_NAME = 'scripting';

const SCRIPTING_SYSTEM = `You are a content strategist for Alpha School, a private K-12 school network.
You generate short-form video scripts (30-60 seconds) for student creators.

Student context:
{student_context}

Current performance signals (what's working):
{performance_signals}

Top performing hooks from research:
{research_examples}

Generate 3 distinct concept options. For each, provide:
- title: 1-4 word concept descriptor
- hook: opening line (first 3 seconds)
- script: full 30-60 second script
- format: recommended visual format

Match the student's brand voice exactly. Keep language natural for a high school student.
Return JSON only. No markdown, no explanation.`;

/**
 * Generate concepts for a student triggered by a calendar event.
 * @param {string} studentName - Student name from calendar event
 * @param {string} campusId - Campus UUID
 */
async function run(studentName, campusId) {
  try {
    await log({ campusId, agent: AGENT_NAME, action: 'scripting_run_started', payload: { studentName } });

    // TODO: Implement
    // 1. Query students table for student by name + campus
    // 2. Query performance_signals for latest week
    // 3. Query research_library for top recent entries (limit 10)
    // 4. Build prompt from SCRIPTING_SYSTEM template with real data
    // 5. Call Claude for 3 concept options
    // 6. For each concept:
    //    a. Create ClickUp task in IDEA status
    //    b. Insert into videos table with status IDEA

    await log({ campusId, agent: AGENT_NAME, action: 'scripting_run_complete', payload: { studentName } });
  } catch (err) {
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'scripting_run_error',
      status: 'error',
      errorMessage: err.message,
      payload: { studentName, stack: err.stack },
    });
    throw err;
  }
}

module.exports = { run };
