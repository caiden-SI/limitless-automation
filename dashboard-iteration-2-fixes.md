# Dashboard Iteration 2 — Polish Fixes

Small punch list of fixes to apply on top of the current dashboard rework.
None of these are blocking — system is healthy, dashboard is mostly accurate.
These tighten remaining false positives and improve readability before
formal Scott handoff.

Target branch: `feature/dashboard-iteration-2`
Single PR, no merge until reviewed.

**Note:** ping_memory macOS false positive shipped in PR #8 ahead of this
iteration.

The AGENTS panel rebuild is a separate effort tracked in
`dashboard-agents-rebuild-spec.md` — it's larger in scope and warrants its
own PR and review cycle.

---

## Fix 1 — Green text for successful pings, red for failed pings

**Problem:** All ping values currently render with the same accent color
regardless of success or failure. Failed rows are highlighted with a red
background block, but the value text itself uses the same color across both
states, requiring a glance comparison to distinguish success from failure.

**Fix:** Tint the value text on activity feed **health rows only** based on
status:
- Success → green (existing `--green` token in `dashboard/src/ops.css`)
- Warning → amber (existing `--amber` token)
- Error → red (existing `--red` token — already used for failed-row text elsewhere)

**Important constraint:** Only tint rows where `agent_name === 'health'`.
Other row types (pipeline `posted_by_client_done`, scripting
`concept_created`, qa events, etc.) should stay neutral — "success" is
implicit there and tinting them adds visual noise without information.

**File:** `dashboard/src/components/LiveEventStream.jsx`. The current row
template (around line 75) is:

```jsx
<div key={l.id} className={`lim-c-log lim-c-log--${l.status || 'success'}`}>
  <span className="lim-c-log-time">{logTime(l.created_at)}</span>
  <span className={`lim-c-log-agent lim-c-log-agent--${l.status || 'success'}`}>
    {AGENT_LABEL[l.agent_name] || l.agent_name}
  </span>
  <span className="lim-c-log-msg">...</span>
</div>
```

Existing CSS already styles the agent badge (`lim-c-log-agent--${status}`)
by status. Extend that to the message text but scope to health agents.
Implementation pattern — add a `data-agent={l.agent_name}` attribute on
the row, then in `dashboard/src/ops.css`:

```css
.lim-c-log[data-agent="health"].lim-c-log--success .lim-c-log-msg { color: var(--green); }
.lim-c-log[data-agent="health"].lim-c-log--warning .lim-c-log-msg { color: var(--amber); }
.lim-c-log[data-agent="health"].lim-c-log--error   .lim-c-log-msg { color: var(--red); }

/* The detail line (.lim-c-log-err) defaults to red — designed for actual
 * error messages. But health-ping puts informational detail there even
 * on success ("disk 2%", "3 processes online"), so without this override
 * a healthy row reads half-green / half-red. Same gating: only health. */
.lim-c-log[data-agent="health"].lim-c-log--success .lim-c-log-err { color: var(--green); }
.lim-c-log[data-agent="health"].lim-c-log--warning .lim-c-log-err { color: var(--amber); }
.lim-c-log[data-agent="health"].lim-c-log--error   .lim-c-log-err { color: var(--red); }
```

Both selector groups must be present. The first colors the action span
(e.g. `ping_disk`); the second colors the detail span (`↳ disk 2%`).
Without the second group, the action goes green but the detail stays
red — visually confusing because the row still looks like a failure.

Non-health rows where `.lim-c-log-err` appears (e.g. a real
`pipeline · error_message` row) must still render red — the
`[data-agent="health"]` gate ensures that.

**Acceptance:** A `ping_disk · disk 2%` row reads as obviously healthy
(green text). A `pipeline · concept_created` row stays neutral. A failing
health row reads red.

---

## Fix 2 — Visual success indicator on activity feed

**Problem:** The current pattern of "red background = failure, no background
= success" works but requires comparison. A small explicit success indicator
(green dot, checkmark) on each activity feed row would make the read instant.

**Fix:** Add a small status indicator to the left of **every** activity
feed row (not health-only). Suggested 6×6px dot or 10×10px checkmark using
existing color tokens. Map:
- success → small green dot (`--green`)
- warning → small amber dot (`--amber`)
- error → keep current red row highlight (already maximally visible);
  also add a small red dot for consistency with the other states

