import { useVideos } from '../lib/hooks';

const STATUS_ORDER = [
  'idea',
  'ready for shooting',
  'ready for editing',
  'in editing',
  'uploaded to dropbox',
  'sent to client',
  'posted by client',
  'done',
  'waiting',
];

const STATUS_COLORS = {
  'idea': '#6b7280',
  'ready for shooting': '#f59e0b',
  'ready for editing': '#3b82f6',
  'in editing': '#8b5cf6',
  'uploaded to dropbox': '#06b6d4',
  'sent to client': '#a855f7',
  'posted by client': '#f97316',
  'done': '#10b981',
  'waiting': '#ef4444',
};

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
              <span className="board-col-title">{status}</span>
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
