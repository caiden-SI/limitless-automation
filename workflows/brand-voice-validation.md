# Brand Voice Validation

SOP for building and maintaining the brand voice validation layer that scores generated scripts against a universal quality floor and a per-student voice/tone signature. Source of truth for any build or refactor of this layer. Do not deviate from this spec without updating it first.

## Objective

Every concept the Scripting Agent produces must clear two gates before it can land as a `videos` row and a ClickUp task: a deterministic universal quality floor (no AI-tells, right length, hook present, no hallucinated facts) and a per-student voice/tone fit judged by Claude against the student's own onboarding context. The validator replaces the originally planned `BRAND_VOICE_EXAMPLES_PATH` file of Scott-curated scripts, which cannot work because voice is per-student and some students do not use scripts at all (captions, on-screen text only).

Contractually supports SOW Section 2 (Intelligence Agents → Scripting Agent) by providing the quality bar required for agent-generated output to be trusted into the pipeline without human pre-review.

## Trigger

Not its own trigger. The validator is a library called by `agents/scripting.js` after each Claude concept generation, before any `videos` or ClickUp writes. Also callable ad-hoc from test scripts.

Eventually callable from other agents if they produce student-voiced output (e.g., a future revision-suggestion agent). Scripting is the only consumer in Phase 1.

## Inputs

Per concept under validation:
- The generated concept (`title`, `hook_angle`, `script`, `creative_direction`, `hook_type`)
- `students` row for the author — specifically `claude_project_context`, `content_format_preference`, `name`, `handle_tiktok`, `handle_instagram`
- `onboarding_sessions.influencer_transcripts` for the student (jsonb, scraped during Section 3 of onboarding) — used as raw voice samples for the judge
- `brand_dictionary` for the campus — used by the spelling check in Layer 1 (same table the QA Agent uses)

From the caller:
- `opts.mode`: one of `log_only`, `gate`, `off` (resolved from `BRAND_VOICE_VALIDATION_MODE` env var, overrideable per call for tests)
- `opts.format`: optional override; otherwise read from `students.content_format_preference`

## Tools used

Existing:
- `lib/supabase.js` — service role client; reads `students`, `onboarding_sessions`, `brand_dictionary`
- `lib/claude.js` → `askJson()` for the Layer 2 judge call, model `claude-sonnet-4-20250514`
- `lib/logger.js` — writes to `agent_logs` with `agent_name = "brand_voice_validator"`
- `tools/srt-parser.js` — not used directly, but the pattern (pure helper consumed by agents) is the reference shape

New:
- `lib/brand-voice-validator.js` — exports `validateConcept(concept, student, opts)`, `validateConcepts(concepts, student, opts)`, and `buildGenerationConstraints(student, opts)`. Returns a structured result object for the validators (see Outputs); `buildGenerationConstraints` returns `{ hardConstraints, softGuidelines }` for inlining into the Scripting Agent's generation prompt. Owns both Layer 1 (sync, no external calls) and Layer 2 (async, one Claude call per concept), plus the shared rule constants both the validator and the generator consume.

## Data model additions

New column on `students`:

```sql
ALTER TABLE students
  ADD COLUMN content_format_preference text
    CHECK (content_format_preference IN ('script', 'on_screen_text', 'caption_only', 'mixed'))
    DEFAULT 'script';
```

Populated going forward by the Onboarding Agent from Section 5 (Content Creation) answers. For existing students, default `script` is safe until Scott or Caiden corrects.

New table `video_quality_scores`:

```sql
CREATE TABLE video_quality_scores (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  campus_id uuid not null references campuses(id),
  validator_version text not null,
  layer1_passed boolean not null,
  layer1_issues jsonb not null default '[]'::jsonb,
  layer2_passed boolean,
  layer2_scores jsonb,
  layer2_notes jsonb,
  overall_passed boolean not null,
  mode text not null,
  created_at timestamptz not null default now()
);

CREATE INDEX idx_vqs_video_id ON video_quality_scores(video_id);
CREATE INDEX idx_vqs_campus_overall ON video_quality_scores(campus_id, overall_passed);
```

