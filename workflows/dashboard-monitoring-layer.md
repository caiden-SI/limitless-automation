# Dashboard Monitoring Layer

SOP for the post-Mac-Mini step that gives Scott phone-accessible monitoring of the pipeline without standing up a public URL or auth layer. Source of truth for the dashboard remote-access pattern and the design refresh approach. Do not deviate from this spec without updating it first.

## Objective

Scott can open a polished, mobile-responsive status dashboard from his phone — anywhere — to glance at pipeline state, throughput, and errors. Caiden gets the same access from his phone for incident monitoring. Neither requires a public URL, paid hosting, or auth migration.

Two pieces:

1. **Remote access via Tailscale** — the Mac Mini's local dashboard becomes reachable from any device on the Limitless tailnet.
2. **Design refresh via Claude Design + Claude Code** — the existing localhost dashboard gets a polished aesthetic and the missing surfaces (KPI tiles, realtime updates, errors panel).

## Why this shape (vs alternatives considered)

The earlier monitoring-layer research recommended a public URL on `status.limitlessmedia.com` with Vercel hosting and Supabase Auth. That solves the same user-facing problem but expands scope significantly: hosting setup, DNS, auth migration, billing for hosting, and reopening the SECURITY DEFINER warnings we deliberately left accepted (those decisions in `docs/decisions.md` assume the dashboard stays non-public).

Tailscale collapses all of that. The dashboard physically stays on the Mac Mini's localhost — just bound to `0.0.0.0` instead of `127.0.0.1` so it's reachable on the tailnet IP. Anyone on the tailnet (Scott, Caiden, anyone invited) hits it from their phone or laptop. Nobody else on the public internet can reach it because it isn't actually exposed.

The earlier research also considered OpenClaw and Paperclip and rejected both as wrong-layer (agent runtime / orchestrator replacement, neither aimed at observability). That conclusion stands. Tailscale + Claude Design is a tighter fit than either.

What this gives up vs. the public-URL plan: a "real URL on the Limitless domain" perceived-premium thing. Scott isn't going to brag about a status page to clients — he just wants to glance at it. Not worth the scope expansion.

## Trigger

Manual, one-time. Performed by Caiden after Mac Mini cutover (`workflows/mac-mini-deployment.md`) is complete. Phase 1 (Tailscale) ships before Phase 2 (design refresh) so Scott has working remote access first; the visual polish lands later.

## Inputs

