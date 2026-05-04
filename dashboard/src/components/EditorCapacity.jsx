// Editor capacity — ported from PortraitEditors. Big numeral + /5 denom +
// 5-pip headroom indicator. Overloaded editors get red spine + red pip
// fill. Empty state per design brief.

import { useEditors, useEditorCounts } from '../lib/hooks';

export default function EditorCapacity({ campusId }) {
  const { data: editors, loading: ld1, error: e1 } = useEditors(campusId);
  const { data: tasks,   loading: ld2, error: e2 } = useEditorCounts(campusId);

  if (ld1 || ld2) return <section><div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading editors…</div></section>;
  if (e1 || e2)   return <section><div style={{ color: 'var(--red)',   fontSize: 12 }}>Error: {e1 || e2}</div></section>;

  const counts = {};
  for (const t of tasks || []) {
    if (t.assignee_id && t.status === 'IN EDITING') {
      counts[t.assignee_id] = (counts[t.assignee_id] || 0) + 1;
    }
  }

  const list = (editors || [])
    .map((e) => ({ ...e, active: counts[e.id] || 0 }))
    .sort((a, b) => b.active - a.active);

  return (
    <section id="editor-capacity" aria-label="Editor capacity">
      <div className="lim-section-title">
        <h3>EDITOR CAPACITY</h3>
        <span className="lim-section-title__right">TARGET ≤5</span>
      </div>

      {list.length === 0 ? (
        <div className="lim-cpv-empty-row">No active editors.</div>
      ) : (
        <div className="lim-cpv-editors">
          {list.map((ed) => {
            const over = ed.active >= 5;
            return (
              <button key={ed.id} type="button" className={`lim-cpv-editor ${over ? 'is-over' : ''}`}>
                <div className="lim-cpv-editor-name">{ed.name}</div>
                <div className="lim-cpv-editor-row">
                  <span className="lim-cpv-editor-num">{ed.active}</span>
                  <span className="lim-cpv-editor-denom">/5</span>
                  <div className="lim-cpv-editor-pips">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={`lim-cpv-editor-pip ${i < ed.active ? 'is-on' : ''} ${over && i < ed.active ? 'is-over' : ''}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="lim-cpv-editor-state">
                  {over ? 'OVERLOADED' : `${5 - ed.active} HEADROOM`}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
