import { useAgentLogs } from '../lib/hooks';

const AGENT_COLORS = {
  pipeline: '#3b82f6',
  qa: '#06b6d4',
  research: '#8b5cf6',
  performance: '#f59e0b',
  scripting: '#10b981',
  scheduler: '#6b7280',
  server: '#374151',
};

export default function AgentActivityFeed({ campusId }) {
  const { data: logs, loading, error } = useAgentLogs(campusId);

  if (loading) return <div className="loading">Loading activity...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="panel">
      <h2>Agent Activity</h2>
      <div className="feed">
        {(logs || []).length === 0 && <div className="card-empty">No recent activity</div>}
        {(logs || []).map((entry) => (
          <div key={entry.id} className={`feed-item feed-item--${entry.status || 'success'}`}>
            <span
              className="agent-badge"
              style={{ backgroundColor: AGENT_COLORS[entry.agent_name] || '#6b7280' }}
            >
              {entry.agent_name}
            </span>
            <span className="feed-action">{entry.action}</span>
            {entry.status === 'error' && (
              <span className="badge badge-fail">{entry.error_message?.slice(0, 80)}</span>
            )}
            <span className="feed-time">{formatTime(entry.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
