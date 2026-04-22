// Brand Voice Validator — universal quality floor (Layer 1) + per-student
// voice/tone judge (Layer 2). Source of truth for the rule set; both the
// validator and the Scripting Agent's generation prompt read from the same
// constants, so tuning one changes both.
//
// Spec: workflows/brand-voice-validation.md

const claude = require('./claude');
const { supabase } = require('./supabase');
const { log } = require('./logger');

// ============================================================================
// TUNABLE CONSTANTS
// ============================================================================

const VALIDATOR_VERSION = '2026-04-22';

// Substring-matched (case-insensitive) against title + hook_angle + script +
// creative_direction. Each hit is one Layer 1 issue, severity 'error'.
const AI_TELL_PHRASES = [
  "let's dive in",
  "in today's video",
  "buckle up",
  "game-changer",
  "at the end of the day",
  "unleash the power",
  "revolutionize",
  "it's important to note",
  "in this video we'll",
  "needle-moving",
  "level up",
  "take it to the next level",
];

// Prefix-matched against the first 20 chars of the script.
const FORBIDDEN_GENERIC_OPENERS = [
  'Hey guys',
  "What's up",
  'Hi everyone',
  'Welcome back',
  'So today',
];

const SCRIPT_LENGTH_BOUNDS = { min: 70, max: 150 };

// Platform-aware caps. `default` when platform is unknown.
const CAPTION_LENGTH_BOUNDS = {
  min: 20,
  max: { tiktok: 150, instagram: 125, default: 150 },
};

const OST_SEGMENT_BOUNDS = {
  minSegments: 3,
  maxSegments: 15,
  maxWordsPerSegment: 12,
};

// Hook-shape signals: question mark, digit, contradiction keyword, or a
// concrete noun from the student's project context.
const CONTRADICTION_KEYWORDS = ['but', 'however', 'actually', 'surprisingly', 'except'];

// Deterministic keyword set used to extract tone dimensions from
// claude_project_context. Expand as Scott's vocabulary evolves — kept
// intentionally conservative; `extraction_thin` is the fallback.
const TONE_TAGS = [
  'conversational',
  'self-deprecating',
  'technical-but-accessible',
  'fast-paced',
  'understated',
  'energetic',
  'deadpan',
  'earnest',
  'playful',
  'analytical',
  'poetic',
  'blunt',
  'wry',
  'warm',
  'intense',
  'casual',
  'formal',
  'storytelling',
  'instructional',
  'dry-humor',
  'raw',
  'vulnerable',
  'ironic',
  'punchy',
];

// CTA-only endings — script must have additional content after these.
const CTA_PATTERNS = [
  /^follow\s+for\s+more\.?$/i,
  /^like\s+and\s+subscribe\.?$/i,
  /^hit\s+that\s+like\s+button\.?$/i,
  /^don'?t\s+forget\s+to\s+subscribe\.?$/i,
  /^subscribe\s+for\s+more\.?$/i,
  /^smash\s+that\s+like\.?$/i,
];

// Layer 2 thresholds. Standard applies when ≥2 tone dimensions could be
// extracted from claude_project_context; Loosened when <2 (the judge still
// runs but we soften the bar because we have less signal to judge against).
const STANDARD_THRESHOLDS = { tone: 4, voiceMatch: 4 };
const LOOSE_THRESHOLDS = { tone: 3, voiceMatch: 3 };

const AGENT_NAME = 'brand_voice_validator';

// ============================================================================
// HELPERS
// ============================================================================

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Simple deterministic string → u32 hash. Used to seed excerpt shuffle. */
function hashStringToInt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

/** Deterministic Fisher-Yates using a seeded mulberry32-like PRNG. */
function seededShuffle(array, seed) {
  let t = hashStringToInt(String(seed));
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    const j = (r >>> 0) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function conceptToHaystack(concept) {
  const cd = Array.isArray(concept.creative_direction) ? concept.creative_direction.join(' ') : '';
  return `${concept.title || ''} ${concept.hook_angle || ''} ${concept.script || ''} ${cd}`;
}

function extractFirstSentence(text) {
  if (!text) return '';
  const m = String(text).match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : String(text)).trim();
}

