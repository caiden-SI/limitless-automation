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

**Decision:** After detecting new files in a Dropbox footage folder, wait 1 hour before triggering status change to "ready for editing".

**Rationale:** integrations.md recommends 1-hour delay to allow full Dropbox sync across all team members' machines. Triggering immediately could assign an editor before footage is available locally.

**Status:** Noted in Pipeline Agent spec. Implementation pending.

---

### 2026-04-02 | Frame.io: Use v2 API now, plan v4 migration later

**Decision:** Build all Frame.io agent integrations against the **v2 API** (`https://api.frame.io/v2/`) using the existing developer token (`fio-u-*`). Document the v4 migration path below so we can switch when ready.

**Rationale:** The v4 API requires Adobe OAuth Server-to-Server credentials issued through Adobe Developer Console. Our current developer token authenticates against v2 but returns 401 on all v4 endpoints. Setting up v4 requires Adobe org-level prerequisites (Frame.io provisioned on the Adobe org, Admin/Developer role, product profile assignment) that are outside our control and need Scott's involvement. The v2 API covers all endpoints we need today: asset upload, comments, share links. Building on v2 now avoids blocking the Pipeline and QA agents.

**v4 migration will be required if:** Adobe deprecates v2, or we need v4-only features (workspace-level access controls, Adobe I/O Events for webhooks instead of Frame.io native webhooks).

---

#### Frame.io v4 Setup Instructions (Adobe OAuth Server-to-Server)

When ready to migrate, follow these steps exactly:

**Prerequisites (Scott or Adobe org admin must complete):**

