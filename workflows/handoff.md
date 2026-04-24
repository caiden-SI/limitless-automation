# Handoff

SOP for the final delivery of the automation system from Spur Intel to Limitless Media Agency. This is the last workflow executed in Phase 1. Source of truth for the handoff procedure, the acceptance email, and the review clock. Do not deviate from this spec without updating it first.

## Objective

Transfer the complete, running automation to Limitless with everything needed to operate, debug, and extend it independently. Trigger the SOW Section 9 acceptance clock cleanly so the review window is unambiguous for both sides.

Per SOW Section 3 (Deliverables). This workflow packages the four contractually required items (source repo transfer, recorded walkthrough, setup and configuration documentation, acceptance email) plus four Scott-approved additions delivered beyond SOW scope.

## Trigger

Manual, once, after the end-to-end test (`workflows/e2e-test.md`) has been recorded and accepted internally by Caiden. Scheduled at Caiden's discretion once all other workflows are built and the system has been running on the Mac Mini for at least one business day without intervention.

## Inputs

From the repo:
- The `main` branch at the handoff commit SHA
- All `docs/`, `workflows/`, `scripts/`
- `CLAUDE.md` and `ecosystem.config.js`
- `.env.example` (never the real `.env`: that moves through 1Password)
- The recorded walkthrough file produced by `workflows/e2e-test.md`

From external systems:
- GitHub organization control for `caiden-SI` (source) and the Limitless destination org
- 1Password vault "Limitless - Caiden": ownership needs to pass to Scott

## Tools used

Existing:
- GitHub: for the repo transfer
- 1Password: for credential ownership transfer
- Email: for the acceptance message

No new code or migrations. This is a packaging and transfer workflow.

## Data model additions

None.

## Process flow

**Phase 1. Freeze and tag**

1. Confirm the end-to-end test (`workflows/e2e-test.md`) has been recorded and passed in one continuous take.
2. On `main`, run the full verification suite one last time: `node scripts/verify-integrations.js`, `node scripts/verify-clickup.js`, and each `scripts/test-*-agent.js`. All must pass.
3. Tag the handoff commit: `git tag -a handoff-v1 -m "Phase 1 handoff to Limitless"`. Push the tag.
4. Write the final `docs/progress-log.md` entry: "Handoff prepared. Tag: handoff-v1. Commit SHA: {sha}. Recording: {filename or link}." Commit and push.

**Phase 2. Source repo transfer**