Follows the `performance_signals` shape (per-row jsonb for flexibility, campus-scoped indexes). Does not replace `videos.qa_passed` — that is separate and covers editing quality, not brand voice.

Migration SQL staged in `scripts/migrations/` as a new dated file. Do not run automatically. Caiden runs it in Supabase SQL Editor.

## Process flow

For each concept passed in:

1. If `opts.mode === 'off'`, return a result marked `overall_passed: true, mode: 'off'` without running any checks. Used during emergencies or when the validator itself is suspected faulty.
2. Resolve format: `opts.format || student.content_format_preference || 'script'`.
3. **Layer 1 — deterministic quality floor.** Run the rule set for the resolved format (see Layer 1 rules). Collect all failures into `layer1_issues`. Layer 1 does not short-circuit; every rule runs so the caller sees the full list.
4. **Layer 2 — Claude-as-judge voice/tone fit.** Even if Layer 1 failed, run Layer 2 whenever `mode !== 'off'` so we capture scores for calibration data. See Layer 2 below.
5. Compute `overall_passed`:
   - If `mode === 'log_only'`: always `true`. The scores are recorded but do not gate.
   - If `mode === 'gate'`: `layer1_passed && layer2_passed`.
6. Write one `video_quality_scores` row. The `video_id` is filled in after the caller has inserted the `videos` row — validator returns the result object and the caller is responsible for persisting it with the right foreign key. The validator itself does not write if there is no `video_id` (i.e., during a dry-run or pre-insert call); in that case it returns the result and the caller decides what to persist. See "Caller contract" below.
7. Log one `agent_logs` entry per validated concept with action `brand_voice_validate`, status `info` on pass, `warn` on Layer 1 fail, `error` only if the validator itself crashed.

## Layer 1 rules

Rules group into three buckets. The format resolved in step 2 picks the active bucket.

### Universal (apply in every format)

- **AI-tell phrase blocklist.** Case-insensitive substring match against a maintained list: `"let's dive in"`, `"in today's video"`, `"buckle up"`, `"game-changer"`, `"at the end of the day"`, `"unleash the power"`, `"revolutionize"`, `"it's important to note"`, `"in this video we'll"`, `"needle-moving"`, `"level up"`, `"take it to the next level"`. List lives in `lib/brand-voice-validator.js` as `AI_TELL_PHRASES`. Each hit is one issue.
- **Hallucinated-fact check.** Extract proper nouns from the concept. Cross-reference against the `students` row: if the concept names a person, school, project, or handle, it must match what is in `students.name`, `students.claude_project_context` (substring), `campuses.name`, or the brand dictionary. Unknown proper nouns are flagged as `possible_hallucination`. Not a hard fail in `log_only`; always an issue.
- **Brand dictionary spelling.** Pull `brand_dictionary` for the campus. Case-sensitive check: any mention of `Alpha`, `Superbuilders`, `Timeback` etc. must be spelled exactly as stored. Same table the QA Agent uses for caption checks.
- **Length bounds per format.** Script: 70–150 words. Caption set: configurable in `CAPTION_LENGTH_BOUNDS`. On-screen text: configurable in `OST_SEGMENT_BOUNDS`. Out-of-range is an issue.

### Script format (`content_format_preference = 'script'`)

- **Hook presence in first sentence.** First sentence of `script` must contain at least one of: a question mark, a digit, a contradiction keyword (`but`, `however`, `actually`, `surprisingly`, `except`), or a concrete noun tied to the student's project (matched against `claude_project_context` keywords).
- **Generic opener blocklist.** First 20 characters of `script` cannot start with `Hey guys`, `What's up`, `Hi everyone`, `Welcome back`, or `So today`.
- **Ending is a payoff, not a bare CTA.** Last sentence cannot be only a call-to-action (`Follow for more`, `Like and subscribe`). Must contain additional content.

### On-screen-text format (`content_format_preference = 'on_screen_text'`)

- **Segment count within bounds.** Number of distinct on-screen text segments ≥ 3 and ≤ 15.
- **Per-segment word cap.** Each segment ≤ 12 words so it is readable on a phone in motion.
- **First segment is hook-shaped.** First segment passes the same hook test as the script format.

