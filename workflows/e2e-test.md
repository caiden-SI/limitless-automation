# End-to-End Pipeline Test

SOP for the full-pipeline integration test that proves every agent, webhook, and external integration works together against real services. This is the gate that precedes handoff. Source of truth for the test procedure and the recorded walkthrough deliverable. Do not deviate from this spec without updating it first.

## Objective

Exercise the entire automation from a Google Calendar event through final Frame.io share link delivery, recording the run for the SOW handoff package. Every named agent, every external API, every state transition, and every column read or written during a real concept lifecycle must be covered once.

Required per SOW Section 3 (Deliverables → recorded walkthrough). The recording becomes part of the handoff package and is the reference Scott and future maintainers watch to understand the system end-to-end.

## Trigger

Manual, run by Caiden after all agents are built and the Mac Mini is live. Not automated. The test is destructive to the test campus (creates real ClickUp tasks, real Dropbox folders, real Frame.io assets), so it runs deliberately in a controlled window.

Target: run twice. Once as a dress rehearsal to catch issues. Once as the recorded walkthrough submitted with handoff.

## Inputs

From the test harness:
- One test student record in Supabase with a populated `claude_project_context` (reuse the existing real student Caiden already populated per `workflows/scripting-agent.md` Dependencies)
- One synthetic Google Calendar event titled with that student's name, dated within the next 48-hour window the Scripting Agent polls
- A short test video file (~30 seconds, real audio) to upload as footage
- A ClickUp "idea" → "ready for shooting" → "ready for editing" → "edited" → "done" sequence driven by Caiden from the ClickUp UI, matching Scott's real usage

From Supabase:
- All production tables. The test writes real rows.

