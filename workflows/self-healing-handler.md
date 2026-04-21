# Self-Healing Error Handler

SOP for building the global error handling layer described in CLAUDE.md. Source of truth for any build or refactor of this handler. Do not deviate from this spec without updating it first.

## Objective

Catch unhandled errors across the webhook server and all agents, run Claude-powered diagnosis against a bounded set of known-recoverable failure modes, attempt an auto-fix retry once, and fall back to a human-visible ClickUp comment when recovery fails. This is the CLAUDE.md error handling contract (`Error Handling` section) in code form.

The goal is not arbitrary self-repair. The goal is to handle the narrow set of failures we already know happen in this system (expired tokens, transient 5xx, rate limits, missing rows) without paging Caiden, and to make the rest loud and legible so a human can intervene quickly.

Not explicitly called out in the SOW, but required by CLAUDE.md rules and referenced by every other agent spec that says "let the global self-healing handler diagnose."

## Trigger

Three entry points:

1. **Express route error middleware** in `server.js`: catches synchronous throws from webhook handlers. Already exists as `app.use((err, _req, res, _next) => {...})`. Currently only logs. This workflow extends it to invoke the recovery flow.
2. **`process.on('unhandledRejection')`** in `server.js`: catches unhandled promise rejections from any async code. Already exists. Currently only logs.
3. **Per-agent try/catch at function boundaries**: every top-level agent function (`handleStatusChange`, `runQA`, `runAll`, etc.) wraps its body in a try/catch that logs with status `error` BEFORE rethrowing. Pattern already present in `agents/pipeline.js` and `agents/qa.js`. This workflow standardizes it across all agents and hands the thrown error to the global handler.

The global handler is not itself a webhook or cron job. It is a library that the three entry points above call into.

## Inputs

From the throwing agent or handler:
- `error`: the Error object (message, stack)
- `context`: `{ agent, action, taskId, videoId, campusId, payload }`

From Claude:
- Diagnosis classification (see Diagnosis schema below)
- Suggested recovery action from the bounded set (see Recovery actions)

From Supabase:
- Recent `agent_logs` for the same `(agent, action)` pair in the last 5 minutes: used to avoid infinite retry loops across separate invocations

## Tools used

Existing:
- `lib/logger.js` → `log({ campusId, agent, action, status, payload, errorMessage })`: the current logger is sufficient, no changes needed
- `lib/claude.js` → `askJson({ system, prompt })`: already returns parsed JSON
- `lib/clickup.js` → `addComment(taskId, text)`: used for the human alert on second failure
- `lib/supabase.js`: for reading recent `agent_logs` to detect retry storms

New:
- `lib/self-heal.js`: exports `handle(error, context)` and `wrap(agent, action, fn)`. `wrap` is a higher-order function agents use to opt into self-healing without repeating try/catch boilerplate.

## Data model additions

No new tables. The existing `agent_logs` table already carries enough structure: `agent_name`, `action`, `status`, `error_message`, `payload`, `created_at`. Self-healing reads these fields to detect repeat failures.

One new convention: when the handler completes a recovery attempt, it writes a log entry with action `self_heal_attempted` and payload `{ originalAction, diagnosis, recoveryAction, succeeded }`. This makes the full recovery trail queryable.

## Process flow

