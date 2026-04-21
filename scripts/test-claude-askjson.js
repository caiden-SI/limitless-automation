#!/usr/bin/env node
/**
 * Unit tests for lib/claude.js parseClaudeJson — the extractor that drives
 * askJson(). Pure tests, no API calls.
 *
 * Run: node scripts/test-claude-askjson.js
 */

require('dotenv').config();

const { parseClaudeJson, extractBalanced } = require('../lib/claude');

let passed = 0;
let failed = 0;

function pass(name) { console.log('  \u2713 ' + name); passed++; }
function fail(name, detail) { console.log('  \u2717 ' + name + (detail ? ' \u2014 ' + detail : '')); failed++; }

function expectEqual(name, input, expected) {
  let actual;
  try {
    actual = parseClaudeJson(input);
  } catch (err) {
    return fail(name, 'threw: ' + err.message);
  }
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(name);
  else fail(name, `got ${a}, expected ${e}`);
}

function expectThrow(name, input) {
  try {
    const v = parseClaudeJson(input);
    fail(name, 'did not throw, got: ' + JSON.stringify(v));
  } catch {
    pass(name);
  }
}

function section(title) {
  console.log('\n' + title);
}

// ── Clean JSON ────────────────────────────────────────
section('Clean JSON');
expectEqual('object', '{"a": 1}', { a: 1 });
expectEqual('array', '[1, 2, 3]', [1, 2, 3]);
expectEqual('empty object', '{}', {});
expectEqual('empty array', '[]', []);
expectEqual('nested', '{"a": [1, {"b": 2}], "c": "d"}', { a: [1, { b: 2 }], c: 'd' });

// ── Markdown fences ────────────────────────────────────────
section('JSON in markdown fences');
expectEqual('object in ```json fences', '```json\n{"a": 1}\n```', { a: 1 });
expectEqual('array in ```json fences', '```json\n[1,2,3]\n```', [1, 2, 3]);
expectEqual('bare ``` fences', '```\n{"a": 1}\n```', { a: 1 });
expectEqual('uppercase ```JSON fences', '```JSON\n{"a": 1}\n```', { a: 1 });

// ── Trailing prose (the regression case from Session 10 E2E) ───
section('JSON followed by prose');
expectEqual(
  'object + trailing sentence',
  '{"a": 1}\n\nThat is the answer.',
  { a: 1 }
);
expectEqual(
  'object in fences + trailing explanation',
  '```json\n{"detections": []}\n```\n\nThe transcript is clean with no stutters.',
  { detections: [] }
);
expectEqual(
  'object + multi-paragraph trailing prose',
  '```json\n{"issues": []}\n```\n\nThe SRT is properly formatted:\n- Proper capitalization\n- Line lengths within limits',
  { issues: [] }
);
expectEqual(
  'array + trailing prose',
  '[{"title": "x"}]\n\nThat covers all concepts.',
  [{ title: 'x' }]
);

// ── Leading prose ────────────────────────────────────────
section('JSON preceded by prose');
expectEqual(
  'leading "Here\'s the result:"',
  "Here's the result: {\"a\": 1}",
  { a: 1 }
);
expectEqual(
  'multi-line leading preamble',
  'Here is my analysis:\n\n{"classification": "bug"}',
  { classification: 'bug' }
);
expectEqual(
  'leading prose + fenced JSON',
  'Sure, here you go:\n\n```json\n{"ok": true}\n```',
  { ok: true }
);

// ── Leading prose that contains decoy brackets ──────────────
section('Pathological input with decoy brackets');
expectEqual(
  '"[see below]" prose then valid JSON',
  '[see below]\n\n{"a": 1}',
  { a: 1 }
);
expectEqual(
  'broken object then valid one',
  '{broken,\n{"a": 1}',
  { a: 1 }
);

// ── Strings containing brackets ────────────────────────────
section('JSON where string values contain brackets');
expectEqual('string with braces', '{"msg": "hello {world}"}', { msg: 'hello {world}' });
expectEqual('string with brackets', '{"msg": "arr[0]"}', { msg: 'arr[0]' });
expectEqual('escaped quotes in string', '{"k": "he said \\"hi\\""}', { k: 'he said "hi"' });
expectEqual('escaped backslash + quote', '{"k": "a\\\\b"}', { k: 'a\\b' });

// ── Error cases ────────────────────────────────────────
section('Errors');
expectThrow('empty string', '');
expectThrow('only prose', 'No JSON here, just plain text.');
expectThrow('unbalanced', '{"a":');
expectThrow('unbalanced array', '[1, 2,');

// ── Real shapes from our agents ──────────────────────────
section('Real agent-response shapes');
expectEqual(
  'scripting agent (array of 3 concepts)',
  '[{"title":"A","hook_type":"stat","hook_angle":"x","script":"y","creative_direction":["z"]},'
  + '{"title":"B","hook_type":"story","hook_angle":"x","script":"y","creative_direction":["z"]},'
  + '{"title":"C","hook_type":"shock","hook_angle":"x","script":"y","creative_direction":["z"]}]',
  [
    { title: 'A', hook_type: 'stat', hook_angle: 'x', script: 'y', creative_direction: ['z'] },
    { title: 'B', hook_type: 'story', hook_angle: 'x', script: 'y', creative_direction: ['z'] },
    { title: 'C', hook_type: 'shock', hook_angle: 'x', script: 'y', creative_direction: ['z'] },
  ]
);
expectEqual(
  'self-heal diagnosis (object, fenced, with trailing rationale)',
  '```json\n{"classification":"transient","confidence":"high","recovery_action":"retry","recovery_params":{},"human_summary":"503 transient"}\n```\n\nThis error is a classic transient 5xx.',
  { classification: 'transient', confidence: 'high', recovery_action: 'retry', recovery_params: {}, human_summary: '503 transient' }
);

// ── extractBalanced direct ────────────────────────────────────────
section('extractBalanced (direct)');
{
  const t = 'abc{"a":1}def';
  const got = extractBalanced(t, 3);
  if (got === '{"a":1}') pass('extractBalanced returns matched span');
  else fail('extractBalanced returns matched span', `got ${got}`);
}
{
  // String literal with a closing brace — should NOT terminate early
  const t = '{"s":"}"}';
  const got = extractBalanced(t, 0);
  if (got === '{"s":"}"}') pass('extractBalanced respects string literals');
  else fail('extractBalanced respects string literals', `got ${got}`);
}
{
  // Unbalanced
  if (extractBalanced('{"a":1', 0) === null) pass('extractBalanced returns null on unbalanced');
  else fail('extractBalanced returns null on unbalanced');
}

// ── Report ────────────────────────────────────────
console.log('\n' + '━'.repeat(50));
console.log(`  ${passed}/${passed + failed} passed, ${failed} failed`);
console.log('━'.repeat(50));
if (failed > 0) process.exit(1);
