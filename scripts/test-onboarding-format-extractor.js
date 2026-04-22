#!/usr/bin/env node
// Unit tests for onboarding.extractContentFormatPreference().
//
// Pure function — no Supabase, no Claude, no network. Run: node scripts/test-onboarding-format-extractor.js

require('dotenv').config();

const { extractContentFormatPreference } = require('../agents/onboarding');

const cases = [
  // Option letters (clean picks)
  ['A', 'script', 'just A'],
  ['a', 'script', 'lowercase a'],
  ['B', 'on_screen_text', 'just B'],
  ['C', 'caption_only', 'just C'],
  ['D', 'mixed', 'just D (explicit mixed)'],

  // Option letters with surrounding commentary
  ['I\'d say A, talking head is my thing', 'script', 'A with commentary'],
  ['Option C for me, I prefer captions.', 'caption_only', 'C with commentary'],
  ['I think B. I don\'t like being on camera.', 'on_screen_text', 'B with commentary'],

  // Multiple letters → mixed
  ['A and B, depends on the video', 'mixed', 'A+B → mixed'],
  ['Usually A but sometimes C', 'mixed', 'A+C → mixed'],
  ['A/B/C all of them', 'mixed', 'A+B+C → mixed'],
  ['D for sure', 'mixed', 'D → mixed'],
  ['I pick D, I mix it up', 'mixed', 'D + keyword'],

  // Keyword match — no letters
  ['I record talking head videos with a script', 'script', 'keyword: talking-head + script'],
  ['Mostly b-roll with text overlays', 'on_screen_text', 'keyword: b-roll + text overlays'],
  ['Screen recordings, no speaking', 'on_screen_text', 'keyword: screen recording + no speaking'],
  ['I just use captions, minimal text', 'caption_only', 'keyword: captions + minimal text'],
  ['Caption-driven posts', 'caption_only', 'keyword: caption-driven'],
  ['I do a mix of everything', 'mixed', 'keyword: mix'],
  ['A combination of talking head and b-roll', 'mixed', 'keyword: combination'],
  ['It depends on the video topic', 'mixed', 'keyword: depends'],

  // Multi-format keyword → mixed
  ['I do scripted videos but also text overlays sometimes', 'mixed', 'script + on_screen_text → mixed'],
  ['Captions with talking head clips', 'mixed', 'caption + script → mixed'],

  // Empty / missing → default to script
  ['', 'script', 'empty string defaults to script'],
  [undefined, 'script', 'undefined defaults to script'],
  [null, 'script', 'null defaults to script'],
  ['uhh idk', 'script', 'unrecognized answer → default script'],

  // False positives to guard against
  ['Activities for beginners', 'script', 'word "Activities" does not trigger A'],
  ['Basic tutorials', 'script', 'word "Basic" does not trigger B'],
  ['I record content about AI', 'script', '"content" should not trigger keyword hits spuriously'],
];

let passed = 0;
let failed = 0;

for (const [input, expected, label] of cases) {
  const answers = input === undefined ? {} : { format_preference: input };
  const actual = extractContentFormatPreference(answers);
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      input:    ${JSON.stringify(input)}`);
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
  }
}

console.log(`\n${passed}/${cases.length} cases passed`);
process.exit(failed === 0 ? 0 : 1);
