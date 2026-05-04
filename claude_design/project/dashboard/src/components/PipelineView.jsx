import { useVideos } from '../lib/hooks';

// Statuses stored uppercase in Supabase (via dbStatus() in pipeline agent)
const STATUS_ORDER = [
  'IDEA',
  'READY FOR SHOOTING',
  'READY FOR EDITING',
  'IN EDITING',
  'EDITED',
  'UPLOADED TO DROPBOX',
  'SENT TO CLIENT',
  'REVISED',
  'POSTED BY CLIENT',
  'DONE',
  'WAITING',
];

const STATUS_COLORS = {
  'IDEA': '#6b7280',
  'READY FOR SHOOTING': '#f59e0b',
  'READY FOR EDITING': '#3b82f6',
  'IN EDITING': '#8b5cf6',
  'EDITED': '#06b6d4',
  'UPLOADED TO DROPBOX': '#0891b2',
  'SENT TO CLIENT': '#a855f7',
  'REVISED': '#ec4899',
  'POSTED BY CLIENT': '#f97316',
  'DONE': '#10b981',
  'WAITING': '#ef4444',
};

/** Display-friendly label for a status (lowercase, title-ish). */
const statusLabel = (s) => s.toLowerCase();

export default function PipelineView({ campusId }) {
  const { data: videos, loading, error } = useVideos(campusId);

  if (loading) return <div className="loading">Loading pipeline...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  // Group by status
  const columns = {};
  for (const s of STATUS_ORDER) columns[s] = [];
  for (const v of videos || []) {
    const col = columns[v.status] || (columns['idea']);
    col.push(v);
  }

  return (
    <div className="panel">
      <h2>Pipeline</h2>
      <div className="board">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="board-col">
            <div className="board-col-header" style={{ borderTopColor: STATUS_COLORS[status] }}>
              <span className="board-col-title">{statusLabel(status)}</span>
              <span className="board-col-count">{columns[status].length}</span>
            </div>
            <div className="board-col-body">
              {columns[status].map((v) => (
                <div key={v.id} className="card">
                  <div className="card-title">{v.title}</div>
                  {v.student_name && <div className="card-meta">{v.student_name}</div>}
                  {v.qa_passed === false && <span className="badge badge-fail">QA Failed</span>}
                  {v.qa_passed === true && <span className="badge badge-pass">QA Passed</span>}
                  <div className="card-time">{timeAgo(v.updated_at)}</div>
                </div>
              ))}
              {columns[status].length === 0 && (
                <div className="card-empty">No videos</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