/** Split OST content into segments on newlines, bullets, or numbered list markers. */
function splitOstSegments(concept) {
  const raw = String(concept.script || '');
  return raw
    .split(/\r?\n|(?:^|\s)(?:[-•·]|\d+\.)\s+/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ============================================================================
// LAYER 1 — deterministic rules
// ============================================================================

function checkAiTellPhrases(concept) {
  const haystack = conceptToHaystack(concept).toLowerCase();
  const issues = [];
  for (const phrase of AI_TELL_PHRASES) {
    if (haystack.includes(phrase.toLowerCase())) {
      issues.push({ rule: 'ai_tell_phrase', detail: `matched "${phrase}"`, severity: 'error' });
    }
  }
  return issues;
}

function checkBrandDictionary(concept, brandTerms) {
  if (!Array.isArray(brandTerms) || brandTerms.length === 0) return [];
  const haystack = conceptToHaystack(concept);
  const issues = [];
  for (const term of brandTerms) {
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
    let m;
    const seen = new Set();
    while ((m = re.exec(haystack)) !== null) {
      const found = m[0];
      if (found !== term && !seen.has(found)) {
        seen.add(found);
        issues.push({
          rule: 'brand_dictionary_casing',
          detail: `found "${found}" but dictionary has "${term}"`,
          severity: 'error',
        });
      }
    }
  }
  return issues;
}

function checkLengthBounds(concept, format, platformHint) {
  const script = String(concept.script || '').trim();
  const issues = [];

  if (format === 'script' || format === 'mixed') {
    const wc = script.split(/\s+/).filter(Boolean).length;
    if (wc < SCRIPT_LENGTH_BOUNDS.min || wc > SCRIPT_LENGTH_BOUNDS.max) {
      issues.push({
        rule: 'length_out_of_bounds',
        detail: `script is ${wc} words, expected ${SCRIPT_LENGTH_BOUNDS.min}-${SCRIPT_LENGTH_BOUNDS.max}`,
        severity: 'error',
      });
    }
  } else if (format === 'caption_only') {
    const wc = script.split(/\s+/).filter(Boolean).length;
    const max = CAPTION_LENGTH_BOUNDS.max[platformHint] || CAPTION_LENGTH_BOUNDS.max.default;
    if (wc < CAPTION_LENGTH_BOUNDS.min || wc > max) {
      issues.push({
        rule: 'length_out_of_bounds',
        detail: `caption is ${wc} words, expected ${CAPTION_LENGTH_BOUNDS.min}-${max}${platformHint ? ` (${platformHint})` : ''}`,
        severity: 'error',
      });
    }
  } else if (format === 'on_screen_text') {
    const segments = splitOstSegments(concept);
    if (segments.length < OST_SEGMENT_BOUNDS.minSegments || segments.length > OST_SEGMENT_BOUNDS.maxSegments) {
      issues.push({
        rule: 'ost_segment_count_out_of_bounds',
        detail: `${segments.length} segments, expected ${OST_SEGMENT_BOUNDS.minSegments}-${OST_SEGMENT_BOUNDS.maxSegments}`,
        severity: 'error',
      });
    }
    segments.forEach((seg, i) => {
      const wc = seg.split(/\s+/).filter(Boolean).length;
      if (wc > OST_SEGMENT_BOUNDS.maxWordsPerSegment) {
        issues.push({
          rule: 'ost_segment_too_long',
          detail: `segment ${i + 1} has ${wc} words, max ${OST_SEGMENT_BOUNDS.maxWordsPerSegment}`,
          severity: 'error',
        });
      }
    });
  }

  return issues;
}

function checkHookPresence(concept, studentContextKeywords, format) {
  const issues = [];
  let target = '';

  if (format === 'script' || format === 'mixed') {
    target = extractFirstSentence(concept.script);
  } else if (format === 'caption_only') {
    target = String(concept.script || '').split(/\r?\n/)[0];
  } else if (format === 'on_screen_text') {
    target = splitOstSegments(concept)[0] || '';
  }

  if (!target) {
    issues.push({ rule: 'weak_hook', detail: 'no first-sentence / first-segment / first-line found', severity: 'error' });
    return issues;
  }

  const hasQuestion = target.includes('?');
  const hasDigit = /\d/.test(target);
  const hasContradiction = CONTRADICTION_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(target));
  const hasConcreteNoun = (studentContextKeywords || []).some(
    (kw) => kw && new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i').test(target)
  );

  if (!hasQuestion && !hasDigit && !hasContradiction && !hasConcreteNoun) {
    issues.push({
      rule: 'weak_hook',
      detail: 'first sentence lacks a question mark, digit, contradiction keyword, or concrete noun from the student context',
      severity: 'error',
    });
  }
  return issues;
}

function checkGenericOpener(concept, format) {
  if (format === 'on_screen_text') return [];
  const firstChars = String(concept.script || '').trimStart().slice(0, 20).toLowerCase();
  for (const opener of FORBIDDEN_GENERIC_OPENERS) {
    if (firstChars.startsWith(opener.toLowerCase())) {
      return [{ rule: 'generic_opener', detail: `script opens with forbidden opener "${opener}"`, severity: 'error' }];
    }
  }
  return [];
}

function checkEndingIsPayoff(concept, format) {
  if (format !== 'script' && format !== 'mixed') return [];
  const script = String(concept.script || '').trim();
  if (!script) return [];
  const sentences = script.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const last = (sentences[sentences.length - 1] || '').trim();
  for (const pat of CTA_PATTERNS) {
    if (pat.test(last)) {
      return [{ rule: 'bare_cta_ending', detail: `last sentence is only a CTA: "${last}"`, severity: 'error' }];
    }
  }
  return [];
}

/**
 * Proper-noun hallucination heuristic. ALWAYS severity='warn' and NEVER
 * contributes to layer1_passed — see SOP line 100. The capitalized-word
 * heuristic produces too many false positives to hard-fail on; it surfaces
 * candidates for manual review, no more.
 */
function checkProperNouns(concept, allowedTerms) {
  const issues = [];
  const allowSet = new Set((allowedTerms || []).filter(Boolean).map((t) => String(t).toLowerCase()));
  const text = `${concept.title || ''} ${concept.hook_angle || ''} ${concept.script || ''}`;
  const words = text.split(/\s+/);
  const seen = new Set();

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const stripped = raw.replace(/[^\w]/g, '');
    if (!/^[A-Z][a-z]+$/.test(stripped)) continue;

    const prev = words[i - 1] || '';
    const isSentenceStart = i === 0 || /[.!?]$/.test(prev);
    if (isSentenceStart) continue;

    const key = stripped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (!allowSet.has(key)) {
      issues.push({
        rule: 'possible_hallucination',
        detail: `proper noun "${stripped}" not found in allowed terms`,
        severity: 'warn',
      });
    }
  }
  return issues;
}

