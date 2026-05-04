import { usePerformanceSignals } from '../lib/hooks';

export default function PerformanceSignals({ campusId }) {
  const { data: signals, loading, error } = usePerformanceSignals(campusId);

  if (loading) return <div className="loading">Loading signals...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  if (!signals || signals.length === 0) {
    return (
      <div className="panel">
        <h2>Performance Signals</h2>
        <div className="card-empty">No signals yet — first report generates Monday 7 AM</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Performance Signals</h2>
      {signals.map((signal) => (
        <div key={signal.id} className="signal-card">
          <div className="signal-header">
            <span className="signal-week">Week of {signal.week_of}</span>
          </div>

          {signal.summary && (
            <p className="signal-summary">{signal.summary}</p>
          )}

          <div className="signal-grid">
            <SignalList title="Top Hooks" items={signal.top_hooks} labelKey="type" />
            <SignalList title="Top Formats" items={signal.top_formats} labelKey="type" />
            <SignalList title="Top Topics" items={signal.top_topics} labelKey="topic" />
          </div>

          {signal.raw_output?.recommendations && (
            <div className="signal-recs">
              <h4>Recommendations</h4>
              <ul>
                {signal.raw_output.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {signal.raw_output?.underperforming_patterns && (
            <div className="signal-warn">
              <h4>Underperforming Patterns</h4>
              <ul>
                {signal.raw_output.underperforming_patterns.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SignalList({ title, items, labelKey }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="signal-list">
      <h4>{title}</h4>
      {items.map((item, i) => (
        <div key={i} className="signal-tag">
          {typeof item === 'string' ? item : item[labelKey] || JSON.stringify(item)}
          {item.avg_views && <span className="signal-views">{formatViews(item.avg_views)}</span>}
        </div>
      ))}
    </div>
  );
}

function formatViews(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}
