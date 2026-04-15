# OpenClaw Integration (Master Orchestrator)

SOP for deploying the master orchestrator layer. OpenClaw (openclaw.ai) is the current target platform. The design intentionally avoids hard coupling to it so we can swap platforms without rewriting the agent layer. Do not deviate from this spec without updating it first.

## Objective

Provide a single conversational interface for Scott to query pipeline state, trigger agents on demand, and manage the production queue across campuses without clicking through ClickUp, Dropbox, Frame.io, Supabase, and the React dashboard individually. The orchestrator is the outermost layer. It reads the shared brain (Supabase) and fires into the existing webhook or agent HTTP endpoints.

Per SOW Section 2 → Deployment and Interface, the delivered product includes a conversational layer. The platform that provides it is an implementation detail. This workflow treats OpenClaw as the default and documents the alternative path if it turns out not to fit.

**Contractual note:** SOW Section 2 commits to a conversational orchestration layer, not to OpenClaw specifically. Spur Intel internally selects the platform. If OpenClaw is changed for a bespoke CLI or another hosted platform during the build, the SOW obligation is still met as long as the four capabilities in the Objective section above are delivered.

## Trigger

Scott initiates every interaction. There is no cron schedule for the orchestrator. It is an on-demand surface.

The agent layer and the scheduled jobs continue to run regardless of whether the orchestrator is reachable. If OpenClaw is offline, the pipeline keeps running. This is the core of the "agents communicate through Supabase only" rule in CLAUDE.md.

## Inputs

From Supabase (read-only for most queries):
- `videos`: all pipeline state, filtered by `campus_id`
- `agent_logs`: last N entries for a "show me recent activity" query
- `performance_signals`: for "what's working this week" queries
- `editors`, `campuses`, `students`, `research_library`, `brand_dictionary`: for roster, config, and reference lookups

From Scott (typed into the chat):
- Natural language queries and commands

From the webhook server (as HTTP targets OpenClaw can call):
- `/webhooks/clickup`, `/webhooks/dropbox`, `/webhooks/frameio`: existing routes for simulated events
- A new `/orchestrator/trigger` route (see New endpoints below) for OpenClaw to invoke agents directly without forging a webhook

## Tools used

Existing:
- `lib/supabase.js`: OpenClaw reads with anon key if per-campus RLS is sufficient, otherwise with service role key stored in OpenClaw's vault. TODO: verify with Caiden before build. Decide whether OpenClaw runs server-side (service role OK) or is user-facing (anon key with per-user auth).
- `lib/clickup.js`, `lib/dropbox.js`, `lib/frameio.js`: OpenClaw does not call these directly. It calls agent functions via the new trigger endpoint, which internally use these libraries.

New:
- `routes/orchestrator.js`: Express route that exposes `POST /orchestrator/trigger` with a signed token. Payload: `{ agent, action, params }`. Runs the requested function from the corresponding agent module. Returns structured JSON.
- `lib/orchestrator-auth.js`: HMAC-SHA256 signature verification for the orchestrator endpoint. Reuses the pattern from `handlers/clickup.js`.
- OpenClaw-side configuration: agent definition YAML (or platform-specific equivalent), Supabase connection, `/orchestrator/trigger` URL, signing secret.

## Data model additions

No new tables in Supabase. The orchestrator reads existing tables.

One convention: a new action prefix in `agent_logs`. `orchestrator_*`. Every trigger invocation logs `orchestrator_trigger_received`, `orchestrator_trigger_completed`, or `orchestrator_trigger_failed` for auditability. Scott can see "what did OpenClaw do" by filtering `agent_name = 'orchestrator'` in the dashboard.

## Process flow

**Query flow** (read-only, e.g., "what's in the QA queue for Austin?"):

1. Scott types the query in OpenClaw.
2. OpenClaw converts the query into a Supabase query (OpenClaw handles this internally: either via its own Claude tool use or a configured "query recipe").
3. OpenClaw reads Supabase directly. No call to this repo's webhook server.
4. OpenClaw formats the result back into conversational text for Scott.

