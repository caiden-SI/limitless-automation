# Frame.io Share Link (done handler)

SOP for building the `done` status handler in the Pipeline Agent. Source of truth for any build or refactor of this trigger. Do not deviate from this spec without updating it first.

## Objective

Create a client-facing Frame.io share link when a ClickUp task moves to `done`. Persist the link to the `videos` table and write it to the ClickUp "E - Frame Link" custom field so Scott can forward it to the student without leaving ClickUp. This replaces the manual "create share link + paste into ClickUp + send to client" step at the end of the current production process.

Contractually required per SOW Section 2 (Pipeline Agent → final delivery trigger).

## Trigger

ClickUp webhook `taskStatusUpdated` event where the new status is `done`. Routed through `handlers/clickup.js` → `pipeline.handleStatusChange(taskId, 'done', null)` → the `case 'done'` branch in `agents/pipeline.js`.

Currently that branch is a noop that logs `done_received_noop`. Flipping from noop to active is the entire scope of this workflow.

## Inputs

From Supabase `videos` row (resolved via `resolveTask`):
- `id`, `campus_id`, `clickup_task_id`, `title`
- `frameio_asset_id`: the Frame.io asset UUID uploaded during the `edited → done` flow

From ClickUp task (via `clickup.getTask`):
- List ID → already used to resolve campus

Environment:
- `FRAMEIO_API_TOKEN`: v2 developer token, already in `.env`
- `CLICKUP_FRAMEIO_FIELD_ID`: custom field UUID `53590f25-d850-4c19-8c7a-7b005904e04a` (discovered via API in Session 3, documented in `.env.example`)

## Tools used

Existing:
- `lib/supabase.js`: service role client for video row read/write
- `lib/clickup.js`: `setCustomField(taskId, fieldId, value)` for writing the link back to ClickUp
- `lib/logger.js`: writes to `agent_logs` with `agent_name = "pipeline"`
- `agents/pipeline.js` → `resolveTask()`: resolves taskId to `{ video, campus }`, `dbStatus()` helper

New:
- `lib/frameio.js`: Frame.io v2 REST client. Methods needed for this workflow: `createShareLink(assetId, options)`. Other v2 methods (upload, getComments) are out of scope here and belong to separate workflows.

## Data model additions

Two columns added to `videos`:

```sql
ALTER TABLE videos ADD COLUMN frameio_asset_id text;
ALTER TABLE videos ADD COLUMN frameio_share_link text;
```

`frameio_asset_id` is written by the upload step (separate workflow, not built yet). This handler reads it and fails cleanly if it is null. `frameio_share_link` is written by this handler.

Migration SQL staged in `scripts/migrations/`. Caiden runs it in Supabase SQL Editor. Do not run automatically.

## Process flow

1. `handleStatusChange(taskId, 'done', null)` is called from the webhook.
2. The `case 'done'` branch calls `createShareLink(taskId, null)`.
3. `createShareLink` calls `resolveTask` to load `{ video, campus }`.
4. If `video.frameio_asset_id` is null, log a warning with action `create_share_link_skipped` and return without error. The task is done but no asset has been uploaded yet, so there is nothing to share. Scott sees the log in the dashboard.
5. Call `frameio.createShareLink(video.frameio_asset_id, { name: video.title, password_protected: false, expires_at: null })`. TODO: verify with Caiden before build: v2 exposes share link creation under both `/assets/{asset_id}/review_links` and `/assets/{asset_id}/share_links` depending on the account; the progress log and `docs/integrations.md` reference the latter. Confirm the exact endpoint against the live developer token before shipping.
6. Update `videos.frameio_share_link` with the returned URL. Update `updated_at`.
7. Call `clickup.setCustomField(taskId, process.env.CLICKUP_FRAMEIO_FIELD_ID, shareLinkUrl)` to populate the "E - Frame Link" field.
8. Log success with action `share_link_created` and payload `{ taskId, videoId, shareLinkUrl }`.

## Outputs

- 1 updated `videos` row: `frameio_share_link` populated
- 1 updated ClickUp custom field: "E - Frame Link" on the task
- `agent_logs` entries at every step: start, asset loaded, share link created, supabase updated, clickup updated

## Validation

- Frame.io response must include a URL field. Fail fast if the response body does not contain a parseable URL string.
- The URL must start with `https://` and contain `frame.io`. Reject anything else with a logged error.
- ClickUp `setCustomField` response must be 2xx. On 4xx, log the response body and throw.

