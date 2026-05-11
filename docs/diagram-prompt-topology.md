# Claude Design Prompt — System Topology Diagram

Upload `system-facts.md` alongside this prompt as context.

---

## Prompt

I need a single-page **system topology diagram** for an automation
platform called Limitless Automation. The diagram will live on the
first page of an operations handbook for a non-engineer ops manager
named Scott. He is not a developer — he runs the production side of a
content agency. The diagram has to make him feel oriented in 30
seconds.

The system has 9 agents, 7 integrations, and a Supabase database that
acts as the spine. The full structured facts (every agent's trigger,
cadence, reads, writes, and the 8 key directional data flows) are in
the attached `system-facts.md` file. Use that as the source of truth.

This is the **topology** view, not the data flow view. Where a
data-flow diagram emphasizes "what happens when X fires," a topology
diagram emphasizes "what components exist and how they're wired
together." Think architecture diagram, not sequence diagram.

### What the diagram needs to show

1. **Three layers, stacked vertically:**
   - *Top layer*: external integrations the system reads from or
     writes to (ClickUp, Dropbox, Frame.io, Fireflies, Google
     Calendar). These are the team-facing surfaces.
   - *Middle layer*: the 9 agents. These are the system's working
     processes. Group them visually if it helps — for example, the
     production-flow agents (Pipeline, Footage-scan, QA) cluster
     together, the intelligence agents (Research, Performance,
     Scripting) cluster together, the support agents (Onboarding,
     Fireflies, Profile-views) cluster together.
   - *Bottom layer*: the data and intelligence backbone — Supabase
     (database) and Anthropic (LLM). Both span the full width
     because every agent connects to them.
2. **Connections (lines, not arrows)** between layers showing which
   agent talks to which integration. No directionality — this is
   topology, not flow. A line means "these two components are
   wired together."
3. **Cadence badges** on each agent — small chips showing how it
   fires (e.g. "webhook," "every 15 min," "daily 6 AM," "Mon 7 AM").
4. **Connection density** should reveal the design at a glance:
   Pipeline has many connections (it's the spine of production),
   Onboarding has few. The eye should be able to spot which agents
   are the high-traffic hubs.

### Visual style

- **Landscape orientation**, designed to embed cleanly in a PDF
  alongside body text.
- **Color coding by layer**: integrations one color, agents another,
  data backbone a third. Pick a calm, professional palette — no
  neon, no cartoonish gradients.
- **Avoid red/green-only distinctions** for accessibility.
- **Use dashed lines** for the planned-but-incomplete connections
  flagged in the facts doc's "Notes & known gaps" section. Don't
  hide the gaps — show them.
- **Title**: *Limitless Automation — System Topology*
- **Subtitle**: short tagline indicating "the components and how
  they're wired together."
- **Legend**: small, in a corner — explain the color coding, the
  cadence-badge convention, and what dashed lines mean.

### What the diagram should NOT do

- Don't show data flow direction. That's the other diagram's job.
- Don't try to fit every Supabase table or every Anthropic prompt
  on the diagram. Each is one node.
- Don't use technical jargon that a non-engineer wouldn't recognize.
- Don't make it busy. If a connection doesn't earn its place
  visually, cut it. Density should be informative, not noisy.

### Audience reminder

Scott opens the dashboard every morning, skims it, marks videos
"posted by client" in ClickUp when they ship, and texts Caiden if
something's red. He doesn't need to know how the QA agent's loudness
check works — he needs to know that QA exists, that it sits between
ClickUp and Frame.io, and that it writes back into ClickUp.

The topology diagram is teaching him the *anatomy* of the system —
where the parts live, how they're connected — so that when something
breaks, he can locate it on the map.
