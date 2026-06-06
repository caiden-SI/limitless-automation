# Student Onboarding Chat — Revision Round 1 Scope

**Source:** client text feedback (June 2026), after a real run-through of the onboarding chat.
**Goal:** make the onboarding chat "good enough to send to the first 3 students" ASAP.

## Where this lives in the codebase

| Concern | File |
|---|---|
| Conversation logic, sections/questions, tone prompt, synthesis | `agents/onboarding.js` |
| HTTP routes (`/onboarding/message`, `/onboarding/student`) | `server.js` (lines ~68–155) |
| Chat UI, progress bar, completion screen | `dashboard/src/pages/Onboarding.jsx` |
| UI styles (progress bar fill, etc.) | `dashboard/src/pages/Onboarding.css` |
| Influencer scraping (Section 3) | `tools/scraper.js` (`scrapeProfileVideos`) |

Key architecture fact that shapes everything below: **all conversation state lives server-side** in the `onboarding_sessions` table (answers, `conversation_history`, `current_question_index`). The client only sends the latest message. There are **42 questions total** across 5 student-facing sections (12 / 6 / 2 / 17 / 5), plus an automated Section 6 industry report.

---

## Item 1 — First name only in the first message ("Hey Jackson")

**Now:** the greeting and all prompts use `studentName`, which is `student.name` (the full name). Greeting in `agents/onboarding.js`: `` `Hey ${studentName}!` ``.

**Fix:** derive a `firstName` (`name.trim().split(/\s+/)[0]`) and use it in the greeting and in `buildSystemPrompt` so Claude addresses the student by first name throughout. Keep full name for the saved context document.

**Files:** `agents/onboarding.js` (greeting + `buildSystemPrompt`).
**Effort:** Trivial (~15 min). **Risk:** none.

---

## Item 2 — Tone is too eager / cheesy (exclamation marks, "wow really cool!")

**Now:** the system prompt (`buildSystemPrompt`) instructs Claude to be "warm, encouraging, and conversational," the hard-coded greeting uses exclamation marks, and the section-transition guidance literally models hype ("Great, that wraps up the business context!"). Nothing tells Claude to limit exclamations or avoid praise words.

**Fix:** rewrite the tone section of the prompt to a measured, peer-to-peer register: at most one exclamation per message (ideally zero), no praise adjectives ("amazing / love it / so cool / wow"), acknowledge briefly and move on. Rewrite the greeting and the transition example to match. Validate by running a full test conversation and reading it back.

**Files:** `agents/onboarding.js` (greeting, `buildSystemPrompt` RULES + transition example).
**Effort:** Low (~30–45 min, mostly prompt-tuning + a read-through). **Risk:** low.

---

## Item 3 — Progress bar should move with every message

**Now:** the bar is computed from the **section number only**:
`Math.round(((section - 1) / 6) * 100 + (1/6)*100*0.5)` in `Onboarding.jsx`. So during Section 4 (17 questions) the bar is frozen for many turns — exactly the "no attention span" problem the client flagged.

**Fix:** the backend already tracks `current_question_index` and knows the total (42). Return per-question progress to the client and drive the bar off it:
- `agents/onboarding.js` — include `progress` (or `questionIndex` + `totalQuestions`) in each return object.
- `server.js` — pass those fields through in the `/onboarding/message` response.
- `Onboarding.jsx` — store progress from the response and compute `progressPct` from question index, not section. Keep the CSS width transition so it animates.

**Related ("it took me more than 20 minutes / too long"):** the real length driver is Item 5. Granular progress makes it *feel* shorter; trimming questions makes it *be* shorter. Do both.

**Files:** `agents/onboarding.js`, `server.js`, `dashboard/src/pages/Onboarding.jsx`.
**Effort:** Medium (~1–1.5 h). **Risk:** low.

---

## Item 4 — "If you give it a link to a post, does it generate the transcript?" + how thorough must answers be?

**This is partly a question, partly a change.** There are two *separate* transcript paths today and they behave differently:

1. **Section 3 `influencers`** (the hit-list question): URLs/handles are parsed and **scraped** via `scrapeProfileVideos`. But it only pulls the profile's recent videos (top 3), **TikTok and Instagram only** — YouTube is explicitly skipped (`no_scrapeable_url`), and it does **not** transcribe a specific post you link.
2. **Section 2 `long_form_transcripts` / `short_form_transcripts`** (the "paste transcripts" questions): whatever the student types is **stored as raw text**. If they paste a *link* here, nothing fetches or transcribes it — the link is just saved as a string.

**So the literal answer to the client:** *No — pasting a link to a post does not generate a transcript. Only the influencer hit-list gets auto-scraped (profile-level, TikTok/IG only). For the transcript questions, students must paste the actual transcript text.*

**On "how thorough do responses have to be":** enforcement is minimal. `isVagueAnswer` only rejects answers under ~10 characters or pure filler ("yes", "idk"), and it probes **once** before accepting anything. So a terse-but-real answer sails through.