### Caption-only format (`content_format_preference = 'caption_only'`)

- **Scroll-stop first line.** Same hook test as above, applied to line 1 of the caption.
- **Total caption word count within bounds** (platform-aware: TikTok ≤ 150, Instagram ≤ 125, default ≤ 150).
- **No AI-tell phrases** (covered by universal).

Mixed format (`mixed`) runs the script rule set by default and emits a warning that manual review is advised.

## Layer 2 — judge

One Claude call per concept. Prompt construction:

- Extract up to 5 tone dimensions from `claude_project_context`. Dimensions are short tags (`conversational`, `self-deprecating`, `technical-but-accessible`, `fast-paced`, `understated`). If fewer than 2 can be extracted, record a warning and mark `layer2_scores.extraction_thin = true` — the judge still runs but thresholds loosen (see Validation).
- Pull 3 short excerpts (≤ 300 chars each) from `onboarding_sessions.influencer_transcripts` for the student. These are real voice samples the student told us they want to sound like. Excerpt selection: random sample across platforms if multiple are present, deterministic seed based on `student_id` so the same student always gets the same excerpts for calibration.
- Prompt Claude: rate the concept on each tone dimension 1–5, compare against the provided excerpts, return strict JSON.

Expected response schema:

```json
{
  "scores": {
    "conversational": { "score": 4, "note": "one sentence" },
    "self_deprecating": { "score": 3, "note": "one sentence" }
  },
  "voice_match_score": 4,
  "voice_match_note": "one sentence comparing against provided excerpts",
  "overall_pass": true
}
```

The boolean `overall_pass` is a Claude judgment. The validator recomputes `layer2_passed` from the numeric scores using the thresholds below — Claude's boolean is advisory.

## Outputs

Returned from `validateConcept`:

```json
{
  "layer1_passed": true,
  "layer1_issues": [
    { "rule": "ai_tell_phrase", "detail": "matched 'let\\'s dive in'", "severity": "error" }
  ],
  "layer2_passed": true,
  "layer2_scores": { "...": "..." },
  "layer2_notes": "raw Claude response",
  "overall_passed": true,
  "mode": "log_only",
  "format": "script",
  "validator_version": "2026-04-21"
}
```

Side effects:
- One `agent_logs` entry per validation.
- One `video_quality_scores` row per validation, inserted by the caller (scripting agent) once the `videos` row exists.

## Caller contract

`agents/scripting.js` calls `validateConcepts(concepts, student, opts)` after its Claude generation step, before the `videos` insert loop. Behavior:

- If all concepts pass and `mode !== 'off'`: proceed with the normal insert loop. After each `videos` insert, write the matching `video_quality_scores` row.
- If any concept fails in `mode === 'gate'`: retry the whole batch once, passing the concatenated structural validation errors, `layer1_issues`, and `layer2_notes` back into the generation prompt. **The Scripting Agent's existing structural-validation retry in `agents/scripting.js` shares this budget** — only one regeneration per event, no matter what failed. This matches CLAUDE.md's "retry ONCE" error-handling rule. On second failure, drop the failing concepts. If fewer than 2 concepts survive, abort the cycle for that event without writing `processed_calendar_events`, so the next cron run retries.
- **Escalation to `failed_cleanup`.** Voice failures can loop invisibly if the underlying cause is systemic (bad student context, judge misconfiguration, over-strict thresholds). The Scripting Agent must count how many times the same `event_id` has aborted for voice reasons. When the count reaches `VOICE_ABORT_ESCALATION_THRESHOLD` (constant, default `3`), write a `processed_calendar_events` row with `status = 'failed_cleanup'` and an error message that aggregates the Layer 1 / Layer 2 issues across all attempts. This halts automatic retry and surfaces the event via the existing `scripts/release-failed-cleanup.js` operator tool built in Session 14. Counting mechanism is an implementation choice (query `agent_logs` for prior `brand_voice_validate_abort` entries against this event_id, or a dedicated counter column); the validator itself does not track event-level state — escalation lives in the Scripting Agent.
- If any concept fails in `mode === 'log_only'`: proceed anyway. Scores are recorded for calibration. Post a single ClickUp comment per event summarizing the failures so Scott can eyeball. Log-only mode never escalates to `failed_cleanup` — it is non-gating by design.
- If the validator itself throws: log to `agent_logs` with status `error`, treat as `mode === 'off'` for the rest of the batch, and continue. The validator must never be the reason a pipeline run halts.

