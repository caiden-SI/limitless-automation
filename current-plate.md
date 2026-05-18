# What's On Our Plate — May 18, 2026

Working scratchpad for active and near-term work. Source of truth for
fix details is `iteration-3-fixes.md`. Source of truth for Scott's
asks is `docs/scott-questions-answered.md`.

---

## In flight today

Bundle of four small code items, plus this doc cleanup. All
shippable in one Claude Code session, one deploy.

1. **Fix 13 — QA precondition awareness** (~30-40 lines, `agents/qa.js`)
   Distinguishes "files missing" from "real quality issues" so QA
   stops posting noisy multi-issue reports on tasks where the editor
   hasn't uploaded yet. `qa_passed = NULL` for preconditions-missing,
   `qa_passed = false` reserved for real issues. Closes the
   false-positive comment spam Scott sees on tasks like 5_APS.

2. **Fix 16 — Research hashtag-only response handling** (~30 lines,
   `agents/research.js`). Detects when Claude returns prose instead
   of JSON for thin-transcript videos, gracefully skips and warns
   instead of throwing. Eliminates the noisy parse-error stack
   traces seen May 6/7/10 in logs.

3. **Per-row Copy URL on `/students`** (~15 lines,
   `dashboard/src/pages/StudentsConsole.jsx`). The v1.5 polish we
   cut from the original consoles build. Each un-onboarded student
   row gets a small `COPY URL` button. Lets Caiden grab URLs for
   the 7 current un-onboarded students without running SQL.

4. **Request logging on `dashboard/serve.cjs`** (~5 lines). Restore
   the per-request `[dashboard] GET /admin/... → 200` lines we lost
   when replacing Vercel's `serve`. Observability for prod traffic.

---

## Awaiting external input (truly gated)

| Item | Blocked on | Who |
|---|---|---|
| Fix 7 (Brand SIGNALS subsection) | Which brand accounts to track + Option A vs B schema choice | Scott |
| Fix 9 (Frame.io v4 OAuth) | Adobe Enterprise upgrade for the org | Scott |
| Fix 12 (re-add `CLICKUP_FRAMEIO_FIELD_ID` field) | Cascades from Fix 9 | Scott |
| Fix 14/15 final scoping (manually-created task handling) | What `5_APS`, `SHARK_TANK`, `3.7K_CRSL`, `MAC_MINI_RESPONSE` represent in Charles's workflow | Caiden to ask Charles |

Once those answers land, Fix 7 and Fix 14/15 are small builds. Fix 9
is a single env-var swap + smoke test once Adobe enables OAuth.

---

## Ops items (Caiden, no code)

- Send the 7 un-onboarded students their onboarding URLs (use the SQL
  workaround from session, or wait for item #3 above to ship)
- Text Scott to mention `/scripting` and `/students` consoles exist
  (Query 3 in the health check showed zero usage in 5 days — discovery
  gap, not a product issue)
- Truncate the May 6 Cloudflare HTML noise from
  `~/limitless-automation/logs/health-ping-error.log` on the Mac Mini
  whenever convenient

---

## Recently shipped

For full per-fix detail see `iteration-3-fixes.md` Status lines.

- **2026-05-13** — Dashboard consoles (`/scripting`, `/students`),
  QA advisory hotfix, dashboard `/admin` proxy fix, PM2 cwd pin
- **2026-05-12** — Calendar attendee matching (Fix 10) + drop of
  removed `CLICKUP_INTERNAL_VIDEO_NAME_FIELD_ID` write
- **2026-05-11** — Profile-views URL-based scraping refactor (Fix 11),
  two-way Sheet sync (Fix 5), Profile-views daily cadence (Fix 2)
- **2026-05-08** — Profile-views Instagram path verified (Fix 8)
- **2026-05-07** — Stub-mode headline fix (Fix 1), onboarding chat
  polish, `scripts/create-student.js` CLI

---

## Health snapshot (May 18 audit)

System is in a healthy state. 5 days of production data since the
May 13 batch shipped:

- 55,163 success rows in agent_logs (last 7 days)
- 48 warning, 4 error — 0.087% non-success rate
- Scripting cron 96/96 ticks pass in 24h, zero retries
- QA hotfix held — zero real-world `qa_gate_blocked` events
- Health-ping firing every minute (PM2 `↺` counter is just
  misleading for cron_restart jobs — log + Supabase confirm liveness)
- Charles's manual-task cadence: ~2 tasks/week (lower than initial
  May-13 data suggested), neither caused a loop since the hotfix
