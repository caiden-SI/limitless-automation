# Mac Mini Deployment

SOP for migrating the webhook server, agents, and dashboard from the current Windows 11 desktop to the purchased Mac Mini. This is the production hosting step. Source of truth for the cutover. Do not deviate from this spec without updating it first.

## Objective

Move the live automation stack to the Mac Mini so it runs unattended 24/7 under PM2, with stable public webhook URLs and all integrations pointing to the new host. At the end of this workflow, the Windows 11 desktop can be turned off with no impact on the pipeline.

Per SOW Section 2 (Deployment and Interface → Mac Mini configuration). The Mac Mini is purchased and on hand; this workflow is the cutover procedure.

## Trigger

Manual, one-time. Performed by Caiden. Scheduled for a window when no ClickUp status changes or Dropbox uploads are expected, so inflight webhooks do not go to a dying server.

TODO: verify with Caiden before build. Confirm the cutover window with Scott. Editor activity typically peaks during business hours Austin time.

## Inputs

From 1Password vault "Limitless - Caiden":
- `ANTHROPIC_API_KEY`, `CLICKUP_API_KEY`, `CLICKUP_WEBHOOK_SECRET`, `CLICKUP_AUSTIN_LIST_ID`, `CLICKUP_FRAMEIO_FIELD_ID`, `CLICKUP_DROPBOX_FIELD_ID`
- `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_ACCESS_TOKEN`, `DROPBOX_REFRESH_TOKEN`
- `FRAMEIO_API_TOKEN`, `FRAMEIO_WEBHOOK_SECRET`
- `FIREFLIES_API_KEY`, `APIFY_API_TOKEN`
- `GOOGLE_CALENDAR_CREDENTIALS_PATH` (and the associated JSON file copied to Mac Mini)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- `ORCHESTRATOR_SECRET` (if OpenClaw is live by cutover)

From the current Windows 11 host:
- The actual `.env` file as a reference to confirm key names and any session-only additions not yet promoted to 1Password

From GitHub:
- `git@github.com:caiden-SI/limitless-automation.git` on `main` branch

## Tools used

Existing:
- `ecosystem.config.js`: PM2 configuration with auto-restart, memory limit, exp backoff, and log rotation already set
- `package.json`: Node dependencies
- The full repo as-is

New on the Mac Mini:
- Homebrew
- Node.js (match the version used in development: TODO: verify with Caiden before build; run `node --version` on the Win11 host to confirm)
- PM2 (installed globally)
- Either ngrok with a reserved domain OR Tailscale with Funnel: see Public endpoint strategy below

## Data model additions

None. This is a hosting migration. Supabase, schemas, tables, and data all stay put.

## Process flow

**Phase 1. Mac Mini base setup**

1. Power on Mac Mini, complete macOS first-run, enable automatic login for the dedicated `limitless` user (or whatever account Caiden chooses). TODO: verify with Caiden before build: decide whether to create a dedicated user or run under Caiden's personal account.
2. Install Homebrew: run the official installer script from `brew.sh`.
3. Install Node.js: `brew install node@20` (or the matching version). Verify with `node --version` and `npm --version`.
4. Install PM2 globally: `npm install -g pm2`.
5. Install Git: `brew install git`.
6. Install FFmpeg: `brew install ffmpeg`. Required by the QA Agent's LUFS check: `docs/progress-log.md` Session 2 notes FFmpeg is gracefully skipped when missing, but production needs it present.

**Phase 2. Repo and credentials**

7. Generate an SSH key on the Mac Mini, add as a deploy key to the GitHub repo.
8. Clone the repo: `git clone git@github.com:caiden-SI/limitless-automation.git ~/limitless-automation`.
9. `cd ~/limitless-automation && npm install`.
10. For the dashboard: `cd dashboard && npm install && cd ..`.
11. Create `.env` at the repo root. Copy values from 1Password vault "Limitless - Caiden". Do not copy from the Win11 host's `.env` via a shared channel: use 1Password. This protects secrets and surfaces any out-of-band keys that were added to Win11 but not promoted.
12. Copy the Google Calendar service account JSON from 1Password to the path referenced in `GOOGLE_CALENDAR_CREDENTIALS_PATH`. Set macOS file permissions to 600.
13. Run `node scripts/verify-integrations.js` and `node scripts/verify-clickup.js`. All checks must pass. If any fails, fix before proceeding. Do not continue the cutover with broken integrations.

**Phase 3. PM2 persistence**

