// Limitless Ops — single-screen operations dashboard for the seven-agent
// production pipeline. Reads exclusively from Supabase RPCs (anon key,
// scoped by campus_id). Layout follows the Claude Design handoff
// (claude_design/project/dir-c-responsive.jsx → DirCPortrait/Laptop/Mobile).
// Data bindings, polling, RPC calls and the lazy-loaded grain are unchanged
// from the prior pass — this is purely a styling restyle.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  useAgentLogs,
  useCampuses,
  useEditors,
  usePerformanceSignals,
  useSystemHealthSummary,
  useVideos,
  useWebhookInboxStatus,
} from '../lib/hooks';
import { actionItems, isStuck, systemPulse } from '../lib/health';
import { buildCssVars, useDisplayPrefs } from '../lib/theme';
// Lazy so three.js code-splits out of the main bundle. We also gate the
// mount on `grainEnabled`, so mobile / toggle-off / amber-or-red sessions
// never trigger the dynamic import in the first place.
const GrainBackground = lazy(() => import('../components/GrainBackground'));
import Toolbar from '../components/Toolbar';
import OpsHeader from '../components/OpsHeader';
import HealthBars from '../components/HealthBars';
import AgentGrid from '../components/AgentGrid';
import UpcomingShoots from '../components/UpcomingShoots';
import LiveEventStream from '../components/LiveEventStream';
import IntegrationHealth from '../components/IntegrationHealth';
import SystemHealthStrip from '../components/SystemHealthStrip';
import PipelineSummary from '../components/PipelineSummary';
import QAQueue from '../components/QAQueue';
import EditorCapacity from '../components/EditorCapacity';
import PerformanceSignals from '../components/PerformanceSignals';
import '../ops.css';

function useViewport() {
  const [w, setW] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  );
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return {
    width: w,
    isPhone: w <= 600,
    isLaptop: w > 600 && w <= 1500,
    isPortrait: typeof window !== 'undefined'
      ? window.innerHeight > window.innerWidth
      : false,
  };
}