**Action flow** (write, e.g., "run the research agent for Austin now"):

1. Scott types the command.
2. OpenClaw resolves it to `{ agent: "research", action: "runForCampus", params: { campusId: "..." } }`.
3. OpenClaw signs the payload with the shared secret and POSTs to `https://{mac-mini-host}/orchestrator/trigger`.
4. `routes/orchestrator.js` verifies the signature, looks up the agent module, calls the named function, and returns the result.
5. The agent code executes normally: writes to Supabase, calls external APIs, logs to `agent_logs`. The orchestrator endpoint is a thin dispatch layer.
6. Response returned to OpenClaw. OpenClaw summarizes for Scott.

## Conversational interface requirements

The four capability classes Scott must be able to exercise, per the SOW interface commitment:

1. **Query status**: "How many videos are in each pipeline status?", "What's blocking task X?", "Show me videos waiting QA for more than 3 days"
2. **Query performance**: "Which hook types performed best last week?", "Show me the latest performance signals summary"
3. **Trigger agents**: "Run research now for Austin", "Re-run QA on task 86e0qcwt7", "Create Frame.io share link for this done task"
4. **Manage pipeline**: "Mark this task as waiting", "Reassign editor for task X to Tipra". These write back to ClickUp via the agent trigger endpoint, not directly

The orchestrator must not expose arbitrary SQL or arbitrary ClickUp writes. Every action goes through a named agent function that the Mac Mini server validates.

## New endpoints

`POST /orchestrator/trigger`

Request body:
```json
{
  "agent": "pipeline | qa | research | performance | scripting",
  "action": "string matching an exported function name",
  "params": { "arbitrary": "per-action" }
}
```

Response:
```json
{
  "status": "success | error",
  "result": "any JSON-serializable value",
  "log_ids": ["agent_logs row ids written during this invocation"]
}
```

Signature header: `X-Orchestrator-Signature`. HMAC-SHA256 of raw body using `ORCHESTRATOR_SECRET` from `.env`.

Allowlist: only functions explicitly registered in `routes/orchestrator.js` can be triggered. This prevents OpenClaw (or anyone with the secret) from invoking internal helpers. Initial allowlist: `pipeline.createDropboxFolders`, `pipeline.createShareLink`, `pipeline.triggerQA`, `research.runForCampus`, `performance.runForCampus`, `scripting.runOnce`. Add to allowlist explicitly as new trigger needs surface.

## Outputs

- Responses to Scott in OpenClaw's chat surface
- `agent_logs` entries for every trigger invocation
- Whatever side effects the underlying agent function produces (folder creation, status updates, etc.)

## Validation

- `/orchestrator/trigger` request must pass signature verification. Reject with 401 otherwise.
- `agent` and `action` must match the allowlist. Reject with 400 otherwise.
- `params` must be an object. Reject with 400 otherwise.
- Response body is always JSON. Never HTML or plain text, even on errors.
- OpenClaw's natural language parsing of user intent is its own concern, not this spec's. The contract is the JSON request shape.

## Edge cases

- **OpenClaw is offline.** The pipeline keeps running. Scott uses the React dashboard for queries and ClickUp for manual actions. No code in this repo assumes the orchestrator is reachable.
- **Orchestrator triggers an agent function that throws.** The global self-healing handler (`workflows/self-healing-handler.md`) catches it. The response to OpenClaw includes the error message and a pointer to `agent_logs`. OpenClaw surfaces this to Scott.
- **Scott issues an ambiguous query.** OpenClaw asks a clarifying question. The Mac Mini server sees no traffic for ambiguous queries.
- **OpenClaw runs the same action twice (network retry, user double-tap).** Agent functions are expected to be idempotent where practical (folder creation, share link creation). Non-idempotent actions (`createTask`) should accept an optional `idempotency_key` param so retried invocations do not duplicate work.
- **OpenClaw makes a read that returns stale data because Supabase write just happened.** Acceptable. This is an eventual consistency system. If Scott issues a trigger and queries status one second later, he may see pre-trigger state. Retry and the new state appears.
- **OpenClaw's own cost overrun.** OpenClaw's LLM usage is separate from the Anthropic account tracked in `docs/integrations.md`. Monitor OpenClaw billing separately. TODO: verify with Caiden before build: confirm whether OpenClaw uses Scott's Anthropic key or its own.