## Generation-side integration

The rules enforced by the validator are also the contract the Scripting Agent's generation prompt must reflect. Having one rule set live in two places (validator + prompt) is the real source-of-truth risk; both read from the same module constants so tuning one changes both.

`buildGenerationConstraints(student, opts)` returns the material the Scripting Agent inlines into its system prompt before calling Claude. Shape:

```json
{
  "hardConstraints": {
    "ai_tell_blocklist": ["let's dive in", "..."],
    "length_bounds": { "min": 70, "max": 150, "unit": "words" },
    "brand_dictionary": [{ "term": "Alpha", "exact_casing": true }],
    "forbidden_generic_openers": ["Hey guys", "..."],
    "allowed_proper_nouns": ["Alex Mathews", "Alpha School Austin", "..."]
  },
  "softGuidelines": {
    "tone_dimensions": ["conversational", "self-deprecating", "..."],
    "voice_excerpts": [
      { "source": "tiktok/@handle", "text": "..." }
    ],
    "format_hook_shape": "script format: first sentence must set tension or specificity",
    "format": "script"
  }
}
```

The Scripting Agent must consume this in two distinct sections of its generation prompt:

**Hard constraints** — framed as imperatives. "Your output MUST NOT contain any of the following phrases: ...". "Script length MUST be between 70 and 150 words.". "Only these proper nouns are allowed: ...". "Brand names must be spelled exactly: Alpha, Superbuilders, Timeback (case-sensitive).". This is the generator's mirror of Layer 1. Deterministic, non-negotiable, listed explicitly so Claude cannot infer around them.

**Soft guidelines** — framed as context. "The student's voice tends to be [dimensions].". "Here are excerpts from creators whose voice the student has said they want to match: [excerpts].". "For [format], hooks typically [shape].". This is the generator's mirror of Layer 2. Probabilistic, example-driven, pattern-matched.

The split matters. Over-constraining Claude with rigid tone commands produces mechanical output; under-constraining with no examples produces off-voice output. Hard rules plus soft examples is the balance. The validator is the second gate, not the only gate — but by the time a concept reaches the validator, it should already be passing most checks because the generator was briefed with the same rules.

Responsibility: the Scripting Agent calls `buildGenerationConstraints(student)` before each Claude generation call and inlines both sections. The validator remains the final arbiter. If the two disagree (generator produces output that fails validation), the validator wins and the retry loop engages as specified in Caller contract.

## Validation

Of the validator's own output:

- `scores` must be an object with at least one key. Each value must have `score` (1–5 integer) and `note` (string).
- `voice_match_score` must be an integer 1–5.
- If Claude response is malformed JSON or fails schema, treat as `layer2_passed = null` (not `false`) and `overall_passed` defaults to `layer1_passed` only. Record the parse error in `layer2_notes`.
- Thresholds:
  - Standard: all tone scores ≥ 4 AND `voice_match_score` ≥ 4 → `layer2_passed = true`.
  - Loosened (`extraction_thin`): all tone scores ≥ 3 AND `voice_match_score` ≥ 3.
- Thresholds live at the top of `lib/brand-voice-validator.js` as named constants so they are easy to tune once calibration data exists.

## Edge cases