**Scope clarification (intentional asymmetry with Fix 1):**
- Fix 1 = text tint, **health rows only** (since "success" only carries
  meaning for the ping outcomes — every other row's success is implicit)
- Fix 2 = status pip, **every row** (the pip is the universal "this row's
  status was X" indicator that complements the text tint)

**File:** same component as Fix 1 — `dashboard/src/components/LiveEventStream.jsx`.
Inject the pip as the first child of each `.lim-c-log` row.

If implementation is non-trivial, this is the more skippable of the two.
Fix 1 alone gets 80% of the readability win.

**Acceptance:** Each activity row has a leading status indicator. Scanning
the feed at-a-glance shows a vertical column of green dots punctuated by
occasional amber/red, instead of relying on background highlights.

---

## Fix 3 — Activity feed indicator should always show LIVE

**Problem:** The activity feed status indicator in the upper right toggles
between "PAUSED" and "LIVE · 10s" based on hover state. The "PAUSED" label
adds confusion without providing useful information — the feed resumes the
moment the cursor leaves, so the user never sees a meaningfully paused state.

**Reality check (verified May 4 2026):** The `paused` state in
`LiveEventStream.jsx` is set on hover but **only consumed in the label**
— it isn't passed up to the parent or used to gate `useAgentLogs`'s
polling. So today there is no actual pause-on-hover polling behavior; just
a misleading label.

**Fix (chosen scope — smaller, matches reality):** Just remove the label
conditional. There's no real pause behavior to preserve, so don't add one.

**File:** `dashboard/src/components/LiveEventStream.jsx`. The change is
the ternary at roughly line 60–62:

```jsx
// BEFORE
<span className="lim-section-title__right">
  {paused ? 'PAUSED' : 'LIVE · 10s'}
</span>

// AFTER
<span className="lim-section-title__right">
  LIVE · 10s
</span>
```

The `paused` `useState` hook becomes unused — remove the declaration and
the `onMouseEnter` / `onMouseLeave` handlers that set it. They aren't
used anywhere else. (If a future iteration wants to actually pause polling
on hover, that's a separate, larger change involving the parent component
and the `useAgentLogs` hook — out of scope for this fix.)

**Acceptance:** Indicator always reads "LIVE · 10s". The `paused` state
and its hover handlers are removed (unused after the label change).

---

## Fix 4 — Editor capacity shows 0/0 despite real assignments

**Production data (May 4 2026):**

- Charles Williams (`6f81df1e-2f8e-45fe-81e7-00feccdd7924`):
  - FUJI_ALPHA — `status: READY FOR EDITING`, `assignee_id: 6f81df1e...`
  - ALPHA_CORE — `status: READY FOR EDITING`, `assignee_id: 6f81df1e...`
  - RUNNING APP — `status: IDEA`, `assignee_id: 6f81df1e...`
- Tipra (`6d69b0f0-4821-4c95-8222-97a8d49b1d36`):
  - 0 active assignments

Dashboard shows: Charles 0/5, Tipra 0/5.

**Confirmed root cause (verified May 4 2026):** The column name is
correct — `assignee_id` is the right column, used at all four call sites
(`EditorCapacity.jsx:16`, `lib/health.js:271`, `lib/health.js:301`,
`QAQueue.jsx:60`). The string `assigned_editor_id` does not appear
anywhere in the codebase, so that's not the issue.

The actual issue is the status filter:

```js
// dashboard/src/components/EditorCapacity.jsx:16
if (t.assignee_id && t.status === 'IN EDITING') {
  counts[t.assignee_id] = (counts[t.assignee_id] || 0) + 1;
}
```

Charles's three videos are at `READY FOR EDITING` (queued, not started),
so under the current "actively editing only" definition, they correctly
don't count. The dashboard isn't broken — the definition is too narrow.

**Decision (scope of the fix is semantic, not a bug fix):** Broaden the
filter so capacity reflects "assigned work in the editor's queue" rather
than "actively in progress." `IDEA`-with-assignee should NOT count
(pre-pipeline; the editor doesn't actually have it on their plate yet).

**Fix:** Change the filter at TWO call sites to keep them in sync:

```js
// BEFORE
if (t.assignee_id && t.status === 'IN EDITING') { ... }

// AFTER
if (t.assignee_id && (t.status === 'READY FOR EDITING' || t.status === 'IN EDITING')) { ... }
```

1. `dashboard/src/components/EditorCapacity.jsx` line 16 — the user-facing
   capacity counter.
2. `dashboard/src/lib/health.js` line 271 — the action-item generator that
   produces "editor overload" warnings on the dashboard. Same definition
   must apply or the warning fires for a different threshold than what
   the user sees.

(Don't change `lib/health.js:301` or `QAQueue.jsx:60` — those use
`assignee_id` as a join, not as part of a capacity filter.)

**Acceptance:** Charles shows 2/5 with 3 headroom (FUJI_ALPHA + ALPHA_CORE
count; RUNNING APP at IDEA does not). Tipra shows 0/5 with 5 headroom.
The action-item generator's "editor overload" warning fires off the same
definition.

---

## Fix 5 — Remove the "ACTIVE / STUCK / QA" header counter (Ops page only)

**Problem:** The header at the top of the **Ops** dashboard reads "130
ACTIVE · 0 STUCK · 0 QA". The "130" is misleading because 126 of those are
POSTED BY CLIENT (Scott's already-published archive, not in-flight work).
But also, this header is redundant on the Ops page — the 11-cell pipeline
strip immediately below shows every status with its count, which is more
informative than the summary.

**Fix:** Remove the counter from `dashboard/src/components/OpsHeader.jsx`
lines 77–80:

```jsx
// REMOVE this block
<div className="lim-header2__counts">
  <strong>{active}</strong> ACTIVE ·{' '}
  <strong>{stuck}</strong> STUCK ·{' '}
  <strong>{failed}</strong> QA
</div>
```

(Note: the third variable is `failed`, not `qa`, despite the label saying
"QA" — that's just the QA-failed count. Don't get confused if grepping
for "QA".)

Keep the rest of the header (LIMITLESS · AUSTIN · OPS branding, date/time,
LIVE indicator, indicator pill strip).

**Important — do NOT remove from the Pipeline page:** The same
`ACTIVE · STUCK · QA` counter pattern also appears in
`dashboard/src/components/PipelineSummary.jsx:23` and
`dashboard/src/pages/Pipeline.jsx:83`. Those are on the **Pipeline** page,
which is a separate route. The Pipeline page uses this counter as its
primary header navigation (no kanban strip below it on that page), so it's
not redundant there. Leave both untouched.

**Acceptance:** The Ops dashboard header no longer shows the counter.
Pipeline strip below remains unchanged and is the single source of truth
for pipeline state on the Ops page. Pipeline page (`/pipeline` route)
continues to show its counter unchanged.

---

## Fix 6 — Anthropic integration shows "no recent activity" despite constant use

**Problem:** Integrations panel lists Anthropic with "no recent activity"
neutral styling. But Anthropic is foundational — called by research-agent
(daily classifier), qa-agent (per video), scripting-agent (every 15 min
when calendar events exist), performance-agent (weekly), onboarding-agent
(per new student). It's the most-used external dependency in the system.

The dashboard isn't seeing Anthropic activity because no `agent_logs` row
contains the substring `'claude'` in any of `agent_name`, `action`, or
`error_message`. The matching logic in `IntegrationHealth.jsx:21–25` does
a substring search (`haystack.includes(integ.key)`) against the
integration's `key` value (currently `'claude'` per `lib/agents.js:80`).

**Existing wrapper:** `lib/claude.js` already exists and is the single
import point for `ask` / `askJson` across all agents. Modify that file —
do **not** create a new `lib/anthropic.js`.

**Fix — two reasonable approaches:**

**1. Track Anthropic at the call layer (recommended).** In `lib/claude.js`,
inside the `ask` and `askJson` paths, write an `agent_logs` entry around
each completed Anthropic call. Pick ONE of these two parameter conventions
so the substring matcher finds the row:

   - `agent_name: 'claude'`, `action: 'claude_call'` (matches existing
     `INTEGRATIONS` key `'claude'` — no `lib/agents.js` change needed), OR
   - `agent_name: 'anthropic'`, `action: 'anthropic_call'` AND change
     `lib/agents.js:80` from `key: 'claude'` to `key: 'anthropic'` so the
     matcher still finds it.

   Either works; the first is one fewer file to touch. Payload should
   include `{ caller_agent, model, input_tokens, output_tokens,
   duration_ms }` for future cost/usage analytics. The caller agent comes
   from a passed-in context arg (Claude Code can decide whether to
   require it as a parameter or read it from a stack-trace fallback —
   require-as-parameter is cleaner).

**2. Label Anthropic as a foundation dependency (cheaper).** In
`dashboard/src/components/IntegrationHealth.jsx`, special-case the
Anthropic row to render "Foundation dependency · used by research, qa,
scripting, performance, onboarding" instead of going through the
last-seen-event lookup. No backend change needed.

Option 1 is more correct and unblocks future cost/usage analytics. Option
2 is faster but loses observability.

Recommend Option 1 if scope allows; Option 2 if iteration must stay small.

**Acceptance:** Anthropic row reflects actual usage (Option 1) or
correctly labels itself as a foundation dep (Option 2). No more
"no recent activity" lie.

---

## Fix 7 — Dark mode contrast: lift gray text and gray borders to white

**Problem:** Multiple elements are hard to read in dark mode because they
use a gray that was designed for light mode:
- Editor capacity 5-square strip is invisible (squares blend into background)
- SIGNALS section prose (top hook, Do More Of, Avoid lists) is low-contrast
- Various secondary labels and dividers across the dashboard

**Token system reality (verified May 4 2026):** The actual token names are
**not** `--lim-color-text-secondary` / `--lim-color-border-subtle`. The
real tokens are:

- `--ink` — primary text
- `--ink-2` — secondary text
- `--ink-3` — tertiary text (most "low contrast" cases — ~40+ uses in
  `dashboard/src/ops.css`)
- `--rule` — borders / dividers
- `--accent` — accent color
- `--green`, `--amber`, `--red` — status colors
- `--bg` — background

These tokens are **set inline** on the dashboard root element in
`dashboard/src/pages/Ops.jsx` and `dashboard/src/pages/Pipeline.jsx`
(as React inline styles or via the theme system in `lib/theme.js`), NOT
in CSS files. The current dark-mode block at `dashboard/src/index.css:19`
only overrides body `background` and `color` — it does **not** override
the inner tokens, which is why the gray text persists in dark mode.

**Fix:** Add dark-mode equivalents for the gray-family tokens. Two
implementation options:

1. **Augment `:root[data-theme='dark']` in `index.css`** — set
   `--ink-3`, `--rule`, etc. directly as CSS variables on the dark theme
   selector. Requires the inline values in `Ops.jsx` / `Pipeline.jsx` to
   not override these in dark mode (or to be made theme-aware).

2. **Make the inline token block in `Ops.jsx` / `Pipeline.jsx` theme-aware**
   — pick light or dark token values based on the active theme (likely
   readable from `lib/theme.js`). This is cleaner since the tokens are
   already centralized inline.

Approximate target values for dark mode:
- `--ink`     → `#f5f5f2` (already set on body)
- `--ink-2`   → `#dcdcd9` (was something like `#444` in light)
- `--ink-3`   → `#a8a8a4` (was `#888`-ish in light) — most-impactful change
- `--rule`    → `rgba(255,255,255,0.18)` (was `rgba(0,0,0,0.12)` in light)

**Audit path:** find the inline token block in `Ops.jsx` / `Pipeline.jsx`
(search for `--ink:` or `--rule:`); add a dark-mode branch; toggle
`<html data-theme="dark">` to verify the dashboard reads cleanly. Pay
specific attention to the editor capacity pip border (`--rule`) and the
SIGNALS section secondary text (`--ink-3`).

**Acceptance:**
- Editor capacity squares visible in both themes (the off-state pip
  border is no longer invisible against dark background)
- SIGNALS prose readable in both themes (top hook, Do More Of, Avoid)
- All formerly-gray-on-light text reads cleanly on dark
- Light mode unchanged

---

## Fix 8 — (placeholder) future items go here

Add anything else discovered before the Claude Code session.
