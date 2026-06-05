#!/usr/bin/env node
// End-to-end driver for the onboarding conversation.
//
// Resets the test student's session, then drives a full conversation by
// calling agents/onboarding.handleMessage() directly — greeting through
// synthesis — printing the transcript so the tone and flow can be read back.
//
// State lives server-side; this only sends the latest message each turn and
// re-reads current_question_index from Supabase to pick the next answer, so it
// stays in sync even if the agent inserts a clarity probe.
//
// Canned answers are keyed by question key and cover BOTH the pre-merge
// Section 4 keys (motivation_1_what / _why ...) and the merged keys
// (motivation_1 ...), so the same driver works before and after the Phase 2
// audience-section change. Unknown keys fall back to a generic answer.
//
// Influencer answers use bare @handles + a YouTube link on purpose: those
// route down the no_scrapeable_url path, so no live Apify scrape runs.
//
// Usage: node scripts/test-onboarding-conversation.js ["Name Substring"]

require('dotenv').config();
const { supabase } = require('../lib/supabase');
const onboarding = require('../agents/onboarding');

const ALL_QUESTIONS = onboarding.ALL_QUESTIONS;
const NEEDLE = (process.argv[2] || 'Alex Mathews').toLowerCase();

const ANSWERS = {
  // Section 1 — BUSINESS CONTEXT
  brand_name: 'RepHabit',
  project_stage: "We're live with active users — launched the beta about eight months ago.",
  what_it_does: "It's a mobile app that gives busy parents 20-minute strength workouts they can do at home with almost no equipment, built around the time they actually have.",
  problem_solved: "Most fitness apps assume you have an hour and a gym. Parents don't. We solve the 'no time, no equipment, still want to get strong' problem.",
  mission: 'We help overwhelmed parents stay strong and consistent so they can keep up with their kids and feel good in their own bodies.',
  vision: 'In five years I want RepHabit to be the default app parents reach for, with a million active users and a real community around it.',
  product_type: "It's a software product — a subscription mobile app on iOS and Android.",
  current_users: 'We have around 3,200 active users right now, about 800 of them paying.',
  key_features: "Adaptive 20-minute workouts, progress tracking, a 'busy day' mode that shortens sessions, and weekly check-ins.",
  access_and_pricing: 'Free to download with a 7-day trial, then $12 a month or $99 a year for the full library.',
  uvp: 'Everything is built around short windows of time and minimal gear. Other apps bolt that on; we started there.',
  testimonials: "Yes — one parent went from zero workouts to five a week. Another said it's the first fitness app he didn't cancel after a month.",

  // Section 2 — PERSONAL BRAND CONTEXT
  origin_story: 'After my second kid I completely stopped training. I was exhausted and every plan assumed I had an hour. One night I sketched a 20-minute routine on my phone and actually stuck with it, and RepHabit grew out of that.',
  biggest_challenge: 'Building credibility as a solo founder with no real following. Getting the first thousand users took forever.',
  content_quantity: "Some — I have a decent amount on my camera roll but it's not organized.",
  content_types: 'Mostly selfie-style clips of me working out, a few screen recordings of the app, and some b-roll of me with my kids.',
  long_form_transcripts: 'I did one podcast interview about founder burnout. I can paste the transcript text later if that helps.',
  short_form_transcripts: 'I have one Reel that did well — me explaining the 20-minute idea. I can paste the transcript text.',

  // Section 3 — INDUSTRY AUTHORITY
  niche: 'Fitness and strength training for busy parents who want short, equipment-light workouts.',
  influencers: '@thefitnessdad, @busymomstrong, and @minimalistlifts on YouTube (https://youtube.com/@minimalistlifts)',

  // Section 4 — AUDIENCE CONTEXT (pre-merge split keys)
  ideal_customer: 'A 30-to-45-year-old parent with one or two young kids, works full time, used to be active but has fallen off, and feels guilty about it.',
  motivation_1_what: 'The first thing they think about when they wake up is their kids and the day’s to-do list.',
  motivation_1_why: 'Because everyone else’s needs come before theirs, so the day is mapped out before they even get up.',
  motivation_2_what: 'What gets them through the day is small wins — coffee, a quiet moment, checking one thing off.',
  motivation_2_why: "Because the days are relentless and those small wins are the only proof they're keeping it together.",
  desire_1_what: 'They daydream about feeling strong and confident in their body again.',
  desire_1_why: 'Because they remember who they were before kids and they miss that version of themselves.',
  desire_2_what: 'They wish they had more energy and time that was actually their own.',
  desire_2_why: "Because they're running on empty and never feel like anything is just for them.",
  pain_1_what: 'The most annoying recurring thing is starting a workout plan and quitting within a week.',
  pain_1_why: "Because it makes them feel like a failure who can't stick to anything, on top of everything else.",
  pain_2_what: 'The most painful experience was seeing a photo of themselves and not recognizing their own body.',
  pain_2_why: "Because it hit them that they'd let themselves disappear under everyone else's needs.",
  fear_1_what: 'They hope no one finds out how out of shape and unhealthy they actually feel.',
  fear_1_why: 'Because they’re supposed to have it together for their kids, and admitting otherwise feels like failing.',
  fear_2_what: 'They’ve avoided stepping on a scale or taking a real progress photo for years.',
  fear_2_why: "Because facing the number makes the thing they've been ignoring impossible to ignore.",

  // Section 4 — AUDIENCE CONTEXT (post-merge combined keys)
  motivation_1: 'When they wake up the first thing on their mind is their kids and the day’s to-do list — because everyone else’s needs come before theirs and the day is mapped out before they’re even up.',
  motivation_2: "Small wins get them through the day — coffee, a quiet moment, one thing checked off — because the days are relentless and those wins are the only proof they're keeping it together.",
  desire_1: 'They daydream about feeling strong and confident in their body again, because they remember who they were before kids and miss that version of themselves.',
  desire_2: "They wish they had more energy and time that's actually their own, because they're running on empty and nothing ever feels just for them.",
  pain_1: "The most annoying recurring thing is starting a workout plan and quitting within a week, because it makes them feel like a failure who can't stick to anything.",
  pain_2: "The most painful experience was seeing a photo and not recognizing their own body, because it hit them that they'd disappeared under everyone else's needs.",
  fear_1: 'They hope no one finds out how out of shape and unhealthy they actually feel, because they’re supposed to have it together for their kids and admitting otherwise feels like failing.',
  fear_2: "They've avoided stepping on a scale or taking a progress photo for years, because facing it makes the thing they've been ignoring impossible to ignore.",

  // Section 5 — CONTENT CREATION CONTEXT
  content_pillars: 'Product demos and tutorials, behind-the-scenes of building the app, and my personal story and journey.',
  format_preference: 'I usually read a script on camera — talking head style.',
  creator_references: 'I like watching Ali Abdaal for the calm style and a few fitness creators like Jeff Nippard.',
  topics_to_avoid: 'I avoid diet culture, extreme cutting, and anything that shames people about their weight.',
  student_handles: 'TikTok @rephabit, Instagram @rephabit.app, and YouTube @rephabitapp.',
};

