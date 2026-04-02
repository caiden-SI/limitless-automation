# Limitless Media Agency — Automation System

## Stack
Node.js + Express.js webhook server | Supabase (Postgres) | Claude claude-sonnet-4-20250514 via Anthropic API | PM2 | Mac Mini

## Build Order
Foundation (schema → webhook server → PM2) → Agents (pipeline → QA → research → performance → scripting) → Dashboard (React localhost)

## Rules
- Every table has `campus_id` — multi-client from day one
- Agents communicate through Supabase only — never call each other directly
- Agent writes to table → webhook/scheduler detects change → next agent reads
- All credentials in `.env`, sourced from 1Password vault "Limitless - Caiden"
- ClickUp status names are case-sensitive: IDEA, READY FOR SHOOTING, READY FOR EDITING, IN EDITING, EDITED, NEEDS REVISIONS, DONE
- Dropbox: 1-hour delay after footage upload before triggering editing pipeline
- Service role key for agent calls (bypasses RLS), anon key for dashboard
- All agents use `claude-sonnet-4-20250514` — no other model

## Error Handling
1. Log full error to `agent_logs` with status "error" BEFORE attempting recovery
2. Send error to Claude API for diagnosis
3. If Claude recommends fix → auto-fix and retry ONCE
4. If retry fails → post to ClickUp task comments + alert
5. PM2 handles process-level crashes with auto-restart

## WAT Framework
- `workflows/` — markdown SOPs defining objectives, inputs, tools, outputs, edge cases
- `agents/` — orchestration and decision-making (Claude API calls)
- `tools/` — deterministic Python/Node scripts for execution
- Check `tools/` before building anything new

## Gotchas
- `videos` table has no `qa_passed` column — agents.md references it but schema.md omits it. Add as `boolean default null` before QA agent build.
- Frame.io v4 API — verify comment webhook behavior before building QA trigger (Adobe acquisition may have changed things)
- Scott's existing `fireflies_sync.py` runs at 9PM nightly — do not replace, integrate alongside
- Dropbox desktop sync is live for the team — do not interfere with existing sync
- ClickUp List ID for Austin campus needs confirmation from Scott
- Custom field ID for Frame.io link in ClickUp must be retrieved via API on first run
- Google Calendar event format (title/description containing student name) needs confirmation from Scott
