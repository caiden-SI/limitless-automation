import { useEditors, useEditorCounts } from '../lib/hooks';

export default function EditorCapacity({ campusId }) {
  const { data: editors, loading: ld1, error: e1 } = useEditors(campusId);
  const { data: activeTasks, loading: ld2, error: e2 } = useEditorCounts(campusId);

  if (ld1 || ld2) return <div className="loading">Loading editors...</div>;
  if (e1 || e2) return <div className="error">Error: {e1 || e2}</div>;

  // Count active tasks per editor
  const counts = {};
  for (const task of activeTasks || []) {
    if (task.assignee_id) {
      counts[task.assignee_id] = (counts[task.assignee_id] || 0) + 1;
    }
  }

  const editorList = (editors || []).map((ed) => ({
    ...ed,
    activeCount: counts[ed.id] || 0,
  })).sort((a, b) => a.activeCount - b.activeCount);

  return (
    <div className="panel">
      <h2>Editor Capacity</h2>
      {editorList.length === 0 && <div className="card-empty">No active editors</div>}
      <div className="editor-grid">
        {editorList.map((ed) => (
          <div key={ed.id} className="editor-card">
            <div className="editor-name">{ed.name}</div>
            <div className={`editor-count ${ed.activeCount >= 3 ? 'editor-count--high' : ''}`}>
              {ed.activeCount}
            </div>
            <div className="editor-label">active {ed.activeCount === 1 ? 'task' : 'tasks'}</div>
            <div className="capacity-bar">
              <div
                className="capacity-fill"
                style={{
                  width: `${Math.min(100, (ed.activeCount / 5) * 100)}%`,
                  backgroundColor: ed.activeCount >= 4 ? '#ef4444' : ed.activeCount >= 2 ? '#f59e0b' : '#10b981',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