function fallback(key) {
  return `A clear, specific answer for "${key}" with enough concrete detail to be useful.`;
}

function hr() { console.log('─'.repeat(72)); }

async function readIndex(studentId, campusId) {
  const { data } = await supabase
    .from('onboarding_sessions')
    .select('current_question_index, current_section, probed_current')
    .eq('student_id', studentId)
    .eq('campus_id', campusId)
    .single();
  return data;
}

async function main() {
  const { data: students, error } = await supabase
    .from('students')
    .select('id, name, campus_id')
    .ilike('name', `%${NEEDLE}%`);
  if (error) throw new Error(`Student lookup failed: ${error.message}`);
  if (!students || students.length === 0) throw new Error(`No student matching "${NEEDLE}" — run scripts/seed-test-student.js first`);

  const student = students[0];
  const { id: studentId, campus_id: campusId, name: studentName } = student;
  const firstName = studentName.trim().split(/\s+/)[0];

  // Reset so the flow runs from scratch
  await supabase.from('onboarding_sessions').delete().eq('student_id', studentId).eq('campus_id', campusId);
  await supabase
    .from('students')
    .update({
      onboarding_completed_at: null,
      claude_project_context: null,
      content_format_preference: 'script',
      handle_tiktok: null,
      handle_instagram: null,
      handle_youtube: null,
    })
    .eq('id', studentId);

  console.log(`\nDriving onboarding for: ${studentName} (${studentId})`);
  console.log(`Total questions in flow: ${ALL_QUESTIONS.length}`);
  hr();

  const pct = (r) => (r.totalQuestions ? Math.round((r.questionIndex / r.totalQuestions) * 100) : 0);

  // Greeting (empty message)
  let res = await onboarding.handleMessage({ studentId, campusId, studentName, message: '' });
  console.log(`\nASSISTANT:\n${res.reply}\n`);
  console.log(`   [progress: Q${res.questionIndex}/${res.totalQuestions} = ${pct(res)}%]\n`);

  let guard = 0;
  let probeCount = 0;
  while (!res.isComplete && guard++ < 120) {
    const before = await readIndex(studentId, campusId);
    const idx = before.current_question_index;
    const q = ALL_QUESTIONS[idx];
    if (!q) { console.log(`(no question at index ${idx} — stopping)`); break; }

    const answer = ANSWERS[q.key] || fallback(q.key);
    const probedTag = before.probed_current ? ' [post-probe]' : '';
    console.log(`--- answering Q${idx + 1}/${ALL_QUESTIONS.length} · section ${q.section} · key=${q.key}${probedTag} ---`);
    console.log(`${firstName.toUpperCase()}: ${answer}\n`);

    res = await onboarding.handleMessage({ studentId, campusId, studentName, message: answer });
    console.log(`ASSISTANT:\n${res.reply}\n`);
    console.log(`   [progress: Q${res.questionIndex}/${res.totalQuestions} = ${pct(res)}%]\n`);

    const after = await readIndex(studentId, campusId);
    if (after && after.current_question_index === idx && !res.isComplete) {
      probeCount++;
      console.log(`(stayed on Q${idx + 1} — clarity probe)\n`);
    }
  }

  hr();
  console.log(`\nisComplete: ${res.isComplete}`);
  console.log(`clarity probes observed: ${probeCount}`);
  if (res.contextDocument) {
    console.log(`\n=== CONTEXT DOCUMENT (${res.contextDocument.length} chars; first 1400 shown) ===\n`);
    console.log(res.contextDocument.slice(0, 1400));
    console.log('\n...[truncated]');
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
