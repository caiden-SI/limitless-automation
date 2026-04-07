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

### Student Onboarding Agent

**File:** `agents/onboarding.js`
**Route:** `/onboard` (new page in dashboard)
**Endpoint:** `POST /onboarding/message`

#### Purpose

Replace Scott's existing Google Form intake process with a conversational Claude-powered chat UI. Students access it via a link like `/onboard?student=alex-mathews&campus=austin`. The agent collects all context through natural conversation, synthesizes it into a structured context document, and writes it to the `students` table in Supabase.

#### UI Requirements (`dashboard/src/pages/Onboarding.jsx`)

- Standalone chat page, not inside the main dashboard nav
- Friendly conversational interface, one message at a time
- Progress indicator showing current section (e.g. "Section 2 of 6")
- Text input at the bottom with send button
- Final screen: "Your context is ready" with the full context document displayed and a copy button
- Add `/onboard` route to `dashboard/src/App.jsx`

#### Conversation Sections (in order)

**SECTION 1 — BUSINESS CONTEXT**

Questions to collect:
1. Brand name
2. What stage is your project in? (Idea/Planning · Building/Developing · Testing with users · Live with active users)
3. What does your project do? (explain it like you're telling a friend)
4. What problem does it solve? Why does this matter?
5. Mission statement — who do you serve + what do you do + why do you exist (example: We help teens end toxic relationships so they can focus on education)
6. Vision statement — where do you want to be in 5 years?
7. Product type (physical product, digital product, software, service, course, etc.)
8. Current active users or customers (if applicable)
9. Key features — what are the main features or capabilities?
10. User access and pricing — how do people access it, what does it cost, free trial?
11. Unique value proposition — what makes this different, why should someone choose this?
12. Customer testimonials (up to 3, optional — skip gracefully if none)

**SECTION 2 — PERSONAL BRAND CONTEXT**

Questions to collect:
1. Why did you start this project? What's the personal story or aha moment behind it?
2. What's been your biggest challenge building this?
3. How much existing content do you have in your camera roll? (None / Some / A lot)
4. Describe the kind of existing photo and video you have (selfie/UGC, screen recordings, user testimonials, broll of you working, etc.)
5. Have you done any long-form interviews, keynotes, or podcasts? If yes: ask them to paste up to 3 transcripts
6. Do you have any existing short-form content with proven engagement? If yes: ask them to paste up to 3 transcripts

**SECTION 3 — INDUSTRY AUTHORITY**

Questions to collect:
1. Define your niche: Industry + Specialty + Product type + Audience (example: Self-improvement dating coaching for teens)
2. Who are your 3–5 influencers on your hit list? (provide @ handle and profile link for each)
3. For each influencer provided:
   - Attempt to fetch a transcript automatically using Apify (TikTok scraper for TikTok links, Instagram scraper for IG links)
   - If Apify fetch succeeds, confirm to student and move on
   - If Apify fetch fails, ask student to paste the transcript manually
   - Collect up to 5 influencer transcripts total

**SECTION 4 — AUDIENCE CONTEXT**

Questions to collect:
1. Describe your ideal customer
2. Motivation 1 What: What is the first thing they think about when they wake up? → Motivation 1 Why: Why do they think about that?
3. Motivation 2 What: What gets them through the day? → Motivation 2 Why: Why does that get them through the day?
4. Desire 1 What: What do they daydream about? → Desire 1 Why: Why do they daydream about that?
5. Desire 2 What: What did they wish they had? → Desire 2 Why: Why do they wish they had that?
6. Pain Point 1 What: What is the most annoying thing they deal with daily or weekly? → Pain Point 1 Why: Why is it painful or annoying for them?
7. Pain Point 2 What: What is the most painful experience they have had? (not physical) → Pain Point 2 Why: Why was it painful?
8. Fear 1 What: What is something they hope no one ever finds out about them? → Fear 1 Why: Why do they want to keep that a secret?
9. Fear 2 What: What have they avoided for years? → Fear 2 Why: Why have they avoided it for so long?

**SECTION 5 — CONTENT CREATION CONTEXT**

Questions to collect:
1. What types of content would showcase your project best? (multi-select from: Product demos/tutorials, Behind-the-scenes of building, User testimonials/reactions, My personal story/journey, Educational content in my niche)
2. Who are some content creators you like watching? (style references — accounts or creator names)
3. Are there any topics you completely avoid posting about?

**SECTION 6 — INDUSTRY REPORT (fully automated, no student input needed)**

After collecting the niche definition and influencer list in Section 3, automatically generate an industry report using Claude with web search. Do NOT ask the student to do this manually. Report must cover:
- Why this problem exists in the industry
- Current solutions and their limitations
- Competitive landscape
- Growth trends and market opportunity

Generate this in the background and include in the final output.

#### Conversation Behavior Rules

- Ask one question at a time, never dump multiple questions at once
- For What/Why pairs, ask the What first, wait for response, then ask Why
- If a student gives a vague or one-word answer, probe once with a follow-up (example: "Can you tell me a bit more about that?")
- Be warm, encouraging, and conversational — not clinical or form-like
- Skip optional fields gracefully if student says they don't have it (testimonials, long-form transcripts, proven short-form content)
- Never repeat a question that was already answered
- Keep Claude's messages concise — one idea per message

#### Output Format — Context Document

When all sections are complete, synthesize everything into a structured context document using exactly these 8 sections:

**1. STUDENT & BRAND IDENTITY** — Student name, brand name, project stage, social presence (handles and platforms), total following

**2. BUSINESS OVERVIEW** — Product type, what it does (2–3 plain language sentences), project stage, current users/customers, key features, user access and pricing

**3. PROBLEM & SOLUTION FRAMEWORK** — Problem being solved, mission statement, vision statement, unique value proposition

**4. AUDIENCE DEEP DIVE** — Ideal customer description, all motivations with Why, all desires with Why, all pain points with Why, all fears with Why

**5. FOUNDER STORY & PERSONAL BRAND** — Origin story (exact words from student), biggest challenge, personal brand positioning analysis

**6. INDUSTRY AUTHORITY & NICHE** — Defined niche, top influencers list with handles and links, influencer content analysis from transcripts, industry report from Section 6 automated research

**7. CONTENT CREATION CONTEXT** — Preferred content pillars, content creator references, topics to avoid, existing content inventory (long-form yes/no, short-form yes/no), available assets (quantity and types), proven short-form scripts if provided, customer testimonials if provided

**8. CONTENT STRATEGY IMPLICATIONS (Claude synthesis)** — On-camera comfort assessment based on their answers, optimal content approach (2–3 sentences), key storytelling angles (2–3 most compelling narratives), production constraints and opportunities, priority content pillars ranked 1–5 for their situation

#### Database Writes (on conversation complete)

Write to Supabase `students` table:
- `claude_project_context`: full structured context document (markdown)
- `onboarding_completed_at`: current timestamp
- `handle_tiktok`: extracted if mentioned during conversation
- `handle_instagram`: extracted if mentioned during conversation
- `handle_youtube`: extracted if mentioned during conversation

Log to `agent_logs`:
- event: `onboarding_complete`
- `campus_id`: from URL param
- `student_id`: from URL param or students table lookup

#### Ready-to-Paste Claude Project Doc

On the final screen, display the context document with a prominent copy button labeled "Copy Claude Project Context".

This is the workaround for the Claude Projects API limitation — the API is not publicly available so project creation cannot be automated. Scott copies this text and pastes it manually when creating a Claude Project for each student.

Add a note on the final screen: "To create this student's Claude Project: go to claude.ai/projects, create a new project, and paste this context into the project instructions field."

#### Technical Notes

- Reference `agents/pipeline.js` for Supabase write patterns
- Reference `lib/dropbox.js` for Apify usage patterns
- The endpoint takes: `{ studentId, campusId, message, conversationHistory }`
- The endpoint returns: `{ reply, isComplete, contextDocument }`
- `conversationHistory` must be passed in full on every request (Claude has no memory between API calls)
- Use `claude-sonnet-4-20250514` for the conversation
- Use streaming if possible for better UX

#### Build Tasks

- [ ] Add `students` table columns if missing: `claude_project_context`, `onboarding_completed_at`, `handle_tiktok`, `handle_instagram`, `handle_youtube`
- [ ] Build `agents/onboarding.js` — conversation state machine + Claude calls
- [ ] Build `POST /onboarding/message` endpoint in `server.js`
- [ ] Build `dashboard/src/pages/Onboarding.jsx` — chat UI with progress indicator
- [ ] Add `/onboard` route to `dashboard/src/App.jsx`
- [ ] Implement Section 3 Apify transcript fetching (reuse `tools/scraper.js`)
- [ ] Implement Section 6 automated industry report generation
- [ ] Implement context document synthesis (8-section output)
- [ ] Implement Supabase writes on completion
- [ ] Implement copy-to-clipboard on final screen
- [ ] End-to-end test: full conversation → context document → Supabase write

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
