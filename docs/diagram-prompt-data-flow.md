# Claude Design Prompt — Data Flow Diagram

Upload `system-facts.md` alongside this prompt as context.

---

## Prompt

I need a single-page **system data flow diagram** for an automation
platform called Limitless Automation. The diagram will live on the
first page of an operations handbook for a non-engineer ops manager
named Scott. He is not a developer — he runs the production side of a
content agency. The diagram has to make him feel oriented in 30
seconds.

The system has 9 agents, 7 integrations, and a Supabase database that
acts as the spine. The full structured facts (every agent's trigger,
cadence, reads, writes, and the 8 key directional data flows) are in
the attached `system-facts.md` file. Use that as the source of truth.

### What the diagram needs to show

1. **All 9 agents** as distinct nodes, grouped or arranged so their
   relationships are visible at a glance.
2. **All 7 integrations** as distinct nodes, ideally laid out as a
   "ring" or "rail" around the agents to show that integrations are
   the system's interface to the outside world.
3. **Supabase as the spine** — visually central, with read/write
   arrows from every agent.
4. **Anthropic as the brain** — visually distinct, with arrows from
   every agent that uses it for AI judgment (Research, Scripting, QA,
   Fireflies, Performance, Onboarding).
5. **Trigger labels on arrows** — when an agent is triggered by a
   cron, the arrow into that agent should be labeled with the cadence
   (e.g. "every 15 min", "daily 6 AM", "Mon 7 AM"). When an agent is
   triggered by a webhook or status change, label the arrow with the
   trigger source (e.g. "ClickUp status: edited" → QA agent).
6. **The 8 key data flows from the facts doc** must all be visually
   traceable. Someone reading the diagram should be able to follow
   "footage uploaded to Dropbox" all the way to "ClickUp status
   advances to ready for editing" without losing the thread.

### Visual style

- **Landscape orientation**, designed to embed cleanly in a PDF
  alongside body text.
- **Color coding by layer**: integrations one color, agents another,
  data spine (Supabase + Anthropic) a third. Pick a calm,
  professional palette — no neon, no cartoonish gradients.
- **Avoid red/green-only distinctions** for accessibility.
- **Use dashed lines** for the planned-but-incomplete connections
  flagged in the facts doc's "Notes & known gaps" section. Don't
  hide the gaps — show them.
- **Title**: *Limitless Automation — System Data Flow*
- **Subtitle**: short tagline indicating "what triggers what, and
  where the data goes."
- **Legend**: small, in a corner — explain the color coding, the
  arrow types, and what dashed lines mean.

### What the diagram should NOT do

- Don't show implementation details (Postgres tables, function names,
  API endpoints).
- Don't try to fit every column of every Supabase table on the
  diagram. Supabase is one node. Anthropic is one node.
- Don't use technical jargon that a non-engineer wouldn't recognize.
  Where you have to use a technical term (webhook, cron), put it on
  an arrow as a label, not as standalone copy.
- Don't make it busy. If something doesn't earn its place visually,
  cut it.

### Audience reminder

Scott opens the dashboard every morning, skims it, marks videos
"posted by client" in ClickUp when they ship, and texts Caiden if
something's red. He doesn't need to know how the QA agent's loudness
check works — he needs to know that QA exists, runs after editing,
and writes back into ClickUp.

The diagram is teaching him the *shape* of the system, not its
internals.
