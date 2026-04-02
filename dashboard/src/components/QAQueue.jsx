import { useQAQueue } from '../lib/hooks';

export default function QAQueue({ campusId }) {
  const { data: videos, loading, error } = useQAQueue(campusId);

  if (loading) return <div className="loading">Loading QA queue...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const needsQA = (videos || []).filter((v) => v.qa_passed === null && v.status === 'EDITED');
  const failed = (videos || []).filter((v) => v.qa_passed === false || v.status === 'NEEDS REVISIONS');

  return (
    <div className="panel">
      <h2>QA Queue</h2>

      <div className="qa-section">
        <h3>Awaiting QA <span className="count">{needsQA.length}</span></h3>
        {needsQA.length === 0 && <div className="card-empty">No videos awaiting QA</div>}
        {needsQA.map((v) => (
          <div key={v.id} className="card">
            <div className="card-title">{v.title}</div>
            {v.student_name && <div className="card-meta">{v.student_name}</div>}
            <div className="card-meta">Status: {v.status}</div>
            <div className="card-time">Updated {timeAgo(v.updated_at)}</div>
          </div>
        ))}
      </div>

      <div className="qa-section">
        <h3>QA Failed / Needs Revisions <span className="count count--fail">{failed.length}</span></h3>
        {failed.length === 0 && <div className="card-empty">No failed videos</div>}
        {failed.map((v) => (
          <div key={v.id} className="card card--fail">
            <div className="card-title">{v.title}</div>
            {v.student_name && <div className="card-meta">{v.student_name}</div>}
            <div className="card-meta">Status: {v.status}</div>
            <div className="card-time">Updated {timeAgo(v.updated_at)}</div>
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
  return `${Math.floor(hours / 24)}d ago`;
}