1. Entry point catches error. Calls `selfHeal.handle(error, context)`.
2. Handler logs the original error to `agent_logs` with status `error`, action matching the agent's own naming, full stack in payload. This log happens BEFORE any Claude call. Per CLAUDE.md rule 1.
3. Handler checks `agent_logs` for `self_heal_attempted` entries matching `(agent, action)` in the last 5 minutes. If one exists, skip recovery and go straight to step 8 (ClickUp alert). This is the "retry ONCE" guardrail from CLAUDE.md. The window is 5 minutes because webhook retries and cron overlaps can reinvoke the same code path quickly.
4. Handler builds a Claude prompt containing: the error message, the stack trace head, the context fields, and a list of known recovery actions (see Recovery actions section). Instructs Claude to return strict JSON matching the Diagnosis schema.
5. Handler calls `claude.askJson` with the prompt. Validates the response against the Diagnosis schema. If Claude returns an unrecognized recovery action or the JSON is malformed, treat it as "no recovery available" and go to step 8.
6. Handler executes the recovery action. Each action has a small deterministic implementation (see Recovery actions). If the action succeeds, log `self_heal_attempted` with `succeeded: true` and return. The caller treats the original error as resolved.
7. If the recovery action throws, log `self_heal_attempted` with `succeeded: false` and continue to step 8.
8. Handler posts a ClickUp comment to the associated task (`context.taskId`, looked up via `videos.clickup_task_id` if only `videoId` is known) with a formatted summary: the agent, the action, the error message, the diagnosis, and what was attempted. Includes a pointer to `agent_logs` for full context. If no `taskId` is available (cron jobs, campus-level errors), skip the comment and log a separate `self_heal_alert_skipped` entry.
9. Handler does not re-throw. The original error is considered handled. PM2 remains the last line of defense for process crashes that escape all three entry points.

## Diagnosis schema

Claude must return:

```json
{
  "classification": "transient | auth | data | bug | unknown",
  "confidence": "high | medium | low",
  "recovery_action": "one of the allowed recovery actions or 'none'",
  "recovery_params": { "arbitrary": "per-action" },
  "human_summary": "one sentence for the ClickUp comment"
}
```

## Recovery actions

The full allowed set. Claude may only pick from this list. Anything else is treated as `none`.

- **`retry`**: Re-invoke the original function with the same arguments once. Used for transient 5xx and rate limit responses. Implementation: after a 2-second delay, call the wrapped function again. If the retry throws, fall through.
- **`refresh_dropbox_token`**: Call the Dropbox token refresh path (already wired in `lib/dropbox.js` on 401 automatically, so this is for the rare case a non-401 surfaces stale-token behavior). After refresh, retry once.
- **`skip_record`**: For data errors where a single record is malformed. Log the record ID and return success. Used when one Calendar event, one ClickUp task, or one research scrape is bad and blocking a whole batch.
- **`mark_waiting`**: For pipeline errors where a video cannot proceed. Set the ClickUp status to `waiting`, set Supabase `videos.status` to `WAITING`. Used when the error is a data issue that needs a human to unblock.
- **`none`**: No automatic recovery. Fall through to ClickUp alert.

## Outputs

- 2 to 4 new `agent_logs` entries per handled error: the original error log, optionally a `self_heal_attempted` log, optionally the recovery action's own logs, optionally a `self_heal_alert_sent` log.
- At most 1 ClickUp comment per error per 5-minute window.
- Zero new rows in `videos` or other business tables. Recovery actions that mutate state use the existing agent code paths.

## Validation

- Claude response must parse as JSON. Fail fast and go to step 8 on parse error.
- `classification` must be one of the five allowed values.
- `recovery_action` must be one of the six allowed values.
- `confidence` must be one of three allowed values. Recovery only executes if `confidence` is `high` or `medium`. `low` goes straight to ClickUp alert: this prevents Claude from guessing at unfamiliar errors.
- `recovery_params` is free-form but must be an object.

## Edge cases

