#!/usr/bin/env node
// Integration test for the brand-voice validator (Layer 1 + Layer 2) and
// its wiring into agents/scripting.js.
//
// Runs against real Supabase + real Claude (Case 10), with askJson monkey-
// patched for deterministic cases (5, 7, 11). Uses the seeded Alex Mathews
// student on Austin campus.
//
// Run: node scripts/test-brand-voice-validation.js
// Env: SKIP_REAL_CLAUDE=1 to skip Case 10 (the only case that hits Claude live).

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const claudeModule = require('../lib/claude');
const validator = require('../lib/brand-voice-validator');
const scripting = require('../agents/scripting');

const ALEX_ID = '0bf6a38a-801e-4eff-b0c8-c209a9029b7e';
const AUSTIN_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const TEST_PREFIX = `__bvv_test_${Date.now()}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(msg) { console.log(`  ✓ ${msg}`); passed++; }
function fail(msg, detail) {
  console.log(`  ✗ ${msg}`);
  if (detail) console.log(`      ${detail}`);
  failed++;
  failures.push(msg);
}
function banner(msg) { console.log(`\n━━━ ${msg}`); }
function assert(cond, msg, detail) { cond ? ok(msg) : fail(msg, detail); }

function longScript(extraWords = '', leading = '') {
  // Produces ~90 words, fits within 70-150 script bound.
  const base = 'This is a concrete test about Alex Mathews and his Early-Ai project that teaches kids AI fundamentals through hands-on building blocks. ';
  let script = leading + extraWords + base + base + base + ' Alex started this because his brother struggled to find beginner AI tools.';
  // Trim to 90 if over
  const words = script.trim().split(/\s+/);
  if (words.length > 140) return words.slice(0, 140).join(' ');
  return script;
}

function makeConcept(overrides = {}) {
  return {
    title: 'Test Concept',
    hook_type: 'stat',
    hook_angle: 'How Alex Mathews is teaching AI to kids.',
    script: longScript(),
    creative_direction: ['close-up', 'handheld'],
    ...overrides,
  };
}

async function loadAlex() {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, campus_id, claude_project_context, content_format_preference, handle_tiktok, handle_instagram, handle_youtube')
    .eq('id', ALEX_ID)
    .single();
  if (error) throw new Error(`Preflight: ${error.message}`);
  return data;
}

async function main() {
  banner('PREFLIGHT');
  // Confirm migration is applied.
  const vqsProbe = await supabase.from('video_quality_scores').select('id').limit(1);
  if (vqsProbe.error) throw new Error(`video_quality_scores missing — run scripts/migrations/2026-04-22-brand-voice-validation.sql`);
  ok('video_quality_scores table exists');
  const studentProbe = await supabase.from('students').select('content_format_preference').eq('id', ALEX_ID).single();
  if (studentProbe.error) throw new Error(`content_format_preference missing — run migration`);
  ok('students.content_format_preference column exists');

  const alex = await loadAlex();
  if (!alex.claude_project_context) throw new Error('Preflight: Alex Mathews has no claude_project_context');
  ok(`student loaded: ${alex.name}`);
  ok(`content_format_preference = ${alex.content_format_preference || '(null, defaults to script)'}`);

  // ========================================================================
  // Case 1 — clean concept, gate mode → all pass.
  //
  // The concept is deliberately story-shaped (setup → conflict → resolution)
  // because Alex's claude_project_context extracts only "storytelling" as a
  // tone dimension, so Layer 2's tone-score threshold is effectively measuring
  // how well the concept narrates. A generic educational concept can score
  // 2/5 on storytelling and fail; a clear narrative reliably scores 4+.
  // ========================================================================
  banner('Case 1: clean concept (script, gate mode) → all pass');
  {
    const storyScript = [
      '3 months ago my brother sat in his room crying over his coding homework.',
      'Nothing was clicking for him and the class moved too fast.',
      'I watched a 9 year old give up on learning before he ever got started.',
      'So I began building something simple — an AI tutor designed for kids under 13.',
      'Clear blocks, short lessons, zero jargon.',
      'Last week he built his first chatbot and spent two hours explaining it back to me.',
      'That moment made the whole project worth it.',
      'This is what kids learning AI should look like.',
    ].join(' ');
    const storyConcept = {
      title: 'Brother First',
      hook_type: 'story',
      hook_angle: "How my brother's struggle pushed me to build Early-Ai.",
      script: storyScript,
      creative_direction: ['close-up on hands', 'soft natural light', 'overhead shot of kid at laptop'],
    };
    const result = await validator.validateConcept(storyConcept, alex, {
      mode: 'gate',
      campusId: AUSTIN_ID,
    });
    assert(result.layer1_passed === true, 'layer1_passed=true', `issues: ${JSON.stringify(result.layer1_issues)}`);
    assert(result.mode === 'gate', 'mode=gate');
    assert(result.format === 'script', 'format=script (default)');
    // layer2 may be null if Alex has no influencer_transcripts; acceptable
    if (result.layer2_passed === true) ok('layer2_passed=true');
    else if (result.layer2_passed === null) ok('layer2_passed=null (excerpt-thin or no transcripts — acceptable)');
    else fail('layer2_passed=false unexpectedly', JSON.stringify(result.layer2_notes));
    assert(result.overall_passed === true, 'overall_passed=true');
  }

  // ========================================================================
  // Case 2 — AI-tell phrase, log_only → issue captured, overall still passes.
  // ========================================================================
  banner("Case 2: AI-tell phrase (log_only) → issue captured, overall passes");
  {
    const dirty = makeConcept({ script: "let's dive in. " + longScript() });
    const result = await validator.validateConcept(dirty, alex, {
      mode: 'log_only',
      campusId: AUSTIN_ID,
    });
    const hasAiTell = (result.layer1_issues || []).some((i) => i.rule === 'ai_tell_phrase');
    assert(hasAiTell, 'layer1_issues contains ai_tell_phrase');
    assert(result.layer1_passed === false, 'layer1_passed=false');
    assert(result.overall_passed === true, 'overall_passed=true (log_only never gates)');
  }

  // ========================================================================
  // Case 3 — 200-word script → length_out_of_bounds fires.
  // ========================================================================
  banner('Case 3: 200-word script → length_out_of_bounds');
  {
    const bigScript = Array(220).fill('word').join(' ');
    const result = await validator.validateConcept(
      makeConcept({ script: bigScript }),
      alex,
      { mode: 'log_only', campusId: AUSTIN_ID }
    );
    const hasLen = (result.layer1_issues || []).some((i) => i.rule === 'length_out_of_bounds');
    assert(hasLen, 'length_out_of_bounds fired');
  }

  // ========================================================================
  // Case 4 — corporate voiced concept, gate → layer2 low.
  // ========================================================================
  banner('Case 4: corporate concept (gate) → layer2 low (real Claude)');
  if (process.env.SKIP_REAL_CLAUDE) {
    ok('skipped (SKIP_REAL_CLAUDE=1)');
  } else {
    const corporate = makeConcept({
      title: 'Synergy Alignment',
      hook_angle: 'Leveraging strategic initiatives for stakeholder value.',
      script:
        'Our mission-critical enterprise-grade paradigm enables seamless cross-functional synergies. ' +
        'We leverage best-in-class solutions to drive measurable outcomes. Stakeholders benefit from our ' +
        'holistic approach. Strategic alignment yields operational excellence. Market-leading innovation ' +
        'drives shareholder value across vertical segments. Our deliverables consistently exceed ' +
        'benchmarks. Enterprise transformation is our core competency. We deliver frameworks that ' +
        'enable organizations to achieve peak performance through rigorous analytical methodology.',
    });
    const result = await validator.validateConcept(corporate, alex, {
      mode: 'gate',
      campusId: AUSTIN_ID,
    });
    if (result.layer2_passed === false) ok('layer2_passed=false (judged off-voice)');
    else if (result.layer2_passed === null) ok('layer2_passed=null (Alex has no transcripts to compare against — acceptable)');
    else fail('layer2_passed=true unexpectedly for corporate concept', JSON.stringify(result.layer2_scores));
  }

  // ========================================================================
  // Case 5 — monkey-patch askJson to return malformed JSON → layer2_passed=null.
  // ========================================================================
  banner('Case 5: askJson throws → layer2_passed=null, no crash');
  {
    const originalAskJson = claudeModule.askJson;
    claudeModule.askJson = async () => { throw new Error('simulated parse failure'); };
    try {
      const result = await validator.validateConcept(makeConcept(), alex, {
        mode: 'gate',
        campusId: AUSTIN_ID,
      });
      assert(result.layer2_passed === null, 'layer2_passed=null on parse error');
      const notes = result.layer2_notes;
      const hasErr = notes && (notes.parse_error || (typeof notes === 'object' && 'parse_error' in notes));
      assert(!!hasErr, 'layer2_notes contains parse_error', `notes: ${JSON.stringify(notes)}`);
      // Layer 1 should still be true (clean concept); in gate mode, layer2=null doesn't gate.
      assert(result.layer1_passed === true, 'layer1_passed=true (clean concept)');
    } finally {
      claudeModule.askJson = originalAskJson;
    }
  }

  // ========================================================================
  // Case 6 — mode=off → no Claude call, overall_passed=true unconditionally.
  // ========================================================================
  banner('Case 6: mode=off → no Claude call, overall_passed=true');
  {
    let called = false;
    const originalAskJson = claudeModule.askJson;
    claudeModule.askJson = async () => { called = true; return {}; };
    try {
      const dirty = makeConcept({ script: "let's dive in. " + longScript() });
      const result = await validator.validateConcept(dirty, alex, {
        mode: 'off',
        campusId: AUSTIN_ID,
      });
      assert(called === false, 'claude.askJson NOT called');
      assert(result.overall_passed === true, 'overall_passed=true');
      assert(result.mode === 'off', 'mode=off');
    } finally {
      claudeModule.askJson = originalAskJson;
    }
  }

  // ========================================================================
  // Case 7 — format branching: flip Alex to caption_only, feed caption,
  // verify caption rules ran (not script length bound).
  // ========================================================================
  banner('Case 7: format branching (caption_only)');
  {
    // Always restore to 'script' (the default) rather than the pre-test value.
    // If a previous failed run left the student in caption_only, reading
    // original from alex would just re-preserve the bad state.
    await supabase.from('students').update({ content_format_preference: 'caption_only' }).eq('id', ALEX_ID);
    try {
      // 60-word caption — would fail script's 70-150 but should PASS caption's 20-150 range.
      const captionText = 'Here is a short caption about Alex Mathews and his Early-Ai project. ' +
        'It teaches kids AI fundamentals through building blocks. Tap follow for more.';
      const captionConcept = makeConcept({
        hook_angle: 'caption hook',
        script: captionText + '?', // trailing ? satisfies hook rule
      });
      const reloaded = await loadAlex();
      const result = await validator.validateConcept(captionConcept, reloaded, {
        mode: 'log_only',
        campusId: AUSTIN_ID,
      });
      assert(result.format === 'caption_only', `format=${result.format}`);
      const hasScriptLengthIssue = (result.layer1_issues || []).some(
        (i) => i.rule === 'length_out_of_bounds' && /caption/.test(i.detail)
      );
      // Caption within 20-150: should not trip the caption length rule.
      assert(!hasScriptLengthIssue, 'caption length rule did not fire on in-range caption');
    } finally {
      await supabase
        .from('students')
        .update({ content_format_preference: 'script' })
        .eq('id', ALEX_ID);
    }
  }

  // ========================================================================
  // Case 8 — null claude_project_context → layer2_passed=null, layer1 runs.
  // ========================================================================
  banner('Case 8: null claude_project_context → layer2_passed=null');
  {
    const nullCtxStudent = { ...alex, claude_project_context: null };
    let called = false;
    const originalAskJson = claudeModule.askJson;
    claudeModule.askJson = async () => { called = true; return {}; };
    try {
      const result = await validator.validateConcept(makeConcept(), nullCtxStudent, {
        mode: 'gate',
        campusId: AUSTIN_ID,
      });
      assert(result.layer2_passed === null, 'layer2_passed=null');
      assert(called === false, 'askJson not called (Layer 2 skipped)');
      assert(result.layer1_passed === true, 'layer1_passed=true (Layer 1 still ran)');
    } finally {
      claudeModule.askJson = originalAskJson;
    }
  }

  // ========================================================================
  // Case 9 — buildGenerationConstraints returns populated data;
  // deterministic excerpt seeding.
  // ========================================================================
  banner('Case 9: buildGenerationConstraints populated + deterministic');
  {
    const a = await validator.buildGenerationConstraints(alex, { campusId: AUSTIN_ID });
    const b = await validator.buildGenerationConstraints(alex, { campusId: AUSTIN_ID });
    assert(Array.isArray(a.hardConstraints.ai_tell_blocklist) && a.hardConstraints.ai_tell_blocklist.length > 0, 'hardConstraints.ai_tell_blocklist populated');
    assert(a.hardConstraints.length_bounds && typeof a.hardConstraints.length_bounds.max === 'number', 'hardConstraints.length_bounds populated');
    assert(Array.isArray(a.softGuidelines.tone_dimensions), 'softGuidelines.tone_dimensions is an array');
    // brand_dictionary should have Alpha/Superbuilders/Timeback for Austin (seeded Session 2)
    const bdLen = a.hardConstraints.brand_dictionary.length;
    assert(bdLen >= 1, `hardConstraints.brand_dictionary has ≥1 term (got ${bdLen})`);
    // Deterministic: same student.id → same excerpts
    const excerptsA = JSON.stringify(a.softGuidelines.voice_excerpts);
    const excerptsB = JSON.stringify(b.softGuidelines.voice_excerpts);
    assert(excerptsA === excerptsB, 'voice_excerpts deterministic across calls');
  }

  // ========================================================================
  // Case 10 — E2E round trip through real Claude generation + validation.
  // ========================================================================
  banner('Case 10: E2E round trip (real Claude)');
  if (process.env.SKIP_REAL_CLAUDE) {
    ok('skipped (SKIP_REAL_CLAUDE=1)');
  } else {
    const constraints = await validator.buildGenerationConstraints(alex, { campusId: AUSTIN_ID });
    const hc = constraints.hardConstraints;
    const system = [
      'You write short-form video concepts for a high-school student creator.',
      'Output exactly one JSON concept (not an array), no prose, no fences:',
      '{"title":"1-4 words","hook_type":"stat","hook_angle":"one sentence","script":"70-150 words","creative_direction":["bullet"]}',
      '',
      'HARD CONSTRAINTS:',
      `- MUST NOT contain any of: ${hc.ai_tell_blocklist.map((p) => `"${p}"`).join(', ')}`,
      `- Script MUST be ${hc.length_bounds.min}-${hc.length_bounds.max} words`,
      `- Brand terms MUST be exact-cased: ${hc.brand_dictionary.map((t) => t.term).join(', ')}`,
      `- MUST NOT open with: ${hc.forbidden_generic_openers.map((o) => `"${o}"`).join(', ')}`,
      `- Only these proper nouns allowed: ${hc.allowed_proper_nouns.slice(0, 20).join(', ')}`,
    ].join('\n');
    const prompt = `STUDENT: ${alex.name}\nSTUDENT CONTEXT:\n${alex.claude_project_context.slice(0, 2000)}\nReturn a single concept about AI education for kids.`;

    const raw = await claudeModule.askJson({ system, prompt, maxTokens: 1500 });
    // Accept both array-of-one and single object shape.
    const concept = Array.isArray(raw) ? raw[0] : raw;
    assert(concept && typeof concept === 'object', 'Claude returned parseable concept');

    const result = await validator.validateConcept(concept, alex, {
      mode: 'log_only',
      campusId: AUSTIN_ID,
    });
    const gatingIssues = (result.layer1_issues || []).filter((i) => i.severity === 'error');
    assert(gatingIssues.length === 0, `Claude output respected hard constraints — 0 gating issues`, `issues: ${JSON.stringify(gatingIssues)}`);
    console.log(`    Claude output script length: ${String(concept.script || '').split(/\s+/).filter(Boolean).length} words`);
  }

  // ========================================================================
  // Case 11 — escalation to failed_cleanup after 3 consecutive gate aborts.
  // ========================================================================
  banner('Case 11: 3 consecutive gate aborts → failed_cleanup');
  const eventId = `${TEST_PREFIX}_escalation_event`;
  const fakeEvent = { id: eventId, title: `${TEST_PREFIX} Filming with Alex Mathews`, description: '', startTime: new Date().toISOString() };
  const originalAskJson = claudeModule.askJson;
  const originalMode = process.env.BRAND_VOICE_VALIDATION_MODE;
  process.env.BRAND_VOICE_VALIDATION_MODE = 'gate';

  // Stub returns concepts that fail Layer 1 (AI-tell) for generation calls,
  // and returns passing Layer 2 responses for judge calls.
  claudeModule.askJson = async ({ system }) => {
    const isJudge = system && system.includes('content-voice judge');
    if (isJudge) {
      return {
        scores: { conversational: { score: 5, note: 'ok' }, casual: { score: 5, note: 'ok' } },
        voice_match_score: 5,
        voice_match_note: 'ok',
        overall_pass: true,
      };
    }
    // Generation call — each concept embeds an AI-tell phrase and a real
    // student name so Layer 1 consistently fails on ai_tell_phrase.
    const dirty = (t) => ({
      title: t,
      hook_type: 'stat',
      hook_angle: `A look at ${alex.name} and the Early-Ai project.`,
      script: "let's dive in. " + longScript(),
      creative_direction: ['close-up'],
    });
    return [dirty('Alpha AI'), dirty('Kids Coding'), dirty('Build Early')];
  };

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await scripting.processEvent(fakeEvent, AUSTIN_ID);
      const { data: claim } = await supabase
        .from('processed_calendar_events')
        .select('id, status, error_payload')
        .eq('campus_id', AUSTIN_ID)
        .eq('event_id', eventId)
        .maybeSingle();

      if (attempt <= 2) {
        // Below threshold — claim should have been deleted (retryable).
        assert(!claim, `attempt ${attempt}: no processed_calendar_events row (retry allowed)`);
        assert(res && res.aborted === true && res.escalated === false, `attempt ${attempt}: aborted without escalation`);
      } else {
        // At threshold — claim should be failed_cleanup.
        assert(claim && claim.status === 'failed_cleanup', `attempt ${attempt}: claim.status=failed_cleanup`);
        const payload = claim && claim.error_payload;
        assert(payload && payload.abortCount >= 3, `error_payload.abortCount >= 3 (got ${payload && payload.abortCount})`);
        assert(res && res.aborted === true && res.escalated === true, `attempt ${attempt}: aborted with escalation`);
      }
    }

    // A 4th call should short-circuit on the fast dedup check.
    const res4 = await scripting.processEvent(fakeEvent, AUSTIN_ID);
    assert(res4 && res4.skipped === 'already_claimed:failed_cleanup', `4th call skipped: ${res4 && res4.skipped}`);
  } finally {
    claudeModule.askJson = originalAskJson;
    if (originalMode === undefined) delete process.env.BRAND_VOICE_VALIDATION_MODE;
    else process.env.BRAND_VOICE_VALIDATION_MODE = originalMode;
    // Teardown: delete the failed_cleanup claim.
    await supabase
      .from('processed_calendar_events')
      .delete()
      .eq('campus_id', AUSTIN_ID)
      .eq('event_id', eventId);
  }

  // ========================================================================
  // Final summary
  // ========================================================================
  banner('SUMMARY');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nPASS');
}

main().catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
