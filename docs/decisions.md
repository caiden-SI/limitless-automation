# Decision Log — Limitless Media Agency Automation

Format: Date | Decision | Rationale | Status

---

### 2026-04-01 | Schema gap: `qa_passed` column missing from `videos` table

**Decision:** Add `qa_passed boolean default null` to `videos` table during initial migration.

**Rationale:** agents.md specifies the QA Agent writes `qa_passed` to the `videos` table, but schema.md does not include this column. Default null (rather than false) distinguishes "not yet checked" from "checked and failed."

**Status:** Pending — add to migration script.

---

### 2026-04-01 | Project structure follows WAT framework

**Decision:** Organize codebase into `workflows/`, `agents/`, `tools/`, `handlers/`, `lib/` directories.

**Rationale:** CLAUDE-WAT.md specifies the WAT architecture (Workflows, Agents, Tools). `handlers/` added for webhook routing (not agent logic). `lib/` added for shared utilities (Supabase client, Claude client, logger).

**Status:** Done.

---

### 2026-04-01 | Express.js for webhook server, not Fastify or Hono

**Decision:** Use Express.js as specified in project docs.

**Rationale:** Explicitly stated in CLAUDE.md, integrations.md, and the tech stack table. Team familiarity and PM2 compatibility confirmed.

**Status:** Done.

---

### 2026-04-01 | Webhook signature verification required for all inbound routes

**Decision:** Verify signatures on all webhook endpoints before processing payloads.

**Rationale:** integrations.md specifies ClickUp sends a signature header, Dropbox sends a challenge on registration, and Frame.io sends a signature. Processing unverified payloads is a security risk.

**Status:** Scaffolded in handler stubs. Implementation pending per-integration.

---

### 2026-04-01 | Logger writes to both console and Supabase `agent_logs`

**Decision:** All agent activity logged to `agent_logs` table AND console (for PM2 log access).

**Rationale:** Error handling spec requires full error context in `agent_logs` before recovery attempts. Console logging preserved for PM2 `pm2 logs` debugging.

**Status:** Scaffolded in lib/logger.js.

---

### 2026-04-01 | Dropbox file detection uses 1-hour delay

**Decision:** After detecting new files in a Dropbox footage folder, wait 1 hour before triggering status change to READY FOR EDITING.

**Rationale:** integrations.md recommends 1-hour delay to allow full Dropbox sync across all team members' machines. Triggering immediately could assign an editor before footage is available locally.

**Status:** Noted in Pipeline Agent spec. Implementation pending.
