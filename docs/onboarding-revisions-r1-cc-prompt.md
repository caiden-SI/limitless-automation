# Claude Code session prompt — Onboarding chat Revision Round 1

Paste everything below the line into a Claude Code session opened in the repo root. All product decisions are already made and baked in below — the only check-in is a tone read-back after Phase 1.

---

We're revising the **student onboarding chat** based on client feedback. Read `docs/onboarding-revisions-r1-scope.md` first — it maps every change to files. The relevant code is `agents/onboarding.js` (conversation logic, sections, tone prompt), `server.js` (the `/onboarding/*` routes ~lines 68–155), and `dashboard/src/pages/Onboarding.jsx` (+ `.css`). All conversation state is server-side in the `onboarding_sessions` table; the client only sends the latest message. Honor `CLAUDE.md` conventions (model pinning, `campus_id` everywhere, agents communicate only through Supabase, log errors to `agent_logs`).

**Before writing code:** first create and switch to a new git branch for this work (e.g. `onboarding-revisions-r1`) and do all work there — do not commit to the main branch. Then confirm my reading of the current behavior by inspecting the source, and flag anything in the scope doc that's inaccurate. Then implement in this order, committing after each phase with a clear message so the diffs are easy to review and revert.

**Phase 1 — quick wins (do these, then STOP and show me a full sample conversation so I can read the tone before you continue):**
1. **First name only.** Derive `firstName` from `student.name` and use it in the greeting and in `buildSystemPrompt` so Claude addresses the student by first name. Keep full name in the saved context document.
2. **Tone.** Rewrite the tone rules in `buildSystemPrompt`, the hard-coded greeting, and the section-transition example to a measured peer register: at most one exclamation per message (prefer zero), no praise adjectives ("amazing/love it/so cool/wow"), brief acknowledgement then move on.

**Phase 2 — after I approve the tone, run straight through (no further check-ins needed):**
3. **Granular progress bar.** Backend already tracks `current_question_index` and total (42 questions). Return per-question progress from `agents/onboarding.js`, pass it through `server.js`, and drive the bar in `Onboarding.jsx` off question index instead of section number. Keep the CSS width transition so it animates.
4. **Reduce audience-section repetitiveness (Section 4) — NON-DESTRUCTIVE.** Do NOT delete any categories or data points. Keep all four categories (motivation, desire, pain, fear) and both pairs each. The fix is to stop asking the "what" and "why" as two separate turns — merge each into a single question (e.g. "What do they daydream about, and why?"). Update the What/Why rule in `buildSystemPrompt` so it no longer instructs asking the What first and the Why as a separate follow-up. This roughly halves the turn count and kills the repetitive "...and why?" ping-pong while preserving every data point.
5. **One clarity follow-up maximum, then always move on.** The single-probe-per-question behavior (`isVagueAnswer` + the `probed_current` flag) must stay capped at exactly one follow-up per question — never multiple. Do not add any new or stronger probing logic. If anything currently allows more than one follow-up on a question, fix it so it's strictly one then advance. This is to keep repetitiveness to an absolute minimum.
6. **Resume / pause.** State is already persisted per turn but the frontend never rehydrates. Add a state getter (extend `/onboarding/student` or add `/onboarding/state`) returning `conversation_history`, current `section`, `progress`, and `isComplete`; have `Onboarding.jsx` load it on mount, render prior messages, and continue from the current question instead of re-greeting. Add a small "your progress is saved, you can come back anytime" note.
7. **Transcript copy (Item 4).** Update the Section 2 transcript question copy to tell students to paste the transcript **text, not a link**, and add a brief note on how detailed answers should be. Do **NOT** build link→transcript fetching — that's a separate later ticket.

**Constraints & verification:**
- Don't change the synthesis/output document structure or the Supabase write contract.
- After Phase 1, run a full end-to-end test conversation (seed/reset scripts exist in `scripts/` — e.g. `reset-onboarding.js`, `seed-test-student.js`) and paste the transcript so I can read the tone and flow. After Phase 2, run another full test conversation end-to-end and paste it.
- Keep changes minimal and reviewable; show me a diff per phase.
