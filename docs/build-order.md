# Build Order — Limitless Media Agency Automation

Target delivery: April 25, 2026

---

## Week 1–2: Foundation

### Database
- [ ] Create Supabase project under scott@limitlessyt.com org
- [ ] Run initial schema migration (all tables from schema.md)
- [ ] Add `qa_passed boolean default null` to `videos` table (missing from schema, required by QA agent)
- [ ] Create indexes (videos.campus_id, videos.status, videos.clickup_task_id, performance.video_id+week_of, research_library.campus_id+platform, agent_logs.campus_id+agent_name+created_at)
- [ ] Enable RLS on all tables
- [ ] Seed `brand_dictionary` with initial entries (Alpha, Superbuilders, Timeback, Alpha School)
- [ ] Seed `campuses` with Austin campus record
- [ ] Verify service role key and anon key access patterns

### Webhook Server
- [ ] Initialize Node.js project with dependencies
- [ ] Build Express.js server (server.js) with health check endpoint
- [ ] Implement ClickUp webhook handler with signature verification
- [ ] Implement Dropbox webhook handler with challenge verification
- [ ] Implement Frame.io webhook handler with signature verification
- [ ] Set up PM2 ecosystem.config.js
- [ ] Test PM2 auto-restart behavior
- [ ] Configure .env with all credentials from 1Password

### Integration Verification
- [ ] Verify ClickUp API access — test GET /task/{task_id}
- [ ] Verify Dropbox API access — test POST /files/list_folder
- [ ] Verify Frame.io API access — test GET /assets
- [ ] Retrieve ClickUp custom field ID for Frame.io link (API call)
- [ ] Confirm ClickUp List ID for Austin campus with Scott
- [ ] Accept Frame.io invite to "Scott's Account" team
- [ ] Verify Fireflies API access
- [ ] Set up Google Calendar service account + share calendar
- [ ] Confirm Google Calendar event format with Scott (what does a filming event look like?)
- [ ] Review Scott's existing `fireflies_sync.py` before building Fireflies integration

---

## Week 2–3: Agents

### Pipeline Agent
- [ ] Implement Dropbox folder creation (trigger: status → ready for shooting)
- [ ] Implement Dropbox file detection (trigger: file count 0 → >0, with 1-hour delay)
- [ ] Implement status change ready for shooting → ready for editing
- [ ] Implement editor assignment by lowest active task count
- [ ] Implement Frame.io share link creation (trigger: status → done)
- [ ] Implement ClickUp custom field update with Frame.io link
- [ ] Write all actions to `videos` table and `agent_logs`
- [ ] End-to-end test: create task → folder → simulate upload → verify status flow

### QA Agent
- [ ] Implement SRT caption retrieval from Dropbox
- [ ] Implement brand dictionary spell check against `brand_dictionary` table
- [ ] Implement punctuation and formatting consistency check
- [ ] Implement FFmpeg LUFS analysis (targets: -14 LUFS for TikTok/Instagram/YouTube)
- [ ] Implement stutter/filler word detection with timecodes
- [ ] Implement QA pass flow → trigger Pipeline Agent upload to Frame.io
- [ ] Implement QA fail flow → post report to ClickUp task comments
- [ ] Write qa_passed to `videos` table
- [ ] Test with sample video + SRT file

### Research Agent
- [ ] Set up Apify or Playwright scraping for TikTok/Instagram
- [ ] Implement transcript extraction (Apify transcript tool or Whisper)
- [ ] Implement Claude classification (hook_type, format, topic_tags)
- [ ] Implement deduplication against existing `research_library` entries
- [ ] Set up cron schedule (daily or weekly — confirm with Scott)
- [ ] Test with sample niche query

### Performance Analysis Agent
- [ ] Implement query for last 4 weeks of `performance` data
- [ ] Implement transcript retrieval for top/bottom performing videos
- [ ] Implement research_library retrieval for benchmarks
- [ ] Implement Claude pattern analysis prompt
- [ ] Write structured signals to `performance_signals`
- [ ] Set up Monday morning cron schedule
- [ ] Test with synthetic data (note: meaningful output requires ~50+ videos)

### Scripting Agent
- [ ] Implement Google Calendar polling/webhook for filming events
- [ ] Implement student context retrieval from `students` table
- [ ] Implement performance signals retrieval
- [ ] Implement research library retrieval
- [ ] Implement Claude script generation (3 concepts per student)
- [ ] Implement ClickUp task creation in "idea" status
- [ ] Write drafts to `videos` table
- [ ] Test with sample student profile

---

## Week 3–4: Deployment

### Self-Healing & Error Handling
- [ ] Implement global error handler with Claude diagnosis
- [ ] Implement auto-fix + single retry pattern
- [ ] Implement fallback alert to ClickUp comments
- [ ] Verify PM2 crash recovery behavior
- [ ] Stress test webhook server with concurrent requests

### OpenClaw
- [ ] Deploy OpenClaw orchestrator on Mac Mini
- [ ] Configure agent coordination
- [ ] Test conversational interface with Scott

### Dashboard
- [ ] Set up React app (localhost)
- [ ] Build pipeline view (video status board)
- [ ] Build agent activity feed (from agent_logs)
- [ ] Build QA queue view
- [ ] Build editor capacity view
- [ ] Build performance signals feed
- [ ] Connect to Supabase with anon key (scoped to campus)

### Full System Test
- [ ] End-to-end test: calendar event → script generation → ClickUp task → folder creation → simulate footage → QA → Frame.io → delivery
- [ ] Verify multi-campus isolation (campus_id scoping)
- [ ] Verify error handling and recovery paths
- [ ] Review with Scott — walkthrough of full pipeline
- [ ] Handoff: transfer GitHub repo to Limitless per SOW Section 3