// ============================================================================
// LAYER 2 — Claude judge
// ============================================================================

/** Deterministic keyword scan against TONE_TAGS. No LLM sub-pass in Phase 1. */
function extractToneDimensions(claudeProjectContext) {
  if (!claudeProjectContext) return [];
  const text = String(claudeProjectContext).toLowerCase();
  const hits = [];
  for (const tag of TONE_TAGS) {
    if (text.includes(tag.toLowerCase())) hits.push(tag);
    if (hits.length >= 5) break;
  }
  return hits;
}

/** Pull 3 excerpts from the student's influencer_transcripts, seeded by student.id. */
function selectVoiceExcerpts(influencerTranscripts, studentId) {
  if (!influencerTranscripts || typeof influencerTranscripts !== 'object') return [];
  const flat = [];

  // Shape from agents/onboarding.js Section 3: array of { handle, platform, transcripts: [string, ...] }
  const arr = Array.isArray(influencerTranscripts) ? influencerTranscripts : [influencerTranscripts];
  for (const entry of arr) {
    if (!entry || !Array.isArray(entry.transcripts)) continue;
    const source = `${entry.platform || '?'}/@${entry.handle || '?'}`;
    for (const t of entry.transcripts) {
      if (typeof t === 'string' && t.trim()) {
        flat.push({ source, text: t.trim().slice(0, 300) });
      }
    }
  }

  if (flat.length === 0) return [];
  const shuffled = seededShuffle(flat, studentId);
  return shuffled.slice(0, 3);
}