1. **Verify Adobe org has Frame.io provisioned.** Log in to [Adobe Admin Console](https://adminconsole.adobe.com/) → Products. Frame.io must appear as a provisioned product. If it does not, the org admin must add it (requires an active Frame.io Enterprise or Team plan linked to the Adobe org).

2. **Ensure the developer has the correct role.** The person creating the credential needs **Developer** or **System Administrator** role in Adobe Admin Console → Users.

3. **Confirm the Frame.io account is on Adobe identity.** If the team still logs in at `app.frame.io` with email/password (not Adobe SSO), the account has not been migrated. Migration is initiated by Frame.io/Adobe — contact Adobe support if needed.

**Adobe Developer Console Setup:**

4. Go to [Adobe Developer Console](https://developer.adobe.com/console/) and sign in with the Adobe org account.

5. Click **Create new project** → give it a name (e.g., "Limitless Automation").

6. In the project, click **+ Add to Project** → **API**.

7. Find **Frame.io** in the API list (under Creative Cloud). If it does not appear, Frame.io is not provisioned on the org (see prerequisite 1). Select it and click **Next**.

8. Choose **OAuth Server-to-Server** as the credential type. Give the credential a name (e.g., "limitless-automation-server").

9. Select the required **product profiles** — these control what Frame.io data the credential can access. Select the profile that includes "Scott's Account" / the team workspace where video assets live.

10. Click **Save configured API**.

11. On the credential overview page, copy:
    - `client_id` (also called "API Key")
    - `client_secret` (click "Retrieve client secret")

**Generate an Access Token:**

12. Request a token from Adobe IMS:

```bash
curl -X POST 'https://ims-na1.adobelogin.com/ims/token/v3' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&grant_type=client_credentials&scope={SCOPES}'
```

Scopes will be shown on the credential overview page in Adobe Developer Console after setup. They typically include the Frame.io-specific scopes assigned via product profiles.

13. The response returns:
```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "expires_in": 86400
}
```

**Token is valid for 24 hours.** There is no refresh token in the client_credentials flow — request a new token when the current one expires or on 401. Cache the token; Adobe throttles integrations that request tokens too frequently.

**Update .env:**

14. Add to `.env`:
```
FRAMEIO_V4_CLIENT_ID=<client_id from step 11>
FRAMEIO_V4_CLIENT_SECRET=<client_secret from step 11>
```

15. Build a token manager in `lib/frameio-auth.js` that:
    - Calls the IMS token endpoint with client credentials
    - Caches the token in memory
    - Re-requests on expiry or 401
    - Returns the Bearer token for v4 API calls

**Verify v4 Access:**

16. Test with:
```bash
curl -H "Authorization: Bearer {ACCESS_TOKEN}" https://api.frame.io/v4/accounts
```

A 200 response with account data confirms v4 is working.

**Webhook migration note:** v4 webhooks use **Adobe I/O Events** (registered in Developer Console → Add Event Registration → Frame.io Events) instead of the v2 `POST /v2/hooks` endpoint. This changes how the QA agent's comment trigger is set up — it will need an Adobe I/O Events subscription rather than a direct Frame.io webhook.

**Key differences between v2 and v4:**

| | v2 (current) | v4 (future) |
|---|---|---|
| Base URL | `https://api.frame.io/v2` | `https://api.frame.io/v4` |
| Auth | `Bearer fio-u-*` developer token | `Bearer eyJ...` Adobe IMS token |
| Token lifetime | Long-lived | 24 hours (re-request via client_credentials) |
| Token source | developer.frame.io | Adobe IMS `ims-na1.adobelogin.com/ims/token/v3` |
| Webhooks | Frame.io native (`POST /v2/hooks`) | Adobe I/O Events |
| Resource model | Teams → Projects → Assets | Orgs → Accounts → Workspaces → Projects → Assets |

**Status:** v2 chosen for now. v4 migration path documented. Requires Scott to verify Adobe org prerequisites (steps 1-3) before we can proceed.

---

### 2026-04-02 | Scripting Agent blocked — student context approach under review

**Decision:** Do not build the Scripting Agent until Scott confirms how student context will be collected and stored. Research and Performance agents proceed as planned.

**Rationale:** The `students` table has a `claude_project_context` field intended to give the Scripting Agent per-student context for script generation. However, this field may have incomplete or placeholder data — the approach for collecting and maintaining student context (manual entry, intake form, interview notes, etc.) has not been finalized with Scott. Building the Scripting Agent against unreliable context data would produce low-quality script output and require rework.

**Blocked on:** Confirmation from Scott on:
1. What data populates `students.claude_project_context` (source and format)
2. Whether the current data is complete enough to generate scripts against
3. Preferred collection method going forward

**Status:** Blocked — awaiting Scott's input. Research Agent and Performance Agent are unblocked and proceed on schedule.

---

### 2026-04-03 | ClickUp status names corrected — lowercase, different names

**Decision:** Update all ClickUp status references across the entire codebase to match the real ClickUp workspace statuses confirmed by Scott.

**Rationale:** The original status names were uppercase guesses (IDEA, READY FOR SHOOTING, READY FOR EDITING, IN EDITING, EDITED, NEEDS REVISIONS, DONE). Scott confirmed the real statuses are lowercase and use different names in some cases. The correct mapping is:

| Old (incorrect) | New (correct) |
|---|---|
| IDEA | idea |
| READY FOR SHOOTING | ready for shooting |
| READY FOR EDITING | ready for editing |
| IN EDITING | in editing |
| EDITED | uploaded to dropbox |
| NEEDS REVISIONS | waiting |
| DONE | done |
| _(new)_ | sent to client |
| _(new)_ | posted by client |

Key semantic changes: "EDITED" is now "uploaded to dropbox" (reflects the actual action), and "NEEDS REVISIONS" is now "waiting" (generic hold state). Two new statuses added: "sent to client" and "posted by client".

**Files updated:** CLAUDE.md, agents/pipeline.js, agents/qa.js, agents/scripting.js, handlers/frameio.js, dashboard/src/components/PipelineView.jsx, dashboard/src/components/QAQueue.jsx, dashboard/src/lib/hooks.js, scripts/test-pipeline-folders.js, scripts/test-qa-agent.js, scripts/test-performance-agent.js, docs/architecture.md, docs/build-order.md, docs/integrations.md, docs/decisions.md.

**Status:** Done.

---

### 2026-04-03 | Editors table seeded for Austin campus

**Decision:** Seed the `editors` table with the two active editors for the Austin campus.

**Rationale:** Scott confirmed the editor roster during the April 3 meeting. The Pipeline Agent's `assignEditor()` function requires editor rows to assign work by lowest active task count. Without seeded editors, the agent logs a warning and skips assignment.

**Editors seeded:**
| Name | ClickUp User ID | Email |
|---|---|---|
| Charles Williams | 95229910 | charles@limitlessyt.com |
| Tipra | 95272148 | arpitv.tip@gmail.com |

Both set to `active = true`, `campus_id` = Austin campus UUID (`0ba4268f-f010-43c5-906c-41509bc9612f`).

**Status:** Done — seed script created at `scripts/seed-editors.js`.