14. Start the server: `pm2 start ecosystem.config.js`.
15. Verify logs: `pm2 logs limitless-webhooks`. Confirm `[server] Limitless webhook server listening on port 3000`.
16. Save PM2 state: `pm2 save`.
17. Configure PM2 to launch on boot: `pm2 startup launchd`. Follow the printed instruction to register the launchd plist. Verify by rebooting the Mac Mini and confirming PM2 starts automatically with the `limitless-webhooks` process running.
18. Confirm auto-restart: kill the process with `pm2 stop limitless-webhooks && pm2 start limitless-webhooks`. Log should show restart. Trigger a deliberate crash by editing a test file to throw on require, restart, and confirm PM2 respects `max_restarts: 10` before backing off.

**Phase 4. Public endpoint**

19. Choose ngrok or Tailscale. See Public endpoint strategy below. Default recommendation: ngrok with a reserved domain, because it is the least friction and the Win11 setup already uses it (`nonhumanistic-rona-bathymetric.ngrok-free.dev`). Reserved domains survive machine restarts.
20. If ngrok: install via `brew install ngrok/ngrok/ngrok`. Authenticate with the existing account (shared with the Win11 setup). Claim or reuse the reserved domain. Configure ngrok as a launchd service so it survives reboots. TODO: verify with Caiden before build: confirm the current ngrok plan supports a reserved domain (the Win11 URL looks like a free-tier assigned domain, which does not persist across ngrok restarts).
21. If Tailscale: install the Tailscale macOS app, log in to the Limitless tailnet, enable Funnel on port 3000 for the `/webhooks/*` routes. Funnel provides a `*.ts.net` URL that survives restarts.
22. Confirm `curl https://{new-url}/health` returns 200 from an external network.

**Phase 5. Update webhook endpoints**

23. ClickUp: update the webhook registered in Session 3 (ID `a8a5d682-ebe1-4cc1-b8a6-5a195859d886`) to point to `https://{new-url}/webhooks/clickup`. Use the ClickUp API: `PUT /team/{team_id}/webhook/{webhook_id}`. Do not delete and recreate: the existing secret stays valid.
24. Dropbox: update the webhook URL in the Dropbox App Console to `https://{new-url}/webhooks/dropbox`. Dropbox will send a GET challenge; the existing handler responds automatically.
25. Frame.io: update the webhook URL via `POST /v2/hooks` update or the Developer Dashboard to `https://{new-url}/webhooks/frameio`. TODO: verify with Caiden before build: confirm whether a Frame.io webhook is currently registered; Session 3 did not record creating one.
26. Verify each webhook health: ClickUp exposes `fail_count` and `health.status` on the webhook record. All three should show `fail_count: 0` after a test event.

**Phase 6. Smoke test**

27. Trigger a ClickUp status change on a test task from `idea → ready for shooting`. Watch `pm2 logs limitless-webhooks` for the incoming webhook. Expected: status_change log, Dropbox folder creation log, `dropbox_folders_created` success.
28. Verify the folder exists in Dropbox via the web UI or `scripts/test-pipeline-folders.js`.
29. Trigger `ready for shooting → ready for editing` via a dummy Dropbox file upload in the `[FOOTAGE]` folder. Expected: 1-hour delayed status change (or invoke directly via the orchestrator endpoint if not willing to wait).
30. Run the dashboard locally on the Mac Mini: `cd dashboard && npm run dev`. Verify it connects to Supabase and shows live pipeline state. Dashboard stays localhost-only; it is not exposed through ngrok or Tailscale.
31. Confirm cron jobs fire: check `agent_logs` for a `scheduler` entry showing `job_started: research-agent` the next morning at 6 AM, and `performance-agent` the next Monday at 7 AM. The scheduler logs automatically.

**Phase 7. Decommission Win11**

32. Stop PM2 on the Win11 desktop: `pm2 stop limitless-webhooks && pm2 delete limitless-webhooks`.
33. Revoke the Win11-specific ngrok auth if different from the Mac Mini's.
34. Leave the Win11 `.env` in place for 30 days in case rollback is needed. Do not delete the Win11 checkout for at least one successful week on the Mac Mini.
35. Log the cutover in `docs/progress-log.md` with the timestamp, the new public URL, and any issues encountered.

## Public endpoint strategy

Two viable paths. Pick one during Phase 4.

**Option A: ngrok with reserved domain** (recommended)
- Pros: no new networking learning curve, URL persists across restarts, already in use.
- Cons: ngrok subscription required for a reserved domain (free tier assigns random subdomains on each restart).
- Fit: current Win11 setup uses ngrok. Cutover is lowest friction.

