// Full 11-column pipeline kanban route. Same chrome (toolbar, grain,
// header) as /ops so the surface stays consistent.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCampuses, useVideos } from '../lib/hooks';
import { isStuck } from '../lib/health';
import { buildCssVars, useDisplayPrefs } from '../lib/theme';
// Lazy so three.js code-splits out of the main bundle. Mount-gated below
// so mobile / toggle-off sessions never trigger the dynamic import.
const GrainBackground = lazy(() => import('../components/GrainBackground'));
import Toolbar from '../components/Toolbar';
import PipelineKanban from '../components/PipelineKanban';
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
  return { width: w, isPhone: w <= 600 };
}

export default function Pipeline() {
  const { theme, bg, mono, alpha, setTheme, setBg, setMono, setAlpha } = useDisplayPrefs();
  const cssVars = useMemo(() => buildCssVars({ theme, bg, alpha }), [theme, bg, alpha]);
  const { isPhone } = useViewport();

  const { data: campuses, loading: campusLoading } = useCampuses();
  const [campusId, setCampusId] = useState(null);
  useEffect(() => {
    if (!campusId && campuses?.length > 0) setCampusId(campuses[0].id);
  }, [campusId, campuses]);

  const { data: videos } = useVideos(campusId);
  const totals = useMemo(() => {
    const list = videos || [];
    return {
      active: list.length,
      stuck: list.filter((v) => isStuck(v)).length,
      failed: list.filter((v) => v.qa_passed === false || v.status === 'WAITING').length,
    };
  }, [videos]);

  const grainEnabled = bg === 'on' && !isPhone;

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

      <div className="lim-pipe-stage">
        <div className="lim-header2">
          <div>
            <Link to="/ops" className="lim-header2__brand-eyebrow" style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
              ← LIMITLESS · OPS
            </Link>
            <div className="lim-header2__clock" style={{ fontSize: 30 }}>PIPELINE</div>
          </div>
          <div className="lim-header2__right">
            <div className="lim-header2__counts">
              <strong>{totals.active}</strong> ACTIVE ·{' '}
              <strong>{totals.stuck}</strong> STUCK ·{' '}
              <strong>{totals.failed}</strong> QA
            </div>
            {campuses && campuses.length > 1 && (
              <select
                className="lim-header2__campus"
                value={campusId || ''}
                onChange={(e) => setCampusId(e.target.value || null)}
                disabled={campusLoading}
              >
                {campuses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <PipelineKanban campusId={campusId} />

        {/* Toolbar lives in flow at the end of .lim-pipe-stage so it only
         * appears once the user scrolls past the kanban. */}
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
    </div>
  );
}