**Recommendation (confirm with client — see below):**
- *Now (quick, low risk):* tighten the question copy to set expectations — tell students to paste transcript **text, not links**, and add a one-line note on how detailed answers should be. Optionally strengthen the probe slightly for the highest-value questions (origin story, audience).
- *Later (real feature):* build link → transcript fetching for pasted post URLs (and YouTube caption fetch for the influencer list). This is a meaningful build — new fetch/transcription path, YouTube support, error handling — not a Round-1 item.

> **Scraper reality check (verified):** the existing scrape path depends on a third-party service (**Apify**, using the *free* TikTok actor), not a local headless browser. What it returns is often just captions/alt-text, not a true transcript, and Instagram has no real transcript field at all. Failures are non-fatal (caught and logged as warnings), so onboarding degrades gracefully — but this is best-effort, which is another reason to defer any "transcribe from a link" feature past Round 1.

**Files:** copy changes in `agents/onboarding.js` (`SECTIONS`); probe logic in `isVagueAnswer`. Feature work would touch `tools/scraper.js`.
**Effort:** Copy/probe = Low (~30 min). Link-transcription feature = High (separate ticket).

---

## Item 5 — Audience section feels repetitive ("kept asking what they aspire to, daydream about, etc.")

**Now:** Section 4 (`AUDIENCE CONTEXT`) is **17 questions**: `ideal_customer` plus four categories (motivation, desire, pain, fear) × two pairs each × a separate **What** and **Why** turn. Because the prompt asks the What, waits, then asks the Why as its own message, the student answers ~16 near-identical "...and why?" turns in a row. That's the repetition *and* a big chunk of the 20-minute runtime.

**Fix options:**
- (a) Merge each What+Why into a single turn ("What do they daydream about — and why?"). Cuts ~8 turns, keeps the data.
- (b) Keep only one pair per category (one motivation, one desire, one pain, one fear) instead of two. Cuts further.
- (c) Soften the rigid "ask What first, then Why" rule in `buildSystemPrompt`.

**Recommendation:** do (a) + (b) → roughly **5 questions instead of 17** while preserving the motivation/desire/pain/fear framework. This is the single biggest win for both the "repetitive" and "too long" complaints. **This is a product decision the client owns** (it's his strategy framework), so confirm depth before cutting.

**Files:** `agents/onboarding.js` (`SECTIONS` Section 4, and the What/Why rule in `buildSystemPrompt`).
**Effort:** Low–Medium to implement (~1 h); gated on client's call on how much to trim.

---

## Item 6 — Times out when you step away; no way to pause/resume

**Now:** the good news is the backend **already persists state every turn** (`answers`, `conversation_history`, `current_question_index` in `onboarding_sessions`), so nothing is actually lost server-side. The problem is the **frontend never rehydrates**: on load it starts with an empty message list and sends an empty message, which just returns the greeting again (idempotent) — not the prior conversation or the question they were on. So a student who closes the tab and comes back sees what looks like a restart, and there's no "saved / you can come back" affordance. There is no explicit client-side timeout in the code; the "timeout" is most likely browser/session idle plus this lost-visible-state behavior.

**Fix:** add real resume.
- Backend: return saved state on load — extend `/onboarding/student` (or add `/onboarding/state`) to return `conversation_history`, current `section`, `progress`, and `isComplete`.
- Frontend (`Onboarding.jsx`): on mount, fetch that state and render the prior messages, then continue from the current question instead of re-greeting. Add a small "Your progress is saved — you can close this and come back anytime" line.

**Files:** `server.js`, `agents/onboarding.js` (expose a state getter), `dashboard/src/pages/Onboarding.jsx`.
**Effort:** Medium (~2–3 h). **Risk:** low–medium (resume vs. fresh-greeting branching needs care). **High value** — the client couldn't finish *because* of this.

---

## Decisions for Round 1 (made — no client sign-off needed)

These were originally open questions; we've settled them to keep Round 1 moving. All are reversible.

1. **Transcript-from-link (Item 4):** clarify the copy ("paste transcript text, not a link") and ship. Link→transcript fetching is deferred to a later ticket (the scraper is best-effort Apify anyway — see note above).
2. **Audience section (Item 5) — non-destructive:** keep all four categories AND both pairs (no data removed). Just merge each What/Why into a single question instead of two separate turns. This halves the turn count and removes the repetitive "...and why?" ping-pong without cutting any of the strategy framework. (If the client later wants it even shorter, dropping the second pair per category is a one-line change.)
3. **Answer thoroughness / repetitiveness (Item 4):** keep exactly **one** clarity follow-up per question, then always move on — never multiple. No new or stronger probing logic is added. This is an explicit rule to keep repetitiveness to a minimum.

## Suggested sequencing to get send-ready fast

1. **Same-day quick wins:** Item 1 (first name) + Item 2 (tone). Low risk, immediately improves the felt quality.
2. **Biggest felt improvement:** Item 5 (audience trim) once the client confirms #2 above — fixes both "repetitive" and "too long."
3. **Attention-span + completion:** Item 3 (granular progress) and Item 6 (resume) — the two that stop students bailing.
4. **Item 4:** copy clarification now; link-transcription as a separate later ticket.

Net: items 1, 2, 5, and the copy half of 4 are roughly a day; items 3 and 6 add about another day. That's a realistic "round that's good enough for the first 3 students."