export default function Ops() {
  const { theme, bg, mono, alpha, setTheme, setBg, setMono, setAlpha } = useDisplayPrefs();
  const cssVars = useMemo(() => buildCssVars({ theme, bg, alpha }), [theme, bg, alpha]);
  const { width, isPhone, isLaptop, isPortrait } = useViewport();

  // === Data sources (all RPC-backed, real Austin campus data) ===
  const { data: campuses, loading: campusLoading } = useCampuses();
  const [campusId, setCampusId] = useState(null);
  const [campusInitialized, setCampusInitialized] = useState(false);
  useEffect(() => {
    if (!campusInitialized && campuses?.length > 0) {
      setCampusId(campuses[0].id);
      setCampusInitialized(true);
    }
  }, [campuses, campusInitialized]);

  const videos = useVideos(campusId);
  const logs = useAgentLogs(campusId, 200);
  const editors = useEditors(campusId);
  const inbox = useWebhookInboxStatus(campusId);
  const sys = useSystemHealthSummary(campusId);
  // Performance signals load lazily via the panel's own hook.
  usePerformanceSignals(campusId, 1);

  const inboxRow = (inbox.data || [])[0] || null;
  const sysRow = (sys.data || [])[0] || null;

  // Track the last successful fetch timestamp across the data hooks. The
  // useSupabaseQuery contract returns a new array reference on every fetch
  // (setData(result)), so each data-prop reference change marks a refresh.
  // We watch every poll-driven data source — whichever fetches most often
  // wins. lib/hooks.js stays untouched (it's on the don't-change list);
  // this lives in the page that already consumes them.
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  useEffect(() => {
    if (videos.data || logs.data || editors.data || inbox.data || sys.data) {
      setLastFetchedAt(Date.now());
    }
  }, [videos.data, logs.data, editors.data, inbox.data, sys.data]);

  const actions = useMemo(
    () => actionItems({
      videos: videos.data || [],
      editors: editors.data || [],
      logs: logs.data || [],
      inbox: inboxRow,
      summary: sysRow,
    }),
    [videos.data, editors.data, logs.data, inboxRow, sysRow],
  );
  const pulse = useMemo(
    () => systemPulse({ logs: logs.data || [], inbox: inboxRow, summary: sysRow }),
    [logs.data, inboxRow, sysRow],
  );

  // Header summary counts — drive the eyebrow line and the pip strip.
  const totals = useMemo(() => {
    const list = videos.data || [];
    return {
      active: list.length,
      stuck: list.filter((v) => isStuck(v)).length,
      failed: list.filter((v) => v.qa_passed === false || v.status === 'WAITING').length,
    };
  }, [videos.data]);

  // Pause grain when the System Pulse has any non-green cell. Spec keeps the
  // brief's "motion behind triage is fatiguing" rule.
  const sysIsClean = pulse.cells.every((c) => c.state === 'green');
  const grainEnabled = bg === 'on' && !isPhone && sysIsClean;

  // Tweaks panel was dropped from production per project requirements; the
  // four toolbar toggles are the entire surface area now.

  return (
    <div
      className="lim-root"
      data-glass={bg === 'on' ? 'on' : 'off'}
      style={{
        ...cssVars,
        fontFamily: mono === 'on'
          ? "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
          : "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {grainEnabled && (
        <Suspense fallback={null}>
          <GrainBackground
            isDark={theme === 'dark'}
            grainSrc="/grain.webp"
            blurSrc="/blur.webp"
            style={mono === 'on' ? 1 : 0}
          />
        </Suspense>
      )}

      <div className="lim-stage">
        <OpsHeader
          campusId={campusId}
          campuses={campuses}
          onCampus={setCampusId}
          campusLoading={campusLoading}
          totals={totals}
          pulseCells={pulse.cells}
          lastFetchedAt={lastFetchedAt}
        />

        {/* Hero pair — Action Items + System Pulse (two-up; stacks on phone) */}
        <div className="lim-grid-2">
          <HealthBars actions={actions} pulse={pulse} />
        </div>

        {/* Agents + Upcoming Shoots (two-up on Studio Display, stacks on phone) */}
        {!isLaptop ? (
          <div className="lim-grid-2">
            <AgentGrid logs={logs.data} loading={logs.loading} />
            <UpcomingShoots />
          </div>
        ) : (
          <>
            {/* Laptop: 7-agent row on its own, then UpcomingShoots full-width */}
            <AgentGrid logs={logs.data} loading={logs.loading} />
            <UpcomingShoots />
          </>
        )}

        {/* Phone-only KPI row — tones derived from action items / pulse */}
        {isPhone && (
          <div className="lim-grid-3">
            <Kpi
              n={totals.stuck}
              label="STUCK"
              tone={actions.some((a) => a.category === 'stuck') ? 'red' : 'green'}
            />
            <Kpi
              n={totals.failed}
              label="QA FAIL"
              tone={actions.some((a) => a.category === 'qa-fail') ? 'red' : 'green'}
            />
            <Kpi
              n={pulse.count}
              label="ALERTS"
              tone={
                pulse.count === 0 ? 'green'
                : pulse.cells.some((c) => c.state === 'red') ? 'red'
                : 'amber'
              }
            />
          </div>
        )}

        {/* Pipeline summary — compact 11-column row, or stacked on phone */}
        <PipelineSummary
          videos={videos.data}
          loading={videos.loading}
          layout={isPhone ? 'stack' : 'row'}
        />

        {/* Bottom split: QA + Editors + System | Signals + Activity + Integrations */}
        {isPhone ? (
          <>
            <QAQueue campusId={campusId} agentLogs={logs.data} />
            <EditorCapacity campusId={campusId} />
            <SystemHealthStrip pulse={pulse} />
            <PerformanceSignals campusId={campusId} />
            <IntegrationHealth logs={logs.data} inbox={inboxRow} />
            <LiveEventStream
              logs={logs.data}
              loading={logs.loading}
              error={logs.error}
            />
          </>
        ) : isLaptop ? (
          <>
            <div className="lim-grid-2">
              <QAQueue campusId={campusId} agentLogs={logs.data} />
              <EditorCapacity campusId={campusId} />
            </div>
            <PerformanceSignals campusId={campusId} />
            <div className="lim-grid-2">
              <IntegrationHealth logs={logs.data} inbox={inboxRow} />
              <SystemHealthStrip pulse={pulse} />
            </div>
            <LiveEventStream
              logs={logs.data}
              loading={logs.loading}
              error={logs.error}
            />
          </>
        ) : (
          <div className="lim-bottom-cols">
            <div className="lim-bottom-col">
              <QAQueue campusId={campusId} agentLogs={logs.data} />
              <EditorCapacity campusId={campusId} />
              <SystemHealthStrip pulse={pulse} />
            </div>
            <div className="lim-bottom-col">
              <PerformanceSignals campusId={campusId} />
              <LiveEventStream
                logs={logs.data}
                loading={logs.loading}
                error={logs.error}
              />
              <IntegrationHealth logs={logs.data} inbox={inboxRow} />
            </div>
          </div>
        )}
      </div>

      <Toolbar
        theme={theme}
        bg={bg}
        mono={mono}
        alpha={alpha}
        onTheme={setTheme}
        onBg={setBg}
        onMono={setMono}
        onAlpha={setAlpha}
        compact={isPhone}
      />
    </div>
  );
}

function Kpi({ n, label, tone }) {
  return (
    <div className={`lim-kpi lim-kpi--${tone}`}>
      <div className="lim-kpi__num">{n}</div>
      <div className="lim-kpi__label">{label}</div>
    </div>
  );
}