- **Handler throws during its own execution.** The outer entry point (Express middleware, unhandledRejection, per-agent try/catch) catches it and logs a `self_heal_crashed` entry. No further recovery. PM2 may restart the process.
- **Claude API is itself down.** The Claude call throws. Handler catches, logs, and goes to ClickUp alert. This is the expected failure mode and must not cascade.
- **Repeat failure across separate cron invocations.** Step 3's 5-minute window handles the case where the same cron job fails three times in a row: only the first invocation attempts recovery, the next two skip to alert.
- **No `taskId` available.** Cron job errors, server startup errors, scheduler errors. Skip the ClickUp comment. The log entry is the only signal. Caiden watches `agent_logs` via the dashboard for these.
- **Recovery action succeeds but the underlying problem returns on the next invocation.** Accept this. The 5-minute window will fire the ClickUp alert on the second failure. This is the whole point of retrying only ONCE.
- **A bug in agent code produces errors on every invocation forever.** The 5-minute window resets, so each new firing triggers one recovery attempt then one ClickUp comment. Scott and Caiden see comments on every affected task. This is loud by design. Do not add a global "suppress after N alerts" throttle: the noise is the signal.
- **Recovery `mark_waiting` is invoked on a task that is already `waiting`.** Idempotent. No harm.
- **`mark_waiting` is not transactional.** The recovery writes `videos.status = 'WAITING'` in Supabase first, then calls `clickup.updateTask(..., status: 'waiting')`. If the ClickUp call throws (transient API outage, rate limit), the Supabase update is already committed and not rolled back. Reads are inconsistent across the two systems until an operator reconciles. This matches the existing `pipeline.triggerQA` behavior (same two-write pattern, same risk) and is accepted as a soft inconsistency. Self-heal runs in unusual conditions (post-error) where the ClickUp call is *more* likely to fail, so this edge case is disproportionately likely compared to the normal `triggerQA` path.

## Error handling

The handler is itself the error handling layer. It does not call itself recursively. If it fails, the outer entry point logs and the process either recovers or PM2 restarts.

## Test requirements

New file `scripts/test-self-heal.js`. Must:
- Mock a `transient` error (simulate a 503 from a fake API call) and assert the handler picks `retry`, retries, and succeeds on the second attempt.
- Mock an `auth` error (simulate Dropbox 401 outside of the built-in refresh path) and assert the handler picks `refresh_dropbox_token`.
- Mock a `data` error (insert a videos row with a null title, then invoke a function that requires title) and assert the handler picks `skip_record` or `mark_waiting`.
- Mock an `unknown` error (random thrown Error with no recognizable shape) and assert the handler goes straight to ClickUp alert without a recovery attempt. Verify `claude.askJson` was either not called or returned `none` with low confidence.
- Inject two failures within 5 minutes and assert the second skips the Claude diagnosis entirely.
- Force the Claude API to return malformed JSON and assert graceful fallback to ClickUp alert.
- Teardown: delete any test rows, delete the test ClickUp comments if the test wrote real ones (prefer a dry-run mode that captures the would-be comment text).

Test must be runnable standalone via `node scripts/test-self-heal.js`.

## Dependencies

Before this handler can go live:
- `ANTHROPIC_API_KEY` live. Already verified in Session 2.
- `CLICKUP_API_KEY` live. Already verified in Session 3.
- Per-agent try/catch blocks standardized to call `selfHeal.handle` or `selfHeal.wrap`. Requires touching `agents/pipeline.js`, `agents/qa.js`, `agents/research.js`, `agents/performance.js`, and the scripting agent when built.
- The three entry points in `server.js` (Express middleware, `process.on('unhandledRejection')`) updated to call `selfHeal.handle`.
- `lib/logger.js` unchanged. The current logger is load-bearing and already satisfies CLAUDE.md rule 1 (log before recovery).

## Out of scope for this workflow

- Modifying agent code to fix the root cause of an error (Claude diagnoses, it does not rewrite code: auto-fix means retrying or switching paths, not patching source)
- A dashboard UI for viewing self-heal history (out of scope; use `agent_logs` filtered by action prefix `self_heal_*`)
- Per-environment alerting (Slack, email, PagerDuty): the contract is ClickUp comments only
- Replacing PM2 process-level crash recovery

## Acceptance criteria

The handler is complete when:
- All 6 test cases in `scripts/test-self-heal.js` pass against real Claude, real ClickUp, real Supabase.
- A forced error in `agents/pipeline.js` produces the full trail in `agent_logs`: original error → `self_heal_attempted` → either success or `self_heal_alert_sent`.
- A ClickUp comment appears on the relevant task when recovery fails, formatted with the agent name, action, error message, diagnosis, and recovery attempt summary.
- The 5-minute retry window is enforced (proven by inducing a repeated failure).
- CLAUDE.md error handling section matches this workflow. Update CLAUDE.md if any step diverges.
- `docs/progress-log.md` entry added for the session.