**Option B: Tailscale Funnel**
- Pros: no third-party hosted tunnel, URL stable on `*.ts.net`, free for small teams.
- Cons: introduces Tailscale as a dependency, requires enabling Funnel on the tailnet.
- Fit: a cleaner long-term option if Caiden wants to reduce vendor surface area.

Either option satisfies the SOW. The URL change is invisible to Scott as long as the webhooks are updated in all three external systems.

## Outputs

- A running PM2 process on the Mac Mini serving webhooks and cron jobs.
- Updated webhook URLs in ClickUp, Dropbox, Frame.io.
- A `docs/progress-log.md` entry documenting the cutover.
- A stable public URL committed to `docs/integrations.md` replacing the current Win11 ngrok subdomain.

## Validation

- `/health` returns 200 from the new public URL.
- All `scripts/verify-integrations.js` and `scripts/verify-clickup.js` checks pass.
- A ClickUp status change on a test task produces the expected pipeline activity in logs and in Dropbox.
- `pm2 status` shows `online`, uptime stable, restarts controlled.
- After a full Mac Mini reboot, PM2 and ngrok (or Tailscale) come back up within 60 seconds, and `/health` returns 200.

## Edge cases

- **Mac Mini loses power during cutover.** Restart, run `pm2 resurrect`, verify. Because the old Win11 host is still running during Phase 5 cutover, webhooks continue to flow to Win11 until the ClickUp/Dropbox/Frame.io URLs are updated. Delay the URL updates until Mac Mini is confirmed stable.
- **ngrok reserved domain not available on current plan.** Fall back to Tailscale Funnel. Do not accept a random ngrok subdomain: it will change on restart and break every webhook.
- **FFmpeg missing when QA runs.** `agents/qa.js` gracefully skips LUFS per Session 2 notes, but the skip is logged as a warning. Install FFmpeg in Phase 1 step 6 to avoid the degraded mode.
- **ClickUp webhook update returns 200 but events stop arriving.** Re-save the webhook secret. If still broken, delete and recreate the webhook (store the new ID and secret in `.env`).
- **Dropbox challenge verification fails on the new URL.** macOS firewall blocking the port or ngrok misconfigured. Test with `curl https://{new-url}/webhooks/dropbox?challenge=test`: should echo `test` back.
- **Time zone drift on cron.** macOS defaults to the local time zone. Set the Mac Mini to US Central (Austin) to match Scott's expectations for 9PM/10PM/6AM/7AM cron timings. `sudo systemsetup -settimezone America/Chicago`.
- **Old Win11 server still running and ClickUp webhook split between two URLs.** Should not happen if Phase 7 step 32 is executed immediately after Phase 5. If it does, stop the Win11 PM2 manually.

## Error handling

Per CLAUDE.md rules: every error during cutover must be logged (terminal output is enough for the cutover itself; Supabase `agent_logs` continues to receive webhook-level errors). If a step fails, pause. Do not continue the cutover with any check unresolved.

## Test requirements

The cutover itself is the test. In addition:

- Run the existing test suite: `node scripts/test-pipeline-folders.js`, `node scripts/test-qa-agent.js`, `node scripts/test-research-agent.js`, `node scripts/test-performance-agent.js`, `node scripts/verify-integrations.js`, `node scripts/verify-clickup.js`. Every test must pass on the Mac Mini before any webhook URL is updated in external systems.
- After cutover, run one end-to-end live webhook test (ClickUp status change on a real task).

## Dependencies

- Mac Mini on the Limitless network with internet access.
- 1Password access to the "Limitless - Caiden" vault.
- GitHub deploy key or Caiden's personal GitHub access on the Mac Mini.
- Admin access to ClickUp, Dropbox App Console, Frame.io Developer Dashboard.
- ngrok or Tailscale account credentials.

## Out of scope for this workflow

- Hardening the Mac Mini beyond basic use (firewall rules, disk encryption, remote access: handled separately if needed)
- CI/CD pipeline for automatic deploys (manual `git pull` + `pm2 restart` is the Phase 1 update mechanism)
- Monitoring and alerting beyond PM2 + `agent_logs` (no Datadog, no Sentry in Phase 1)
- Moving Supabase, Anthropic, or any external service: only the self-hosted webhook server moves

## Acceptance criteria

The Mac Mini deployment is complete when:
- PM2 runs `limitless-webhooks` with uptime > 24 hours continuously on the Mac Mini.
- A Mac Mini reboot recovers the process within 60 seconds, verified once.
- A real ClickUp status change fires the full pipeline (folder creation, editor assignment) end to end.
- The Win11 desktop is offline and has been for at least one business day without incident.
- `docs/integrations.md` shows the new public URL.
- `docs/progress-log.md` records the cutover date and any follow-ups.
