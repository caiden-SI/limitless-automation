import { useState } from 'react';
import { useCampuses } from './lib/hooks';
import PipelineView from './components/PipelineView';
import AgentActivityFeed from './components/AgentActivityFeed';
import QAQueue from './components/QAQueue';
import EditorCapacity from './components/EditorCapacity';
import PerformanceSignals from './components/PerformanceSignals';
import './App.css';

const TABS = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'activity', label: 'Agent Activity' },
  { id: 'qa', label: 'QA Queue' },
  { id: 'editors', label: 'Editor Capacity' },
  { id: 'performance', label: 'Performance' },
];

export default function App() {
  const { data: campuses, loading: campusLoading } = useCampuses();
  const [campusId, setCampusId] = useState(null);
  const [activeTab, setActiveTab] = useState('pipeline');

  // Auto-select first campus once loaded
  if (!campusId && campuses?.length > 0) {
    setCampusId(campuses[0].id);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Limitless</h1>
        <nav className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab ${activeTab === tab.id ? 'tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="campus-select">
          {campusLoading ? (
            <span>Loading...</span>
          ) : (
            <select
              value={campusId || ''}
              onChange={(e) => setCampusId(e.target.value || null)}
            >
              <option value="">All Campuses</option>
              {(campuses || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      <main className="main">
        {activeTab === 'pipeline' && <PipelineView campusId={campusId} />}
        {activeTab === 'activity' && <AgentActivityFeed campusId={campusId} />}
        {activeTab === 'qa' && <QAQueue campusId={campusId} />}
        {activeTab === 'editors' && <EditorCapacity campusId={campusId} />}
        {activeTab === 'performance' && <PerformanceSignals campusId={campusId} />}
      </main>
    </div>
  );
}