## Edge cases

- **`frameio_asset_id` is null on the video row.** The upload workflow has not populated it yet. Log a warning and return. Do not throw. The next run of `done` on the same task (if Scott re-triggers after upload) will succeed.
- **Share link already exists on the video row.** If `video.frameio_share_link` is already populated, skip the Frame.io API call and just re-push the existing link to ClickUp. Idempotent by design so Scott can retrigger `done` safely.
- **Frame.io API 401.** Token expired or revoked. Log error with status `error`, do not attempt repair in this agent. The global self-healing handler diagnoses. The developer token is long-lived per `docs/decisions.md` 2026-04-02, so a 401 is a meaningful signal.
- **ClickUp API 404 on custom field.** The field ID has changed or the task is not in a list that has that field. Log error and throw. TODO: verify with Caiden before build: confirm every campus's list has the "E - Frame Link" field or add a per-campus field ID lookup.
- **Frame.io API 5xx.** Transient. The global self-healing handler decides whether to retry. This agent does not implement its own retry.
- **Supabase update fails after Frame.io call succeeds.** The share link exists on Frame.io but is not recorded in Supabase or ClickUp. Log the error with full context including the generated URL. The next run of `done` will re-check `frameio_share_link`, find it null, and call Frame.io again: which creates a duplicate link. Mitigation: accept the rare duplicate. Scott can delete duplicates in Frame.io manually. Do not build a reconciliation layer for this.

## Error handling

Per CLAUDE.md rules: log full error to `agent_logs` with status `"error"` BEFORE any recovery attempt. Do not implement per-agent auto-fix here. The global self-healing handler (`workflows/self-healing-handler.md`) owns diagnosis and retry.

## Test requirements

New file `scripts/test-frame-share-link.js`. Must:
- Use the test video row from prior pipeline tests, or create one with a real `frameio_asset_id` obtained by uploading a small test clip to Frame.io via the v2 API. TODO: verify with Caiden before build: confirm the test account allows test uploads without polluting Scott's real project list.
- Call `pipeline.createShareLink(taskId, campusId)` directly. Bypass the webhook harness.
- Assert `videos.frameio_share_link` is populated with an `https://*.frame.io/*` URL.
- Assert the ClickUp task's "E - Frame Link" custom field shows the same URL (fetch via `clickup.getTask(taskId)` and inspect `custom_fields`).
- Run a second time with the same taskId to prove idempotency. Assert no second Frame.io API call is made (mock or log inspection).
- Teardown: delete the test video row, remove the ClickUp custom field value, delete the Frame.io asset.

Test must be runnable standalone via `node scripts/test-frame-share-link.js`.

## Dependencies

Before this handler can run in production:
- `frameio_asset_id` and `frameio_share_link` columns must exist on `videos`. Migration run in Supabase SQL Editor.
- `CLICKUP_FRAMEIO_FIELD_ID` set in `.env`. Already documented in `.env.example` with the Austin campus value.
- `FRAMEIO_API_TOKEN` live and accepted by v2 API. Verified in Session 2 integration test.
- Frame.io asset upload step must be live (separate workflow) so `frameio_asset_id` gets populated before `done` fires. Until that is built, the handler will log `create_share_link_skipped` on every `done` event, which is the documented graceful-degradation behavior.
- `docs/decisions.md` 2026-04-02 Frame.io v2 entry still holds. If v4 migration is undertaken first, this workflow must be updated to use Adobe IMS token auth and the v4 endpoint shape.

## Out of scope for this workflow

- Frame.io asset upload on `edited → uploaded to dropbox` transition (separate workflow, not built)
- Frame.io comment webhook → ClickUp `waiting` status change (handler stub exists in `handlers/frameio.js`, separate workflow)
- v4 API migration (covered in `docs/decisions.md` 2026-04-02)
- Reconciliation of orphan share links created when Supabase write fails post-API-call

## Acceptance criteria

The handler is complete when:
- Integration test passes end-to-end against real Frame.io v2, real ClickUp, real Supabase.
- Idempotency test passes: calling `done` twice does not create two Frame.io share links.
- `done_received_noop` log entries stop appearing in `agent_logs` for tasks with populated `frameio_asset_id`.
- `docs/decisions.md` entry added if any behavior diverges from this spec.
- `docs/progress-log.md` entry added for the session.
- The TODO comment block in `agents/pipeline.js` case `'done'` (currently lines 46-50) is deleted and replaced with the call to `createShareLink`.
