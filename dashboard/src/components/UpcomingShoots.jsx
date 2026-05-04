// Upcoming shoots — section is in the design source (PortraitShoots) but
// no Supabase backing exists yet. The Scripting agent that would populate
// it is a stub per docs/architecture.md, and `processed_calendar_events`
// hasn't been built. We render the section frame with the empty-state copy
// the brief specifies, so the layout matches the design without faking
// data. Wire to a real RPC once the Scripting agent + a calendar table
// land — at that point this component should accept `shoots` from a hook
// and render rows in `.lim-cpv-shoot` style.

export default function UpcomingShoots() {
  return (
    <section aria-label="Upcoming shoots">
      <div className="lim-section-title">
        <h3>UPCOMING SHOOTS</h3>
        <span className="lim-section-title__right">SCRIPTING AGENT · STUB</span>
      </div>
      <div className="lim-cpv-empty-row" style={{ lineHeight: 1.55 }}>
        Scheduled filming events surface here once the Scripting agent
        ships. It watches Google Calendar every 15 min and stages 3
        concept scripts per event — currently a stub
        (<code style={{ fontFamily: 'inherit' }}>agents/scripting.js</code>),
        unblocked by Onboarding's context document but not yet implemented.
      </div>
    </section>
  );
}