For Tailscale setup:
- A Tailscale account owned by Limitless (not Caiden's personal). Recommended: register with `automation@limitlessyt.com` or similar shared Limitless inbox. Scott can be added as a member of the tailnet from there.
- Scott's phone (iOS or Android — both supported).
- Mac Mini already configured per `workflows/mac-mini-deployment.md` Phase 1-7.

For the design refresh:
- Claude Pro/Max/Team subscription (Caiden's). Claude Design at `claude.ai/design` is the entry point.
- Claude Code session pointed at `dashboard/src/` for the handoff step.
- Reference screenshots of dashboards to match (Linear, Vercel, Resend, Cal.com — pick the aesthetic).

## Phase 1 — Remote dashboard access via Tailscale

**Goal:** Scott can open the dashboard from his phone in any network condition where his phone has internet.

1. **Create the Limitless tailnet.** Go to `tailscale.com`, sign up with the Limitless email. Free tier is sufficient (up to 100 devices, 3 users — way more than this needs).
2. **Install Tailscale on the Mac Mini.**
   ```
   brew install --cask tailscale
   ```
   Open the Tailscale app, sign in to the Limitless tailnet. Confirm the Mac Mini appears in the admin console at `login.tailscale.com/admin/machines`.
3. **Invite Scott to the tailnet.** Admin console → Users → Invite users. Scott receives an email, accepts.
4. **Install Tailscale on Scott's phone.** App Store / Play Store → Tailscale. Scott signs in with the email he was invited under. The app stays logged in passively; no per-session work required.
5. **Bind the dashboard to all interfaces.** In `dashboard/vite.config.js` (or wherever the dev server config lives), change the bind from `127.0.0.1` to `0.0.0.0`. If using `vite preview`, set `--host 0.0.0.0`. The dashboard now listens on the Mac Mini's tailnet IP.
6. **Find the Mac Mini's tailnet hostname.** In the Tailscale admin console, copy the MagicDNS name (something like `mac-mini.tail-scale.ts.net`).
7. **Bookmark on Scott's phone.** `http://mac-mini.tail-scale.ts.net:<dashboard-port>`. Add to home screen so it opens like an app.
8. **Verify from a non-tailnet network.** Turn off Wi-Fi on Caiden's phone, use cellular, confirm the bookmark loads. (It should — Tailscale establishes the connection over the tailnet regardless of network.)

That's it. No public exposure. No auth setup. SECURITY DEFINER warnings stay correctly accepted.

## Phase 2 — Dashboard refresh via Claude Design + Claude Code

**Goal:** The dashboard looks like something at a series-B startup, not a localhost prototype.

Claude Design (Anthropic, launched April 2026, available at `claude.ai/design`) is the visual ideation tool. It turns prompts into working visuals — prototypes, mockups, layouts — and packages them into a "handoff bundle" that Claude Code can implement against the actual repo. The split: Claude Design for aesthetic, Claude Code for integration.

**Workflow:**

1. **Open Claude Design** at `claude.ai/design` with a Pro/Max/Team account.
2. **Describe the dashboard.** Suggested starting prompt:
   > "Monitoring dashboard for a video production pipeline. KPI tile row across the top: videos in flight, completed this week, average turnaround, QA pass rate, last error timestamp, weekly token cost. Below that, a kanban view of videos in flight grouped by ClickUp status (idea → ready for shooting → ready for editing → in editing → edited → uploaded to dropbox → sent to client → done). Side panel: recent agent activity feed. Errors panel that's quiet when nothing is wrong. Dark mode default. Linear-style aesthetic — clean, minimal, no chartjunk. Mobile-responsive."
3. **Iterate visually.** Comment inline on elements that aren't right, adjust spacing/color/typography with the live knobs, paste reference screenshots ("more like this"). Claude Design is built for this kind of refinement — use it.
4. **Generate the handoff bundle** when the design is locked.
5. **Open a Claude Code session** pointed at `dashboard/src/`. Pass the handoff bundle with one instruction:
   > "Implement this design against the existing dashboard. Wire to the real Supabase queries already in `dashboard/src/lib/`. Keep the existing RPC scoping. Don't break the current auth pattern (anon key + SECURITY DEFINER `get_campus_*` functions)."
6. **Test against real data.** Cron-fed `agent_logs` rows, real `videos` table state, real `webhook_inbox` failures. Don't ship against mocks.
7. **Iterate the chat tab separately** later (deferred — see Out of scope).

**Why not Tremor or shadcn/ui directly?**

The earlier proposal recommended Tremor as a component library Claude Code would use. That made sense before Claude Design existed. Now: Claude Design generates components from scratch and can read the existing codebase to keep things consistent. For Scott's status page (KPI tiles, kanban, activity feed, errors panel — no time-series charts), Claude Design alone is enough. If specific chart polish becomes a need later, Claude Code can pull in Tremor selectively for those components.

## Outputs

- A Tailscale tailnet with the Mac Mini and Scott as members.
- A bookmarked tailnet URL on Scott's phone that opens the dashboard.
- The dashboard server bound to `0.0.0.0` instead of `127.0.0.1`.
- A refreshed dashboard implementation in `dashboard/src/` matching a Claude Design output.
- A `docs/progress-log.md` entry recording the cutover and the design refresh sessions.

## Validation

- From a phone on cellular (not the Mac Mini's local network), the bookmarked URL loads and shows live pipeline state.
- The dashboard is unreachable from a device not on the tailnet (try a public-internet curl to confirm).
- Scott confirms via screenshot that the dashboard works on his phone.
- A real ClickUp status change produces a visible update in the dashboard within a few seconds (Supabase Realtime, if wired).

## Edge cases

- **Tailscale free tier hits 100 devices.** Unlikely for this use case (3-5 devices total expected) but document the upgrade path: `tailscale.com/pricing` — Personal Pro is $5/mo. Not blocking, just future-aware.
- **Scott uninstalls Tailscale by accident.** He just reinstalls and signs in to the same email. No state lost.
- **Mac Mini reboots, Tailscale doesn't auto-start.** Tailscale on macOS installs a launch agent automatically; verify after first reboot. If it fails, reinstall via `brew install --cask tailscale` which sets up launchd properly.
- **Dashboard binds to localhost only after a code change.** Re-check `dashboard/vite.config.js` and any `npm run dev` / `npm run preview` invocations in `package.json`. The bind address can drift if someone changes config without realizing.
- **Claude Design subscription lapses mid-iteration.** Designs are saved per-account. Fine to pause and resume. Doesn't block production — the existing dashboard keeps working.

## Out of scope for this workflow

These are deliberate exclusions, not omissions.

- **Chat tab on the dashboard.** Wrapping the `get_campus_*` RPCs as Claude tools is a known follow-up. Deferred until Phase 1 (remote access) and Phase 2 (design refresh) ship and Scott has used the dashboard in practice. May not be needed if the visual surfaces answer his real questions.
- **Langfuse instrumentation.** Trace and token-cost visibility is operationally useful for Caiden but doesn't help Scott. Deferred until there's a specific need (a billing question, a debugging incident, a Spur Intel client asking for it).
- **Public URL on `limitlessmedia.com`.** Reconsider only if Scott explicitly asks for it. Tailscale + bookmark covers his actual need.
- **Multi-user roles.** One admin (Caiden), one viewer (Scott). Add when a second campus comes online.
- **Mobile-native app.** Mobile-responsive web in the dashboard is enough.

## Dependencies

Before this workflow can run:
- Mac Mini cutover complete (`workflows/mac-mini-deployment.md`).
- Existing dashboard runs cleanly on the Mac Mini at localhost.
- Caiden has Claude Pro/Max/Team for Claude Design access.
- Scott has a phone capable of running the Tailscale app (iOS 14+ or Android 8+).

## Acceptance criteria

The monitoring layer is complete when:
- Scott has the dashboard bookmarked on his phone home screen and can open it without thinking about it.
- The dashboard refresh has shipped — Scott's reaction on first view is "this looks like a real product."
- A `docs/progress-log.md` entry records the Tailscale setup date, the tailnet hostname, and the design refresh sessions.
- `workflows/openclaw-integration.md` is deleted from the repo (the OpenClaw direction is no longer pursued; keeping the spec creates handoff confusion).