/** Extract short keywords from claude_project_context for hook-concreteness check. */
function extractContextKeywords(claudeProjectContext, studentName) {
  const out = new Set();
  if (studentName) out.add(studentName);
  if (!claudeProjectContext) return [...out];
  const text = String(claudeProjectContext);
  // Capitalized multi-letter words (proper nouns / project names). Filter
  // very common ones so the hook check is meaningful.
  const caps = text.match(/\b[A-Z][a-zA-Z0-9\-]{2,}\b/g) || [];
  const stop = new Set(['The', 'This', 'That', 'These', 'Those', 'And', 'But', 'For', 'Student', 'Alpha', 'School']);
  for (const w of caps) {
    if (!stop.has(w)) out.add(w);
    if (out.size >= 30) break;
  }
  return [...out];
}

async function runLayer2({ concept, student, excerpts, toneDimensions }) {
  const dims = toneDimensions.length ? toneDimensions : ['conversational', 'natural'];
  const extractionThin = toneDimensions.length < 2;

  const system = [
    'You are a content-voice judge. You rate whether a short-form video concept matches',
    "a student creator's voice signature. Output strict JSON only — no prose wrapper, no markdown fences.",
  ].join(' ');

  const excerptBlock = excerpts.length
    ? excerpts.map((e, i) => `${i + 1}. [${e.source}] "${e.text}"`).join('\n')
    : '(no voice excerpts available — judge from tone dimensions alone)';

  const schemaKeys = dims.map((d) => `"${d}": { "score": <1-5 integer>, "note": "<one sentence>" }`).join(',\n    ');

  const prompt = [
    `STUDENT: ${student.name || '(unknown)'}`,
    '',
    `TONE DIMENSIONS TO RATE (1-5, higher = better match):`,
    ...dims.map((d) => `- ${d}`),
    '',
    'VOICE EXCERPTS — real content the student said they want to sound like:',
    excerptBlock,
    '',
    'CONCEPT TO JUDGE:',
    `Title: ${concept.title || ''}`,
    `Hook angle: ${concept.hook_angle || ''}`,
    `Script / caption / OST content:`,
    String(concept.script || '').slice(0, 2000),
    '',
    'Return JSON matching this schema exactly:',
    '{',
    '  "scores": {',
    `    ${schemaKeys}`,
    '  },',
    '  "voice_match_score": <1-5 integer, comparing concept to the excerpts above>,',
    '  "voice_match_note": "<one sentence>",',
    '  "overall_pass": <boolean — your advisory judgment; validator recomputes from scores>',
    '}',
  ].join('\n');

  const hasExcerpts = excerpts.length > 0;

  try {
    const raw = await claude.askJson({ system, prompt, maxTokens: 1024 });
    return validateLayer2Response(raw, dims, extractionThin, hasExcerpts);
  } catch (err) {
    return {
      layer2_passed: null,
      layer2_scores: null,
      layer2_notes: { parse_error: err.message },
    };
  }
}

