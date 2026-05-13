#!/usr/bin/env node
/**
 * Snapshot the output of agents/scripting.buildPrompt against a stable
 * fixture. Used by docs/dashboard-consoles-spec.md §8.1 — the cron-path
 * regression check before introducing the `userConcept` parameter.
 *
 * Run before the refactor to capture a baseline:
 *   node scripts/snapshot-scripting-prompt.js > /tmp/scripting-prompt-baseline.txt
 *
 * Re-run after refactor to confirm byte-identity:
 *   node scripts/snapshot-scripting-prompt.js > /tmp/scripting-prompt-after.txt
 *   diff /tmp/scripting-prompt-baseline.txt /tmp/scripting-prompt-after.txt
 *
 * Exits 0 always. Output is the entire { system, prompt } pair serialized
 * with a unique separator so a one-byte change is visible to `diff`.
 *
 * Covers four call shapes the cron path produces today:
 *   A. minimal      — no signals, no benchmarks, no validation error
 *   B. rich         — signals + benchmarks present
 *   C. retry        — same as rich + a validationError string
 *   D. no-context   — student.claude_project_context is null
 */

require('dotenv').config();

const scripting = require('../agents/scripting');

const STUDENT_RICH = {
  id: 'fixture-student-1',
  name: 'Geetesh Parelly',
  claude_project_context: [
    'Geetesh is conversational, self-deprecating, and analytical.',
    'He attends Alpha School Austin and runs a project called Codegrid.',
    'Wants to sound like Hank Green and Veritasium — earnest, dry-humor.',
  ].join(' '),
};

const STUDENT_NO_CONTEXT = {
  id: 'fixture-student-2',
  name: 'No Context Student',
  claude_project_context: null,
};

const CONTEXT_MINIMAL = {
  studentContext: STUDENT_RICH.claude_project_context,
  performanceSignals: null,
  researchBenchmarks: [],
};

const CONTEXT_RICH = {
  studentContext: STUDENT_RICH.claude_project_context,
  performanceSignals: {
    summary: 'Austin students do best with reveal/shock hooks under 90 seconds.',
    top_hooks: [
      { hook_type: 'reveal', avg_views: 24000 },
      { hook_type: 'shock', avg_views: 19500 },
      { hook_type: 'question', avg_views: 14000 },
    ],
    top_formats: [
      { format: 'script', avg_views: 21000 },
      { format: 'on_screen_text', avg_views: 11000 },
    ],
    top_topics: [
      { topic: 'AI in education', avg_views: 26000 },
      { topic: 'study hacks', avg_views: 17000 },
    ],
    underperforming_patterns: ['generic openers', 'lectures over 90s'],
    recommendations: ['lead with a contradiction', 'tie back to a personal anecdote'],
  },
  researchBenchmarks: [
    {
      platform: 'tiktok',
      hook_type: 'reveal',
      format: 'script',
      view_count: 1_400_000,
      transcript: 'I built an AI that grades my homework. Here is what happened on day one.',
    },
    {
      platform: 'instagram',
      hook_type: 'shock',
      format: 'on_screen_text',
      view_count: 980_000,
      transcript: 'My teacher banned ChatGPT. Then she found out I used it for THIS.',
    },
  ],
};

const CONTEXT_NO_CTX = {
  studentContext: null,
  performanceSignals: null,
  researchBenchmarks: [],
};

const GEN_CONSTRAINTS = {
  hardConstraints: {
    ai_tell_blocklist: ["let's dive in", 'game-changer', 'level up'],
    length_bounds: { min: 70, max: 150, unit: 'words' },
    brand_dictionary: [{ term: 'Alpha School' }, { term: 'Codegrid' }],
    forbidden_generic_openers: ['Hey guys', "What's up"],
    allowed_proper_nouns: ['Geetesh Parelly', 'Alpha School', 'Austin', 'Codegrid', 'Hank Green', 'Veritasium'],
  },
  softGuidelines: {
    tone_dimensions: ['conversational', 'self-deprecating', 'analytical'],
    voice_excerpts: [
      { source: 'tiktok/@hankgreen', text: 'You ever notice how a fact only feels true after you have explained it to one stubborn friend?' },
      { source: 'youtube/@veritasium', text: 'Most people get this wrong. Including me. Let me show you what changed my mind.' },
    ],
    format_hook_shape: 'first sentence must contain a question mark, a digit, a contradiction keyword, or a concrete noun from the student context',
    format: 'script',
  },
};

function snapshot(label, args) {
  const { system, prompt } = scripting.buildPrompt(args);
  return [
    `========== ${label} ==========`,
    '---SYSTEM---',
    system,
    '---PROMPT---',
    prompt,
    '---END---',
  ].join('\n');
}

const outputs = [
  snapshot('A: minimal (no signals, no benchmarks)', {
    student: STUDENT_RICH,
    context: CONTEXT_MINIMAL,
    genConstraints: GEN_CONSTRAINTS,
  }),
  snapshot('B: rich (signals + benchmarks, no validation error)', {
    student: STUDENT_RICH,
    context: CONTEXT_RICH,
    genConstraints: GEN_CONSTRAINTS,
  }),
  snapshot('C: retry (rich + validationError)', {
    student: STUDENT_RICH,
    context: CONTEXT_RICH,
    genConstraints: GEN_CONSTRAINTS,
    validationError: 'Concept 2 script was 200 words; must be 70 to 150.',
  }),
  snapshot('D: no claude_project_context', {
    student: STUDENT_NO_CONTEXT,
    context: CONTEXT_NO_CTX,
    genConstraints: GEN_CONSTRAINTS,
  }),
];

process.stdout.write(outputs.join('\n\n') + '\n');