## Error handling

Trigger endpoint errors propagate back to OpenClaw as JSON. The Mac Mini server does not attempt UI-level recovery. OpenClaw decides whether to re-prompt Scott or show the error.

Per CLAUDE.md rules: all errors logged to `agent_logs` with status `error` BEFORE recovery. The self-healing handler covers in-agent failures. Orchestrator-level failures (bad payload, bad signature) are logged directly and returned.

## Test requirements

New file `scripts/test-orchestrator.js`. Must:
- Start the webhook server, register `/orchestrator/trigger`.
- POST a valid signed request for `pipeline.createDropboxFolders` against a test task ID. Assert folders are created and the response is 200 with expected shape.
- POST an unsigned request. Assert 401.
- POST a request with an unallowed agent/action pair. Assert 400.
- POST a request that triggers an agent error. Assert the error is logged and the response body carries the diagnostic pointer.
- Teardown: delete test folders and test rows.

Test must be runnable standalone via `node scripts/test-orchestrator.js`.

A parallel OpenClaw-side test: manually execute each of the four conversational capability classes with Scott watching. Record outputs. Attach to `docs/progress-log.md` at integration time.

## Dependencies

Before the orchestrator can be used in production:
- OpenClaw tenant provisioned, Scott has login. TODO: verify with Caiden before build: confirm Scott has an OpenClaw seat and that the platform supports the three primitives we need (Supabase read, webhook write with HMAC, Claude-powered intent parsing).
- `ORCHESTRATOR_SECRET` generated and stored in both `.env` and OpenClaw's vault.
- `routes/orchestrator.js` wired into `server.js`.
- Allowlist populated with at least the six initial agent functions.
- Mac Mini host reachable from OpenClaw (see `workflows/mac-mini-deployment.md` for ngrok/Tailscale setup).
- RLS policies on Supabase verified for whichever key OpenClaw uses.

## Fallback: minimal custom alternative

If OpenClaw does not fit (missing primitive, pricing, Scott finds the UX poor, platform instability), the alternative is a small Claude-powered CLI:

- **What:** `scripts/chat.js`: a Node.js REPL using `lib/claude.js` with tool use enabled. Tools are wrappers around the same `/orchestrator/trigger` endpoint and Supabase reads.
- **Where:** Runs on Scott's machine or the Mac Mini, accessible via SSH or a simple web terminal.
- **Cost:** A few days of work. Reuses every existing library.
- **Tradeoff:** Scott loses the polished chat UI but gains full control and zero vendor dependency.

The agent layer does not change. The switch is entirely at the conversational surface. This is why the `/orchestrator/trigger` endpoint and the allowlist pattern are defined here independent of OpenClaw. Both the hosted platform and the fallback CLI hit the same endpoint.

## Out of scope for this workflow

- OpenClaw's internal agent prompt engineering (their platform, their concern)
- Natural language understanding accuracy benchmarks (evaluated against Scott's actual usage, not scripted tests)
- Slack, Discord, or email interfaces: not in the SOW
- Multi-user conversation surfaces: Scott is the sole user in Phase 1

## Acceptance criteria

The orchestrator is complete when:
- `/orchestrator/trigger` endpoint is live, signature-verified, and covered by `scripts/test-orchestrator.js`.
- OpenClaw can execute all four conversational capability classes against the real Austin campus data without custom glue code on the Mac Mini side.
- A dry-run conversation transcript is recorded with Scott and attached to `docs/progress-log.md`.
- Fallback CLI path is documented (this spec) and can be stood up within a few days if needed. No actual CLI required at acceptance time unless OpenClaw has already been rejected.
- `docs/decisions.md` entry added documenting the final platform choice and the rationale.