5. Confirm Scott has a GitHub account with access to a destination organization (Limitless Media Agency's GitHub org, or his personal account if no org exists). TODO: verify with Caiden before build: confirm the exact destination org or user namespace.
6. In GitHub settings for `caiden-SI/limitless-automation`, use Transfer Ownership. Enter the destination org/user. GitHub sends Scott an email to accept.
7. Scott accepts. The repo is now owned by Limitless. GitHub preserves issues, PRs, tags, and collaborators.
8. Re-invite Caiden as a collaborator with at least Read access for ongoing support questions.
9. Update `docs/integrations.md` and any script that references the repo URL (none currently do; verify with a grep before declaring done).

**Phase 3. Credentials transfer**

10. In 1Password, share the "Limitless - Caiden" vault with Scott. Transfer ownership of the vault to Scott.
11. Caiden retains access for support but no longer owns credentials. Rotation authority becomes Scott's.
12. Scott is briefed on which credentials are long-lived (ClickUp key, Frame.io v2 dev token, Anthropic key) and which auto-refresh (Dropbox refresh token → access token).

**Phase 4. Setup and configuration documentation**

13. Confirm the following docs are current and committed:
    - `CLAUDE.md`: project rules, error handling, gotchas
    - `docs/architecture.md`: system overview, data flow
    - `docs/build-order.md`: build sequence and checkpoints
    - `docs/decisions.md`: the decision log with every consequential choice
    - `docs/integrations.md`: every external service, its purpose, its credential location
    - `docs/progress-log.md`: the full build history, last entry is the handoff
    - `workflows/`: every SOP in this directory, including this one
14. Write a short `docs/operations.md` (or append to `docs/integrations.md`, Caiden's choice) covering:
    - How to view logs: `pm2 logs limitless-webhooks`
    - How to restart: `pm2 restart limitless-webhooks`
    - How to pull updates: `git pull && npm install && pm2 restart limitless-webhooks`
    - How to rotate a credential: edit `.env`, `pm2 restart`
    - How to add a new campus: insert into `campuses`, set `clickup_list_id`, seed editors
    - Where each agent's logs go in `agent_logs` (filter by `agent_name`)
    - The dashboard URL and how to start it: `cd dashboard && npm run dev`
    - The Mac Mini's public webhook URL and who owns the ngrok or Tailscale account

**Phase 5. Recorded walkthrough delivery**

15. Upload the final recording from `workflows/e2e-test.md` to a durable location. Options: a folder in the Limitless Dropbox, a Loom link (if Loom is sanctioned), or attached directly to the handoff email. Prefer Dropbox for retention.
16. Ensure the recording is viewable by Scott and anyone he chooses to grant access to.

**Phase 6. Acceptance email**

17. Caiden sends the acceptance email to Scott. Subject: "Limitless Automation: Phase 1 Handoff and Acceptance Review". Body template:

    > Scott,
    >
    > Phase 1 of the Limitless Automation system is complete and transferred.
    >
    > Delivered per SOW Section 3:
    > 1. **Source code repo:** transferred from `caiden-SI/limitless-automation` to Limitless GitHub. Tag `handoff-v1` marks the handoff commit.
    > 2. **Recorded walkthrough:** {link}
    > 3. **Setup and configuration documentation:** in the repo at `docs/` and `workflows/`. Start at `CLAUDE.md` and `docs/architecture.md`.
    >
    > Delivered beyond SOW scope (Scott-approved additions):
    > 4. **Student Onboarding Agent**. Automates new student intake into the `students` table with generated `claude_project_context`.
    > 5. **Content Performance Agent**. Weekly pattern analysis already live per Monday cron.
    > 6. **Pipeline Age Dashboard View**. Shows how long each video has been in its current status so bottlenecks are visible at a glance.
    > 7. **Webhook Inbox Table**. Persisted record of every inbound webhook, enables replay if processing fails or if a new handler needs historical events.
    >
    > Per SOW Section 9, this email starts the 5-business-day acceptance review. Please reply by end of business {date five business days from send} with either acceptance or a list of issues. Silence after that window counts as acceptance, per the SOW.
    >
    > Available for questions during and after the review.
    >
    > Caiden

18. Replace `{link}` with the recording URL and `{date five business days from send}` with the explicit calendar date. Business days exclude weekends and US federal holidays. Count calendar days carefully.
19. Send. Record the send timestamp in `docs/progress-log.md`.

**Phase 7. Review window**

20. During the 5-business-day window, Caiden stays reachable for clarifying questions but does not ship new features unless Scott raises an issue.
21. If Scott raises an issue, log it in `docs/progress-log.md`, fix it on a branch, open a PR in the Limitless-owned repo, merge after Scott's review.
22. If Scott accepts in writing, log the acceptance in `docs/progress-log.md`. The engagement moves to support mode.
23. If the window closes without reply, log the auto-acceptance per SOW Section 9 in `docs/progress-log.md`.

## Delivered beyond scope

The SOW Section 3 deliverables are source code, recording, documentation, and acceptance. Two additions were built with Scott's approval during Phase 1 without a contract amendment:

1. **Student Onboarding Agent** (`agents/onboarding.js`, `dashboard/src/pages/Onboarding.jsx`)
   - What: conversational Claude-powered intake at `/onboard?student=ID&campus=ID`. Six sections, server-side state in `onboarding_sessions`, synthesizes the 8-section context document and writes to `students.claude_project_context`.
   - Why: the blocker documented in `docs/decisions.md` 2026-04-02 (Scripting Agent blocked on student context approach) is resolved by this agent. Without it, every new student requires manual context entry before the Scripting Agent can generate usable concepts.
   - Status: built and live tested in Session 5. Hardened across two Codex adversarial review rounds (Round 2 system-wide, Round 3 onboarding-focused).
   - Scope note: does not backfill existing students. Manual backfill is a one-time task, not automated.

2. **Webhook Inbox Table and durable processing pattern** (`scripts/migrate-webhook-inbox.sql`, `handlers/clickup.js`)
   - What: a Supabase table that logs every inbound ClickUp webhook with raw payload, plus a durable processing pattern. Events are persisted to `webhook_inbox` before the 200 acknowledgment. Async processing then marks `processed_at` on success or `failed_at` + `error_message` + `retry_count` on failure. Failed events can be replayed.
   - Why: a significant reliability improvement not described in SOW Section 2. Previously, failed processing meant silently dropped events. Now every webhook is durable, every failure is inspectable, and replay is possible without coordinating with ClickUp.
   - Status: built and live in Session 5 (Codex Round 2 fix). ClickUp handler is wired. Dropbox and Frame.io handlers do not yet write to the inbox; that gap is tracked in `docs/architecture.md` TODOs.

## Outputs

- One transferred GitHub repo under Limitless ownership.
- One transferred 1Password vault under Scott's ownership.
- One durable copy of the recorded walkthrough.
- One acceptance email, sent.
- One final `docs/progress-log.md` entry.
- Either one acceptance reply from Scott or one auto-acceptance log entry at the end of the 5-business-day window.

## Validation

Before sending the acceptance email, confirm all of the following:

- `git log -1 handoff-v1` shows the expected commit.
- The Limitless-owned repo URL resolves and Scott can push to it.
- The 1Password vault is listed under Scott's account as owner.
- The recording URL is reachable by Scott and plays end to end.
- Every link in the acceptance email is live.
- The date for the 5-business-day deadline is correctly computed.
- No stale references remain in the repo to `caiden-SI/limitless-automation` as the authoritative source.

## Edge cases

- **Scott does not have a GitHub org.** Transfer to his personal account instead. Recommend he create an org later and transfer again: the second transfer is a GitHub setting change, not a code change.
- **Scott rejects 1Password.** Export the vault as a CSV or encrypted export and deliver through whatever password manager Limitless uses. This is Scott's decision, not Caiden's.
- **Scott's acceptance email reply includes a request that is out of scope.** Acknowledge. If the request is small and clearly within the spirit of Phase 1, deliver it before closing the engagement. If it is Phase 2, confirm in writing that it is Phase 2 and park it.
- **Silence at the 5-business-day mark.** SOW Section 9 says silence is acceptance. Caiden logs the auto-acceptance but should also send a short follow-up note confirming: not as a negotiation, just as a courtesy.
- **An integration breaks during the review window.** Urgent triage. The automation is Scott's production system now. Fix, ship, and document. Do not hide the break: acknowledge in `docs/progress-log.md`.
- **A recording link expires or is deleted.** Keep a backup copy on Caiden's side for at least 12 months. The durable archival copy is Scott's responsibility once delivered.

## Error handling

Per CLAUDE.md rules: any runtime error during the review window is logged to `agent_logs` with status `error` before recovery. The self-healing handler continues to operate as normal. Caiden monitors logs during the window.

Handoff errors (failed transfer, stalled email) are not runtime errors. They are handled by re-attempting the step or escalating to Scott directly.

## Test requirements

No automated test for the handoff itself. The full verification suite (`node scripts/verify-*.js`, `node scripts/test-*.js`) must pass before Phase 1 starts. The recorded walkthrough is the functional test.

A dry-run of the acceptance email to Caiden's own inbox is recommended before sending the real email. Verify formatting, link rendering, and the computed 5-business-day deadline.

## Dependencies

Before handoff can begin:
- End-to-end test recorded and passed.
- Mac Mini stable for at least 24 hours.
- All `docs/` and `workflows/` current.
- Scott confirmed ready to own the system (vault, repo, acceptance review).

## Out of scope for this workflow

- Phase 2 scope (Premiere Pro agent, music recommendation, and everything in `docs/architecture.md` Out of Scope).
- Ongoing support contract terms (separate agreement if needed).
- Migration of any of Scott's personal scripts beyond Fireflies. The Fireflies Agent absorbs `fireflies_sync.py` at delivery per `workflows/fireflies-integration.md`; other personal scripts stay on his side.
- Staff training beyond the recorded walkthrough.

## Acceptance criteria

Handoff is complete when:
- The SOW Section 3 deliverables are all in Scott's hands.
- The acceptance email has been sent and the send is logged.
- Scott has either accepted or the 5-business-day window has closed.
- `docs/progress-log.md` contains a final entry noting the acceptance outcome.
- The repo tag `handoff-v1` is live on the Limitless-owned repo.