From external systems:
- Live Google Calendar (test calendar under the service account)
- Live Dropbox (test campus root, e.g., `/austin-test/` if a separate test root exists, otherwise the live `/austin/` root with explicit cleanup)
- Live ClickUp (Austin campus list, test tasks clearly prefixed for cleanup)
- Live Frame.io (test asset uploaded to Scott's Account team)
- Live Anthropic API

## Tools used

Existing:
- All agents (`pipeline`, `qa`, `research`, `performance`, `scripting`)
- All webhook handlers
- The React dashboard on localhost (viewed during the walkthrough)
- PM2 logs

New:
- `scripts/e2e-test.js`: orchestrates the programmatic portions (calendar event seeding, cleanup) and prompts Caiden for the manual steps
- Screen recording software: QuickTime on the Mac Mini or OBS. Output: 1080p, 30fps, screen + microphone audio.

## Data model additions

None. The test uses existing tables. Test data is tagged with an easily-searched title prefix (`__e2e_test_`) for cleanup.

## Process flow

The test has 7 stages. Each stage has explicit pass and fail criteria. Failure at any stage aborts the test and triggers debugging before a re-run.

**Stage 1. Scripting Agent fires from Google Calendar**

1. Caiden creates a test event on the service-account-shared calendar: title contains the test student's name, start time 2 hours from now.
2. Wait up to 15 minutes for the Scripting Agent cron to fire, or invoke `scripting.runOnce()` via the orchestrator or directly.
3. **Pass:** 3 new ClickUp tasks appear in the Austin list in `idea` status. 3 new `videos` rows exist with status `IDEA` and `student_id` matching the test student. 1 new `processed_calendar_events` row references the calendar event ID. `agent_logs` shows `scripting` entries from start to finish.
4. **Fail:** Fewer than 3 tasks or rows, missing `processed_calendar_events` entry, or error logs. Abort and debug.

**Stage 2. Manual review and promotion to ready for shooting**

5. Caiden reviews the 3 generated concepts in ClickUp. Picks one. Moves it to `ready for shooting` in ClickUp.
6. ClickUp fires `taskStatusUpdated` webhook to `/webhooks/clickup`.
7. **Pass:** Pipeline Agent creates Dropbox folders at `/{campus}/{title}/[FOOTAGE]/` and `/{campus}/{title}/[PROJECT]/`. `videos.dropbox_folder` is populated. `agent_logs` shows `dropbox_folders_created`.
8. **Fail:** Folders not created, or path incorrect, or `videos.dropbox_folder` still null. Abort.

**Stage 3. Footage upload and ready for editing**

9. Caiden drops the test 30-second video file into the `[FOOTAGE]` folder via Dropbox desktop sync or web UI.
10. Wait for the Dropbox webhook to fire and the 1-hour delay to complete. For recorded walkthrough purposes, invoke `pipeline.handleFootageDetected(taskId, campusId)` directly to avoid a 1-hour gap in the recording. Note in the narration that production uses the 1-hour delay per `docs/decisions.md` 2026-04-01.
11. **Pass:** Pipeline Agent verifies files exist in `[FOOTAGE]`, sets ClickUp status to `ready for editing`, and updates `videos.status`. `agent_logs` shows `footage_detected_status_updated`.
12. **Fail:** Status not changed, or Dropbox list_folder returned zero files, or ClickUp update errored. Abort.

**Stage 4. Editor assignment**

13. Triggered by the `ready for editing` status change from Stage 3. Pipeline Agent queries active editors for the Austin campus, picks the one with the lowest active task count, updates `videos.assignee_id`, and calls `clickup.updateTask` to add the editor as an assignee on the ClickUp task.
14. **Pass:** A ClickUp assignee appears on the task (Charles Williams or Tipra, per Session 3 seed). `agent_logs` shows `editor_assigned`.
15. **Fail:** No assignee added, or wrong user ID, or Supabase and ClickUp disagree on who was assigned. Abort.

**Stage 5. Editing, export, upload, edited status**

16. Caiden (acting as the editor for test purposes) does the minimum needed to represent an edit: adds a placeholder export back into the `[PROJECT]` folder. Uploads the edited video to Frame.io manually. Pastes the Frame.io link into the ClickUp "E - Frame Link" custom field. Moves the ClickUp task to `edited`. This simulates the editor's manual workflow faithfully.
17. ClickUp fires `taskStatusUpdated` webhook.
18. **Pass:** QA Agent runs all four checks (caption spell, caption formatting, LUFS, stutter). `videos.qa_passed` is set. `agent_logs` shows `qa_started` and either `qa_passed` or `qa_failed`.
19. **Fail:** QA did not run, or ran partially (check the agent_logs chain), or errored. Abort.

**Stage 6. QA branch**

20a. **If QA passes:** The video is eligible for delivery. Walkthrough narration confirms the pass, shows the dashboard QA queue is empty for this task, and continues to Stage 7.
20b. **If QA fails:** Walk through the failure path. Show the ClickUp comment posted by the QA Agent listing issues with timecodes. Show the `videos.status` set to `WAITING` in Supabase and `waiting` in ClickUp. Manually fix the captions (or seed a pre-validated clean SRT) and re-upload to simulate the editor's fix. Move status back to `edited` to retrigger QA. Confirm the second run passes.
21. **Pass:** Either branch concludes with a passed QA state.
22. **Fail:** The retry path does not work, or the fail branch leaves the system in an inconsistent state (ClickUp says `edited` but Supabase says `WAITING`, or vice versa). Abort.

**Stage 7. Done and Frame.io share link**

23. Caiden moves the ClickUp task to `done`.
24. ClickUp fires `taskStatusUpdated` webhook. Pipeline Agent's `case 'done'` calls `createShareLink` per `workflows/frame-io-share-link.md`.
25. **Pass:** A Frame.io share link URL appears in `videos.frameio_share_link`. The ClickUp "E - Frame Link" custom field now holds the client-facing share link URL (not the internal review link that the editor pasted earlier). `agent_logs` shows `share_link_created`. The URL opens in a browser and shows the test video.
26. **Fail:** No share link created, or ClickUp field not updated, or URL 404s when opened. Abort.

**Closing**

27. Confirm the dashboard in localhost reflects the full pipeline state: the test video appears in the `done` column with the Frame.io link visible.
28. Stop the recording.
29. Run `scripts/e2e-test.js` in cleanup mode to delete the test ClickUp task, Dropbox folders, Frame.io asset, Supabase rows, and `processed_calendar_events` entry.

## Recorded walkthrough contents

The SOW deliverable is a single video file. Target length: 20 to 40 minutes.

The walkthrough captures, in order:

1. Brief architecture overview using `docs/architecture.md` diagram on screen.
2. Calendar event creation and Scripting Agent firing.
3. All 3 generated concepts shown in ClickUp.
4. Concept promotion and Dropbox folder creation (show both sides: ClickUp status change, Dropbox web UI updating).
5. Footage upload and the file-detection trigger.
6. Editor assignment in ClickUp.
7. The manual editor step (brief, explain what is automated vs manual in Phase 1).
8. QA Agent running, with logs visible in `pm2 logs`.
9. Whichever QA branch was selected; if pass, narrate that the fail path also exists and show it in a second short segment.
10. Done status and share link appearing in ClickUp.
11. Dashboard tour showing the same state end to end.
12. `agent_logs` review showing the full trail.
13. Closing with where to find the repo, docs, and how to reach Caiden.

Narration should describe what is happening and why, not just what to click. The audience includes Scott and any future maintainer who picks this up cold.

## Outputs

- A single recorded video file delivered as part of the handoff package.
- A set of `agent_logs` entries spanning the entire test, filterable for audit by timestamp.
- An updated `docs/progress-log.md` entry capturing the test run, any bugs found, and whether the recording is the dress rehearsal or the final take.

## Validation

At the end of the test, the following must be true simultaneously:

- The test ClickUp task is in `done` status.
- `videos.status = 'DONE'`, `videos.qa_passed = true`, `videos.frameio_share_link` populated.
- The ClickUp "E - Frame Link" custom field holds the share link URL.
- The Frame.io asset is reachable via the share link URL.
- `agent_logs` contains `scripting`, `pipeline`, `qa` entries in the expected chronological order with no stuck `error`-status entries other than intentional ones (QA fail branch, if exercised).
- The React dashboard reflects the final state without refresh lag beyond the normal polling interval.

## Edge cases

- **Scripting Agent cron does not fire in the test window.** Invoke `scripting.runOnce()` manually to proceed. Do not wait 15 minutes of idle time in the recording. Narrate the manual invocation as equivalent to the cron firing.
- **ClickUp webhook retries a status change during the test.** Expected behavior per `docs/progress-log.md` Session 4 fix: handler returns 200 immediately, no retry storm. Show this in the recording as a point of design strength.
- **Dropbox sync delay causes file detection to miss the footage.** Re-upload or force-sync the client. If it persists, the 1-hour delay is short-circuited with a direct `handleFootageDetected` call; narrate.
- **QA pass on the first try with planted clean captions.** Still narrate the fail branch by referencing the Session 2 QA test output as a companion artifact, or record a second short walkthrough of the fail branch with a deliberately bad SRT.
- **Frame.io share link creation fails because the upload step was manual.** The test expects Caiden to upload the video manually and seed `videos.frameio_asset_id` before moving to `done`. If this is missed, the `done` handler logs `create_share_link_skipped` and nothing happens. Caiden must seed the asset ID and retrigger.
- **Test creates real state that pollutes Scott's live board.** Use a clear title prefix (`__e2e_test_`) and run cleanup at the end. Consider a separate ClickUp list for tests if this becomes noisy. TODO: verify with Caiden before build: decide whether to use a dedicated test list ID.

## Error handling

Per CLAUDE.md rules: every error during the test is logged to `agent_logs` with status `error` before any recovery. The self-healing handler is watched during the test. If it recovers an error silently, narrate the recovery in the walkthrough.

## Test requirements

New file `scripts/e2e-test.js`. Must:
- Seed the Google Calendar test event programmatically (via the service account).
- Optionally invoke `scripting.runOnce()` to speed up the test.
- Offer a `--cleanup` flag that tears down all test state after the run.
- Print a manual-action prompt at each stage that requires Caiden's hands on ClickUp or Dropbox.
- Verify each stage's pass criteria automatically where possible (Supabase reads, ClickUp GETs) and prompt for manual confirmation where not (visual check in ClickUp).

Script must be runnable standalone via `node scripts/e2e-test.js` and `node scripts/e2e-test.js --cleanup`.

## Dependencies

Before this test can run:
- Every other workflow in `workflows/` must be built: Scripting Agent, Pipeline Agent, QA Agent, `frame-io-share-link.md`, `self-healing-handler.md`.
- Mac Mini deployment complete (`workflows/mac-mini-deployment.md`).
- Fireflies integration does not block the test: it is not on the critical pipeline path.
- OpenClaw is not required for the test. If present, narrate its role; if not, narrate the planned conversational layer briefly.
- `students` table has at least one real row with a populated `claude_project_context`.
- Google Calendar service account has the test calendar shared.
- FFmpeg installed on the Mac Mini (per Mac Mini deployment Phase 1).
- Screen recording software installed and tested on the Mac Mini.

## Out of scope for this workflow

- Load or stress testing (not in SOW for Phase 1)
- Multi-campus test (Austin only for Phase 1)
- Performance Agent and Research Agent in the recorded walkthrough: they are covered by their own tests. Mention them during the architecture overview; do not force them into the critical path.
- Testing the Premiere Pro agent chain (Phase 2 per `docs/architecture.md`)

## Acceptance criteria

The test passes when:
- Every stage's pass criteria is met in one continuous recording.
- The recording is between 20 and 40 minutes and is viewable.
- Cleanup leaves Supabase, ClickUp, Dropbox, and Frame.io in the same state they started in.
- `docs/progress-log.md` records the run date and the recording file location.
- Scott reviews the recording and signs off. Per SOW Section 9, his acceptance email starts the 5-business-day review clock covered in `workflows/handoff.md`.
