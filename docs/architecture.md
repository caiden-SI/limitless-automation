# Architecture — Limitless Media Agency Automation

## System Overview

Five-layer architecture automating a video production pipeline for Alpha School student content.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Layer 5: Dashboard                       │
│              React app (localhost) — Scott's interface           │
│    Pipeline view | Agent activity | QA queue | Performance      │
├─────────────────────────────────────────────────────────────────┤
│                      Layer 4: OpenClaw                          │
│         Master orchestrator + conversational interface           │
├─────────────────────────────────────────────────────────────────┤
│                      Layer 3: Agent Team                        │
│  Pipeline | QA | Research | Performance Analysis | Scripting    │
│         All agents call claude-sonnet-4-20250514                │
├─────────────────────────────────────────────────────────────────┤
│                      Layer 2: Database                          │
│              Supabase (Postgres) — shared brain                 │
│           campus_id on every table, RLS enabled                 │
├─────────────────────────────────────────────────────────────────┤
│                    Layer 1: Integrations                        │
│  Express.js webhook server (PM2-managed) on Mac Mini            │
│  Inbound: ClickUp, Dropbox, Frame.io webhooks                  │
│  Outbound: ClickUp API, Dropbox API, Frame.io API, Claude API  │
└─────────────────────────────────────────────────────────────────┘
```

## Agent Communication Pattern

Agents never call each other. They communicate through Supabase:

```
Agent A writes to table → Webhook/scheduler detects change → Agent B reads updated data
```

If one agent fails, others continue independently.

## Webhook Server

Express.js on port 3000, managed by PM2 with auto-restart.

| Route                    | Source   | Handler              |
|--------------------------|----------|----------------------|
| POST /webhooks/clickup   | ClickUp  | handlers/clickup.js  |
| POST /webhooks/dropbox   | Dropbox  | handlers/dropbox.js  |
| POST /webhooks/frameio   | Frame.io | handlers/frameio.js  |

All webhooks verify signatures before processing.

## Agents

| Agent              | Type          | Trigger                                  | Key Action                                      |
|--------------------|---------------|------------------------------------------|--------------------------------------------------|
| Pipeline Agent     | Automation    | ClickUp/Dropbox webhooks                 | Status changes, folder creation, editor assignment |
| QA Agent           | LLM-powered   | Status → EDITED                          | Caption check, LUFS check, stutter detection      |
| Research Agent     | LLM + scraper | Daily/weekly cron                        | Scrape trending content, classify, store           |
| Performance Agent  | LLM-powered   | Weekly (Monday AM)                       | Pattern analysis on view data + transcripts        |
| Scripting Agent    | LLM-powered   | Google Calendar (student filming event)  | Generate 3 concepts per student                    |

## Data Flow

### Pre-Production
1. Research Agent populates `research_library` (scheduled)
2. Performance Agent populates `performance_signals` (weekly)
3. Google Calendar fires → Scripting Agent reads student context + signals + research → creates ClickUp tasks in IDEA status
4. Scott reviews, eliminates concepts [MANUAL]
5. Status → READY FOR SHOOTING [MANUAL] → Pipeline Agent creates Dropbox folders

### Production
6. Filming + Dropbox upload [MANUAL]
7. Pipeline Agent detects files in Dropbox → status → READY FOR EDITING
8. Pipeline Agent assigns editor by lowest active task count

### Post-Production (Phase 1: QA + Delivery only)
9. Editor completes work, sets status → EDITED [MANUAL]
10. QA Agent runs checks (captions, LUFS, stutter)
11. Pass → Pipeline Agent uploads to Frame.io, updates ClickUp
12. Fail → QA Agent posts issues to ClickUp comments
13. Frame.io comments > 0 → Pipeline Agent sets NEEDS REVISIONS
14. Scott approves → DONE [MANUAL] → Pipeline Agent creates share link

## Infrastructure

- **Runtime:** Mac Mini (always-on)
- **Process management:** PM2 with ecosystem.config.js
- **Self-healing:** Unhandled errors → Claude API diagnosis → auto-fix attempt → fallback to alert
- **Credentials:** 1Password vault "Limitless - Caiden", loaded via .env

## Out of Scope (Phase 2)
- Premiere Pro agent (project creation, footage ingestion, timeline assembly, base editing, color transform, transcription)
- Music recommendation automation
