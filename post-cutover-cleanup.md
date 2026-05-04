# Post-Cutover Cleanup

Five focused cosmetic fixes flagged during the Mac Mini cutover (April 30, 2026). Apply in order. Each is independent — commit and PR separately so any one can be reverted without affecting the others.

**Hard rules for this session:**
- Do not touch credentials, secrets, or `.env` values
- Do not modify any handler signature verification logic
- Do not modify Frame.io integration (separately blocked on Adobe migration)
- Run the relevant test suite after each change; do not proceed if a test fails
- Each fix is its own commit/PR; do not bundle

---

## Fix 1: Boot-time logger fetch failures

**Symptom:** After a Mac Mini reboot, `pm2 logs limitless-webhooks --lines 30 --nostream` shows two `[logger] Failed to write to agent_logs: TypeError: fetch failed` errors, both at the boot timestamp. The server tries to log its own startup events to Supabase before the macOS network stack is fully ready.

**Net effect:** ~5 seconds of startup `agent_logs` entries are lost on every reboot. No functional impact, just missing telemetry for the boot sequence.

**Fix:** In `lib/logger.js`, wrap the Supabase insert in a retry-with-backoff. Three attempts, ~1s / 3s / 7s delays. If all three fail, fall back to the existing console-only behavior. Do NOT throw — the logger has never thrown to its caller and must not start.

**Acceptance:**
- After reboot, no `Failed to write to agent_logs` errors appear in `pm2 logs`
- All existing tests continue to pass: `node scripts/test-self-heal.js`, `node scripts/test-e2e-pipeline.js`
- Add a new test case in a small unit test file that simulates Supabase fetch failure on the first call, success on the second, and asserts the log eventually lands

---

## Fix 2: `verify-integrations.js` Dropbox check uses static token

**Symptom:** `node scripts/verify-integrations.js` reports `[FAIL] Dropbox (list_folder) — HTTP 401: expired_access_token` whenever the access token in `.env` has expired (every 4 hours). The production webhook server handles this correctly via `lib/dropbox.js`'s 401 retry path, but the verify script reads `process.env.DROPBOX_ACCESS_TOKEN` directly and bypasses refresh logic.

**Net effect:** Verify script reports false failures. Misleading during ops checks.

**Fix:** In `scripts/verify-integrations.js`, replace the direct `fetch` to `https://api.dropboxapi.com/2/files/list_folder` with a call to `dropbox.dropboxFetch(...)` from `lib/dropbox.js`. The wrapper already handles 401 → refresh → retry transparently.

**Acceptance:**
- `node scripts/verify-integrations.js` returns `[PASS] Dropbox (list_folder)` even when the `.env` access token is stale
- No new test needed — the verify script IS a test
- Run the full verify after the change to confirm

---

## Fix 3: GET `/webhooks/dropbox` challenge handler is silent

**Symptom:** When Dropbox sends the verification challenge during webhook registration, the server responds correctly but logs nothing. Cutover registration showed up as zero log entries even though it succeeded.

**Net effect:** Hard to debug if Dropbox verification ever fails in the future — there's no record of the challenge ever arriving.

**Fix:** In `server.js`, the GET `/webhooks/dropbox` handler should call `log({ agent: 'dropbox', action: 'challenge_received', payload: { challenge: req.query.challenge?.slice(0, 10) + '...' } })` before responding. Log the first 10 chars of the challenge only — don't log the full value (defensive, even though challenges are meant to be public).

**Acceptance:**
- Hit the endpoint with `curl https://limitless-automations-mac-mini.tail15aca0.ts.net/webhooks/dropbox?challenge=test123` — the response is still `test123` plain text
- `agent_logs` shows a new row: `agent_name=dropbox, action=challenge_received, status=success`
- No existing tests should fail

---

## Fix 4: Update `docs/integrations.md` with the new Funnel URL

**Symptom:** `docs/integrations.md` still references the old Win11 ngrok URL `https://nonhumanistic-rona-bathymetric.ngrok-free.dev` in the "Webhook Server" section.

**Fix:** Pure text edit. Replace the ngrok URL with `https://limitless-automations-mac-mini.tail15aca0.ts.net` everywhere it appears. Also update the "Runtime" line in the Webhook Server section from `Express.js on Mac Mini, managed by PM2` (which was aspirational) to reflect that this is now the actual production state. Remove the "Notes" line about the Mac Mini being future state — it's current state now.

**Acceptance:**
- `grep -i ngrok docs/integrations.md` returns nothing
- `grep tail15aca0 docs/integrations.md` returns the production URL

---

## Fix 5: Add Session 20 cutover entry to `docs/progress-log.md`

**Symptom:** `docs/progress-log.md` ends at Session 19 (April 25). The Mac Mini cutover happened on April 30 but is not yet documented.

**Fix:** Append a Session 20 entry to `docs/progress-log.md`, structured like the existing session entries. Cover:

- Tailscale Funnel deployment for public webhook endpoint (`https://limitless-automations-mac-mini.tail15aca0.ts.net/`)
- Mac Mini setup: Homebrew, Node 22, PM2 6.0.14, FFmpeg, Git, Tailscale CLI, repo clone, `.env` from 1Password, Google Calendar service account JSON
- PM2 boot persistence via launchd (with notes about LaunchAgent + auto-login workaround)
- ClickUp webhook URL update (existing webhook ID `a8a5d682-ebe1-4cc1-b8a6-5a195859d886` repointed)
- Dropbox webhook registration via App Console
- Frame.io webhook deferred — team-admin scope blocked, requires Scott action
- Live curl-driven webhook test verified signature verification and full pipeline path
- One pre-existing data state issue surfaced: April 5 "RUNNING APP" task at READY FOR SHOOTING with missing Dropbox folder, status synced back to IDEA in both systems
- Outstanding: Frame.io webhook (Scott), Fireflies cutover (Scott + flag flip), four cosmetic items in this cleanup doc
- Win11 dev box is permanently retired (was never a live host, just the build environment)

Match the writing style of Session 19 (terse, present tense, code-block file paths and IDs).

**Acceptance:**
- The Session 20 entry exists at the bottom of `docs/progress-log.md`
- Style matches the existing entries
- All references to specific IDs, URLs, secrets, and timestamps are accurate to what actually happened (cross-reference Session 19 for tone)

---

## After all five are merged

Push to GitHub. On the Mac Mini:

```bash
cd ~/limitless-automation
git pull origin main
npm install
pm2 restart limitless-webhooks --update-env
pm2 logs limitless-webhooks --lines 30 --nostream
```

Verify:

1. Server boot is clean — no logger fetch errors in the post-restart log tail
2. `node scripts/verify-integrations.js` returns 6/6 PASS (Dropbox now works through refresh path)
3. Dropbox challenge endpoint logs to `agent_logs` if hit
4. `docs/integrations.md` and `docs/progress-log.md` reflect current production state on GitHub

If anything fails, `git reset --hard HEAD~5 && pm2 restart limitless-webhooks --update-env` to roll back all five fixes.