function validateLayer2Response(raw, dims, extractionThin, hasExcerpts = true) {
  const notes = { raw };
  if (!raw || typeof raw !== 'object') {
    return { layer2_passed: null, layer2_scores: null, layer2_notes: { ...notes, parse_error: 'response was not an object' } };
  }

  const scores = raw.scores;
  const voiceMatchScore = raw.voice_match_score;

  if (!scores || typeof scores !== 'object' || Object.keys(scores).length === 0) {
    return { layer2_passed: null, layer2_scores: scores || null, layer2_notes: { ...notes, parse_error: 'scores missing or empty' } };
  }

  const toneScores = [];
  for (const d of dims) {
    const entry = scores[d];
    if (entry && typeof entry.score === 'number' && entry.score >= 1 && entry.score <= 5) {
      toneScores.push(entry.score);
    } else {
      // Missing or out-of-range dimension counts as a score of 1 (fail-closed).
      toneScores.push(null);
    }
  }

  const validVoiceMatch = typeof voiceMatchScore === 'number' && voiceMatchScore >= 1 && voiceMatchScore <= 5;

  const thresholds = extractionThin ? LOOSE_THRESHOLDS : STANDARD_THRESHOLDS;
  const allToneOk = toneScores.every((s) => s !== null && s >= thresholds.tone);
  // voice_match_score is excluded from threshold when either:
  //   - the response was missing/invalid (can't judge), or
  //   - no excerpts were provided to the judge (SOP edge case line 233 —
  //     Claude was told to score on tone dimensions alone, so any score it
  //     returns is advisory only).
  const voiceOk = !hasExcerpts || !validVoiceMatch ? true : voiceMatchScore >= thresholds.voiceMatch;

  const passed = allToneOk && voiceOk;

  return {
    layer2_passed: passed,
    layer2_scores: { ...raw, extraction_thin: extractionThin, thresholds_used: thresholds, voice_match_excluded: !hasExcerpts },
    layer2_notes: raw.voice_match_note || null,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

function resolveMode(opts) {
  if (opts && opts.mode) return opts.mode;
  const env = (process.env.BRAND_VOICE_VALIDATION_MODE || '').trim();
  if (env === 'gate' || env === 'log_only' || env === 'off') return env;
  return 'log_only';
}

/** Shared context read once per batch. Never throws. */
async function loadSharedContext(student, campusId) {
  const ctx = {
    brandTerms: [],
    campusName: null,
    allowedProperNouns: [],
    influencerTranscripts: null,
    toneDimensions: [],
    excerpts: [],
    studentContextKeywords: [],
  };

  try {
    const [brandRes, campusRes, sessionRes] = await Promise.all([
      supabase.from('brand_dictionary').select('term').eq('campus_id', campusId),
      supabase.from('campuses').select('name').eq('id', campusId).maybeSingle(),
      supabase
        .from('onboarding_sessions')
        .select('influencer_transcripts')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    ctx.brandTerms = (brandRes.data || []).map((r) => r.term).filter(Boolean);
    ctx.campusName = campusRes.data?.name || null;
    ctx.influencerTranscripts = sessionRes.data?.influencer_transcripts || null;
  } catch (_err) {
    // Fall through — validator-never-throws contract.
  }

  ctx.toneDimensions = extractToneDimensions(student.claude_project_context);
  ctx.excerpts = selectVoiceExcerpts(ctx.influencerTranscripts, student.id);
  ctx.studentContextKeywords = extractContextKeywords(student.claude_project_context, student.name);

  const allowed = new Set();
  if (student.name) allowed.add(student.name);
  if (student.handle_tiktok) allowed.add(String(student.handle_tiktok).replace(/^@/, ''));
  if (student.handle_instagram) allowed.add(String(student.handle_instagram).replace(/^@/, ''));
  if (student.handle_youtube) allowed.add(String(student.handle_youtube).replace(/^@/, ''));
  if (ctx.campusName) allowed.add(ctx.campusName);
  for (const t of ctx.brandTerms) allowed.add(t);
  for (const kw of ctx.studentContextKeywords) allowed.add(kw);
  ctx.allowedProperNouns = [...allowed];

  return ctx;
}

/**
 * Validate a single concept. Never throws — on internal error returns
 * `{ overall_passed: true, mode: 'off', validator_error }`.
 */
async function validateConcept(concept, student, opts = {}) {
  const mode = resolveMode(opts);
  const format = opts.format || student?.content_format_preference || 'script';
  const platformHint = opts.platformHint || null;

  if (mode === 'off') {
    return {
      layer1_passed: true,
      layer1_issues: [],
      layer2_passed: null,
      layer2_scores: null,
      layer2_notes: null,
      overall_passed: true,
      mode,
      format,
      validator_version: VALIDATOR_VERSION,
    };
  }

  try {
    const ctx = opts.sharedContext || (await loadSharedContext(student, opts.campusId || student?.campus_id));

    const issues = [
      ...checkAiTellPhrases(concept),
      ...checkBrandDictionary(concept, ctx.brandTerms),
      ...checkLengthBounds(concept, format, platformHint),
      ...checkHookPresence(concept, ctx.studentContextKeywords, format),
      ...checkGenericOpener(concept, format),
      ...checkEndingIsPayoff(concept, format),
      ...checkProperNouns(concept, ctx.allowedProperNouns),
    ];

    // Proper-noun warnings never contribute to layer1_passed per SOP line 100.
    const gatingIssues = issues.filter((i) => i.severity === 'error');
    const layer1_passed = gatingIssues.length === 0;

    // Edge case: null claude_project_context skips Layer 2. SOP line 232.
    let layer2 = { layer2_passed: null, layer2_scores: null, layer2_notes: null };
    if (student?.claude_project_context) {
      layer2 = await runLayer2({
        concept,
        student,
        excerpts: ctx.excerpts,
        toneDimensions: ctx.toneDimensions,
      });
    } else {
      layer2.layer2_notes = 'skipped — student has no claude_project_context';
    }

    const overall_passed =
      mode === 'log_only'
        ? true
        : layer1_passed && (layer2.layer2_passed !== false);
    // Note: layer2_passed === null (parse error / skipped) does NOT gate — see SOP line 224.

    const result = {
      layer1_passed,
      layer1_issues: issues,
      layer2_passed: layer2.layer2_passed,
      layer2_scores: layer2.layer2_scores,
      layer2_notes: layer2.layer2_notes,
      overall_passed,
      mode,
      format,
      validator_version: VALIDATOR_VERSION,
    };

    const status = layer1_passed && (layer2.layer2_passed !== false) ? 'success' : 'warning';
    await log({
      campusId: opts.campusId || student?.campus_id || null,
      agent: AGENT_NAME,
      action: 'brand_voice_validate',
      status,
      payload: {
        mode,
        format,
        layer1_passed,
        layer2_passed: layer2.layer2_passed,
        overall_passed,
        issue_count: issues.length,
        gating_issue_count: gatingIssues.length,
      },
    });

    return result;
  } catch (err) {
    // Validator crash — degrade to mode=off per SOP line 180 & CLAUDE.md.
    await log({
      campusId: opts.campusId || student?.campus_id || null,
      agent: AGENT_NAME,
      action: 'brand_voice_validate_crashed',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack },
    });
    return {
      layer1_passed: true,
      layer1_issues: [],
      layer2_passed: null,
      layer2_scores: null,
      layer2_notes: null,
      overall_passed: true,
      mode: 'off',
      format,
      validator_version: VALIDATOR_VERSION,
      validator_error: err.message,
    };
  }
}

/**
 * Validate a batch of concepts. Shares one context load across them so we
 * don't hit Supabase 3× per event.
 */
async function validateConcepts(concepts, student, opts = {}) {
  if (!Array.isArray(concepts)) throw new Error('validateConcepts: concepts must be an array');
  const mode = resolveMode(opts);
  if (mode === 'off') {
    return concepts.map((c) => ({
      layer1_passed: true,
      layer1_issues: [],
      layer2_passed: null,
      layer2_scores: null,
      layer2_notes: null,
      overall_passed: true,
      mode,
      format: opts.format || student?.content_format_preference || 'script',
      validator_version: VALIDATOR_VERSION,
    }));
  }

  let sharedContext;
  try {
    sharedContext = await loadSharedContext(student, opts.campusId || student?.campus_id);
  } catch (err) {
    // If the shared fetch itself fails, fall through with empty context;
    // individual validators will still run self-contained fetches.
    sharedContext = null;
  }

  const results = [];
  for (const concept of concepts) {
    const r = await validateConcept(concept, student, { ...opts, sharedContext });
    results.push(r);
  }
  return results;
}

/**
 * Return the material the Scripting Agent inlines into its system prompt
 * before calling Claude. Mirrors the validator's rules so the generator
 * and validator never drift.
 */
async function buildGenerationConstraints(student, opts = {}) {
  const format = opts.format || student?.content_format_preference || 'script';
  const platformHint = opts.platformHint || null;
  const campusId = opts.campusId || student?.campus_id;

  const ctx = opts.sharedContext || (await loadSharedContext(student, campusId));

  let lengthBounds;
  if (format === 'caption_only') {
    const max = CAPTION_LENGTH_BOUNDS.max[platformHint] || CAPTION_LENGTH_BOUNDS.max.default;
    lengthBounds = { min: CAPTION_LENGTH_BOUNDS.min, max, unit: 'words' };
  } else if (format === 'on_screen_text') {
    lengthBounds = {
      minSegments: OST_SEGMENT_BOUNDS.minSegments,
      maxSegments: OST_SEGMENT_BOUNDS.maxSegments,
      maxWordsPerSegment: OST_SEGMENT_BOUNDS.maxWordsPerSegment,
      unit: 'segments',
    };
  } else {
    lengthBounds = { min: SCRIPT_LENGTH_BOUNDS.min, max: SCRIPT_LENGTH_BOUNDS.max, unit: 'words' };
  }

  const hookShape = {
    script: 'first sentence must contain at least one of: a question mark, a digit, a contradiction keyword (but/however/actually/surprisingly/except), or a concrete noun from the student context',
    caption_only: 'first line must pass the same hook test as the script format',
    on_screen_text: 'first segment must pass the same hook test as the script format',
    mixed: 'run script hook shape; manual review advised',
  }[format];

  return {
    hardConstraints: {
      ai_tell_blocklist: AI_TELL_PHRASES.slice(),
      length_bounds: lengthBounds,
      brand_dictionary: ctx.brandTerms.map((t) => ({ term: t, exact_casing: true })),
      forbidden_generic_openers: FORBIDDEN_GENERIC_OPENERS.slice(),
      allowed_proper_nouns: ctx.allowedProperNouns.slice(),
    },
    softGuidelines: {
      tone_dimensions: ctx.toneDimensions.slice(),
      voice_excerpts: ctx.excerpts.slice(),
      format_hook_shape: hookShape,
      format,
    },
  };
}

module.exports = {
  // Public API
  validateConcept,
  validateConcepts,
  buildGenerationConstraints,
  loadSharedContext,

  // Exposed for tests / tuning
  VALIDATOR_VERSION,
  AI_TELL_PHRASES,
  FORBIDDEN_GENERIC_OPENERS,
  SCRIPT_LENGTH_BOUNDS,
  CAPTION_LENGTH_BOUNDS,
  OST_SEGMENT_BOUNDS,
  TONE_TAGS,
  STANDARD_THRESHOLDS,
  LOOSE_THRESHOLDS,

  // Internal helpers — exposed for unit testing
  _internal: {
    checkAiTellPhrases,
    checkBrandDictionary,
    checkLengthBounds,
    checkHookPresence,
    checkGenericOpener,
    checkEndingIsPayoff,
    checkProperNouns,
    extractToneDimensions,
    selectVoiceExcerpts,
    extractContextKeywords,
    validateLayer2Response,
    seededShuffle,
    hashStringToInt,
  },
};