- **Student has no `claude_project_context`.** Layer 2 cannot extract dimensions. Log a warning, set `layer2_passed = null`, and effectively run Layer 1 only. Record in `agent_logs` so Caiden sees which students are missing context.
- **Student has no `onboarding_sessions` row or empty `influencer_transcripts`.** Layer 2 still runs but without excerpt comparison; the `voice_match_score` is excluded from threshold calculation. Record in `agent_logs`.
- **`content_format_preference` is null.** Treat as `script`. Do not hard-fail on missing metadata.
- **Brand dictionary is empty for the campus.** Skip the spelling rule (no false positives from an empty dict). Log one warning.
- **Claude judge returns scores that conflict with its own `overall_pass` boolean.** Validator recomputes from numeric scores and ignores the boolean. No retry.
- **All 3 generated concepts fail in `gate` mode.** Abort the scripting cycle for that event. Do not insert `processed_calendar_events` with `status = 'processed'` — next cron pass retries. Log one `agent_logs` entry at `error` (action `brand_voice_validate_abort`) with the full issue list for diagnosis. If this is the `VOICE_ABORT_ESCALATION_THRESHOLD`-th consecutive abort for this `event_id` (default 3), escalate per the Caller contract by writing a `processed_calendar_events` row with `status = 'failed_cleanup'`. The event is then frozen until an operator runs `scripts/release-failed-cleanup.js`.
- **Mode is `gate` but `BRAND_VOICE_VALIDATION_MODE` is unset in env.** Default to `log_only`. Never default to `gate` implicitly — gating must be a deliberate operator decision.
- **Validator called concurrently for the same video** (e.g., accidental double-insert path). The `video_quality_scores` table has no uniqueness constraint; duplicates are acceptable for now, indexed by `video_id`. Dedup is a future optimization if it becomes noisy.

## Error handling

Per CLAUDE.md rules: log full error to `agent_logs` with status `"error"` BEFORE any recovery attempt. The validator does not attempt its own self-repair — a validator crash falls back to `mode === 'off'` for the current batch, which is documented behavior (not a silent failure). The global self-healing handler is not invoked from inside the validator to avoid recursive diagnosis of a diagnosis tool.

## Test requirements

New file `scripts/test-brand-voice-validation.js`. Must:

- Run against the seeded Alex Mathews student (same test subject the scripting agent uses). Caiden confirms this student has `claude_project_context` and at least one influencer transcript persisted.
- Case 1: Feed a clean, well-written concept in script format. Assert `layer1_passed === true`, `layer2_passed === true`, `overall_passed === true` under `mode = 'gate'`.
- Case 2: Feed a concept containing `"let's dive in"`. Assert `layer1_issues` includes `ai_tell_phrase`, `layer1_passed === false`, and under `mode = 'log_only'` the overall still passes (log-only does not gate).
- Case 3: Feed a 200-word script. Assert `length_out_of_bounds` issue fires.
- Case 4: Feed a stiff, corporate-voiced concept that contradicts the student's conversational tone. Assert `layer2_scores` are low (≤ 3 on at least one dimension) and `layer2_passed === false` under `mode = 'gate'`.
- Case 5: Force the Claude judge call to return malformed JSON (inject via a client stub). Assert `layer2_passed === null`, `layer2_notes` records the parse error, and the validator does not crash.
- Case 6: Run with `mode = 'off'`. Assert no Claude call is made and `overall_passed === true` regardless of input quality.
- Case 7: Format branching. Set the student's `content_format_preference = 'caption_only'` in a transactional test fixture, feed a caption-shaped input, and assert the caption-only rule set ran (not the script rule set).
- Case 8: Student with null `claude_project_context`. Assert `layer2_passed === null` and Layer 1 still runs.
- Case 9: `buildGenerationConstraints(student)` for the Alex Mathews student returns a populated `hardConstraints` object (non-empty blocklist, length bounds, at least one brand-dictionary term if any are seeded for the campus) and a `softGuidelines` object with ≥ 2 tone dimensions and ≥ 1 voice excerpt. Assert the same `student_id` produces the same 3 voice excerpts across two successive calls (deterministic seeding).
- Case 10: End-to-end round trip. Call `buildGenerationConstraints`, feed both sections into a real Claude generation call as the system prompt, then pipe the output through `validateConcept`. Assert the generated output passes Layer 1 (the generator respected the hard constraints). Runs against real Claude, so gate on a feature flag if Claude budget is a concern during CI.
- Case 11: Escalation to `failed_cleanup`. Simulate three consecutive voice-validation aborts for the same `event_id` (stub the Claude generation call to return content that always fails Layer 1, or force `validateConcepts` to return `overall_passed: false` for every concept, running `mode = 'gate'`). Between each run, assert that attempts 1 and 2 leave no `processed_calendar_events` row (so the event remains retryable). Assert that the third consecutive abort writes a `processed_calendar_events` row with `status = 'failed_cleanup'`, an `error_message` containing the aggregated Layer 1 / Layer 2 issues, and that a subsequent cron invocation for the same event skips without invoking Claude. Teardown must delete the `failed_cleanup` row so the test is idempotent.
- Teardown: delete any test `video_quality_scores` rows, any test `processed_calendar_events` rows (including `failed_cleanup` entries from Case 11), and restore `content_format_preference` on the test student.

Test must be runnable standalone via `node scripts/test-brand-voice-validation.js`.

## Dependencies

Before the validator can ship:

- `students.content_format_preference` column migration run in Supabase SQL Editor.
- `video_quality_scores` table migration run in Supabase SQL Editor.
- `BRAND_VOICE_VALIDATION_MODE` added to `.env` (default `log_only`). Document in `.env.example`.
- At least one student with populated `claude_project_context` and influencer transcripts. Alex Mathews already satisfies this from Session 5 seeding.
- `brand_dictionary` populated for Austin campus. If empty, the spelling rule no-ops gracefully but the validator is weaker.
- Onboarding Agent updated (follow-up workflow) to set `content_format_preference` during Section 5. Not required for Phase 1 ship; defaults are safe.
- `agents/scripting.js` generation prompt updated to consume `buildGenerationConstraints` output, with the hard constraints and soft guidelines placed in distinct sections of the system prompt. This is part of the same ship, not a follow-up.

## Out of scope for this workflow

- Editing-quality validation (audio levels, caption spelling in exported SRTs). That is the QA Agent's job and stays there.
- Calibration of thresholds against real data. Ship with the defaults above; retune after ≥ 20 validations are in `video_quality_scores`.
- A dashboard component showing voice scores. Use Supabase direct queries until demand justifies UI.
- Per-platform caption variation (TikTok vs Instagram specific rules beyond length). Phase 2 if data suggests it matters.
- Automatic extraction of tone dimensions from influencer transcripts via their own Claude pass. Dimensions come from `claude_project_context` only in Phase 1.

## Acceptance criteria

The validator is complete when:

- All 11 test cases in `scripts/test-brand-voice-validation.js` pass against real Claude, real Supabase, and (for Cases 5 and 11) the stubbed client.
- `agents/scripting.js` calls `buildGenerationConstraints(student)` before each generation call and inlines the hard constraints and soft guidelines as distinct sections in the system prompt.
- `agents/scripting.js` calls `validateConcepts` after generation and before its insert loop, and `video_quality_scores` rows appear for every concept processed (verified by running the existing scripting agent test end-to-end).
- A manual A/B eyeball: run the updated Scripting Agent on the Alex Mathews student against the existing test, compare 3 concepts generated with constraints vs. 3 from the pre-change prompt. Constraint-aware output should visibly match the student's tone more closely and should never contain any AI-tell phrase from the blocklist.
- `mode = 'log_only'` is the default in `.env.example` and in a fresh install. Flipping to `gate` is a documented operator action.
- A forced Layer 1 failure under `mode = 'gate'` aborts the scripting cycle cleanly (no partial `videos` rows, no `processed_calendar_events` row).
- Three consecutive aborts for the same `event_id` in `mode = 'gate'` escalate to `processed_calendar_events.status = 'failed_cleanup'`, the event is not retried on subsequent cron runs, and it is recoverable via `scripts/release-failed-cleanup.js` (verified manually on one test event).
- `docs/decisions.md` has a new entry dated the session date documenting the two-layer approach, the retirement of the `BRAND_VOICE_EXAMPLES_PATH` plan, and the decision to mirror rules into the generation prompt (not defer to a follow-up).
- `workflows/brand-voice-validation.md` matches the implementation. Update this spec if behavior intentionally diverges.
- `docs/progress-log.md` entry added for the session.
