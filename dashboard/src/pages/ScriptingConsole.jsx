// On-demand scripting console — Scott picks a student + types a concept,
// reviews 3 generated scripts, refines or pushes each into ClickUp.
// Spec: docs/dashboard-consoles-spec.md §4

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCampuses } from '../lib/hooks';
import { buildCssVars, useDisplayPrefs } from '../lib/theme';
import '../ops.css';
import './ScriptingConsole.css';

const API_BASE = '/admin/scripting';
const STUDENTS_BASE = '/admin/students';

export default function ScriptingConsole() {
  const { theme, bg, mono, alpha } = useDisplayPrefs();
  const cssVars = useMemo(() => buildCssVars({ theme, bg, alpha }), [theme, bg, alpha]);

  const { data: campuses } = useCampuses();
  const [campusId, setCampusId] = useState(null);
  useEffect(() => {
    if (!campusId && campuses?.length > 0) setCampusId(campuses[0].id);
  }, [campusId, campuses]);

  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState(null);

  useEffect(() => {
    if (!campusId) return;
    let cancelled = false;
    setStudentsLoading(true);
    setStudentsError(null);
    fetch(`${STUDENTS_BASE}/recent?campusId=${campusId}&limit=100`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`recent students failed (${r.status})`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const onboarded = (data.students || []).filter((s) => !!s.onboarding_completed_at);
        // Alphabetical so the picker reads as a roster, not "recently created."
        onboarded.sort((a, b) => a.name.localeCompare(b.name));
        setStudents(onboarded);
      })
      .catch((err) => !cancelled && setStudentsError(err.message))
      .finally(() => !cancelled && setStudentsLoading(false));
    return () => { cancelled = true; };
  }, [campusId]);

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [conceptTitle, setConceptTitle] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [voiceAbort, setVoiceAbort] = useState(null);
  const [concepts, setConcepts] = useState(null);

  const selectedStudent = students.find((s) => s.id === selectedStudentId) || null;
  const canGenerate = !!selectedStudentId && conceptTitle.trim().length > 0 && !generating;

  async function runGenerate() {
    setGenerating(true);
    setGenerateError(null);
    setVoiceAbort(null);
    setConcepts(null);
    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campusId,
          studentId: selectedStudentId,
          conceptTitle: conceptTitle.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `Generate failed (${res.status})`);
      if (data.aborted) {
        setVoiceAbort({ issues: data.issues, attempts: data.attempts });
      } else {
        setConcepts((data.concepts || []).map((c) => ({ concept: c })));
      }
    } catch (err) {
      setGenerateError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  function handleGenerateSubmit(e) {
    e.preventDefault();
    if (!canGenerate) return;
    runGenerate();
  }

  async function runRefine(idx, refinementInput) {
    setConcepts((prev) =>
      prev.map((c, i) =>
        i === idx ? { ...c, refining: true, refineError: null, refineAbort: null } : c,
      ),
    );
    try {
      const res = await fetch(`${API_BASE}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campusId,
          studentId: selectedStudentId,
          originalConcept: concepts[idx].concept,
          refinementInput,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `Refine failed (${res.status})`);
      if (data.aborted) {
        setConcepts((prev) =>
          prev.map((c, i) =>
            i === idx
              ? { ...c, refining: false, refineAbort: { issues: data.issues, attempts: data.attempts } }
              : c,
          ),
        );
      } else {
        setConcepts((prev) =>
          prev.map((c, i) => (i === idx ? { concept: data.concept } : c)),
        );
      }
    } catch (err) {
      setConcepts((prev) =>
        prev.map((c, i) => (i === idx ? { ...c, refining: false, refineError: err.message } : c)),
      );
    }
  }

  async function runPush(idx) {
    setConcepts((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, pushing: true, pushError: null } : c)),
    );
    try {
      const res = await fetch(`${API_BASE}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campusId,
          studentId: selectedStudentId,
          concept: concepts[idx].concept,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `Push failed (${res.status})`);
      setConcepts((prev) =>
        prev.map((c, i) =>
          i === idx
            ? { ...c, pushing: false, pushed: { taskId: data.taskId, taskUrl: data.taskUrl, videoId: data.videoId } }
            : c,
        ),
      );
    } catch (err) {
      setConcepts((prev) =>
        prev.map((c, i) => (i === idx ? { ...c, pushing: false, pushError: err.message } : c)),
      );
    }
  }

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
      <div className="lim-pipe-stage">
        <div className="lim-header2">
          <div>
            <Link
              to="/ops"
              className="lim-header2__brand-eyebrow"
              style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}
            >
              ← LIMITLESS · OPS
            </Link>
            <div className="lim-header2__clock" style={{ fontSize: 30 }}>SCRIPTING</div>
          </div>
          <div className="lim-header2__right">
            <div className="lim-header2__counts">Manual concept generator.</div>
          </div>
        </div>

        <div className="lim-sc-caution">
          Pushed concepts persist in ClickUp. Refresh resets this page's view.
        </div>

        <form className="lim-sc-form" onSubmit={handleGenerateSubmit}>
          <div className="lim-sc-row">
            <label className="lim-sc-label" htmlFor="lim-sc-student">STUDENT</label>
            <select
              id="lim-sc-student"
              className="lim-sc-input"
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              disabled={studentsLoading || students.length === 0}
            >
              <option value="">
                {studentsLoading
                  ? 'Loading students…'
                  : students.length === 0
                    ? '— no onboarded students —'
                    : '— select a student —'}
              </option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="lim-sc-row">
            <label className="lim-sc-label" htmlFor="lim-sc-concept">CONCEPT</label>
            <input
              id="lim-sc-concept"
              type="text"
              className="lim-sc-input"
              placeholder="How AI flips homework on its head"
              maxLength={200}
              value={conceptTitle}
              onChange={(e) => setConceptTitle(e.target.value)}
            />
          </div>
          <div className="lim-sc-actions">
            <button type="submit" className="lim-sc-primary" disabled={!canGenerate}>
              {generating ? 'GENERATING…' : 'GENERATE 3 SCRIPTS'}
            </button>
          </div>
          {studentsError && (
            <div className="lim-sc-error">Failed to load students: {studentsError}</div>
          )}
          {students.length === 0 && !studentsLoading && !studentsError && (
            <div className="lim-sc-empty">
              No onboarded students yet. Create one at <Link to="/students">/students</Link> and walk
              them through onboarding first.
            </div>
          )}
        </form>

        {generateError && (
          <div className="lim-sc-error-block">
            <div className="lim-sc-error-title">Generate failed</div>
            <div className="lim-sc-error-body">{generateError}</div>
            <button className="lim-sc-secondary" onClick={runGenerate} disabled={!canGenerate}>TRY AGAIN</button>
          </div>
        )}

        {voiceAbort && (
          <div className="lim-sc-error-block">
            <div className="lim-sc-error-title">Brand-voice validator aborted after {voiceAbort.attempts} attempts.</div>
            <ul className="lim-sc-issue-list">
              {(voiceAbort.issues || []).flatMap((attemptBlock, ai) =>
                (attemptBlock.issues || []).map((issue, ii) => (
                  <li key={`${ai}-${ii}`}>
                    <strong>attempt {attemptBlock.attempt} · L{issue.layer} · {issue.rule}:</strong>{' '}
                    {issue.detail}
                    {issue.concept ? ` (concept ${issue.concept})` : ''}
                  </li>
                )),
              )}
            </ul>
            <button className="lim-sc-secondary" onClick={runGenerate} disabled={!canGenerate}>REGENERATE</button>
          </div>
        )}

        {concepts && concepts.map((entry, idx) => (
          <ConceptCard
            key={idx}
            index={idx}
            entry={entry}
            onRefine={(text) => runRefine(idx, text)}
            onPush={() => runPush(idx)}
          />
        ))}

        {selectedStudent && (
          <div className="lim-sc-footer-hint">
            Target: <strong>{selectedStudent.name}</strong>
            {selectedStudent.onboarding_completed_at && (
              <> · onboarded {new Date(selectedStudent.onboarding_completed_at).toISOString().slice(0, 10)}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConceptCard({ index, entry, onRefine, onPush }) {
  const { concept } = entry;
  const [showRefine, setShowRefine] = useState(false);
  const [refineText, setRefineText] = useState('');

  const pushed = entry.pushed;
  const buttonsDisabled = !!pushed || entry.pushing || entry.refining;

  function submitRefine(e) {
    e.preventDefault();
    const text = refineText.trim();
    if (!text || entry.refining || pushed) return;
    setShowRefine(false);
    onRefine(text);
    setRefineText('');
  }

  return (
    <div className={`lim-sc-card${pushed ? ' lim-sc-card--pushed' : ''}`}>
      <div className="lim-sc-card-head">CONCEPT {index + 1}</div>

      <dl className="lim-sc-fields">
        <dt>TITLE</dt>
        <dd>{concept.title}</dd>
        <dt>HOOK</dt>
        <dd>{concept.hook_angle}</dd>
        <dt>SCRIPT</dt>
        <dd className="lim-sc-script">{concept.script}</dd>
        <dt>DIRECTION</dt>
        <dd>
          <ul className="lim-sc-direction">
            {(concept.creative_direction || []).map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </dd>
      </dl>

      {entry.refineAbort && (
        <div className="lim-sc-inline-error">
          Refine aborted after {entry.refineAbort.attempts} attempts (voice validator).
          <ul className="lim-sc-issue-list">
            {(entry.refineAbort.issues || []).flatMap((b, ai) =>
              (b.issues || []).map((i, ii) => (
                <li key={`${ai}-${ii}`}>
                  <strong>attempt {b.attempt} · L{i.layer} · {i.rule}:</strong> {i.detail}
                </li>
              )),
            )}
          </ul>
        </div>
      )}
      {entry.refineError && <div className="lim-sc-inline-error">Refine error: {entry.refineError}</div>}
      {entry.pushError && <div className="lim-sc-inline-error">Push error: {entry.pushError}</div>}

      {showRefine && !pushed && (
        <form className="lim-sc-refine-form" onSubmit={submitRefine}>
          <textarea
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder="What would you change?"
            rows={3}
            autoFocus
          />
          <div className="lim-sc-refine-actions">
            <button
              type="button"
              className="lim-sc-secondary"
              onClick={() => { setShowRefine(false); setRefineText(''); }}
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="lim-sc-primary"
              disabled={!refineText.trim() || entry.refining}
            >
              {entry.refining ? 'REFINING…' : 'SUBMIT REFINEMENT'}
            </button>
          </div>
        </form>
      )}

      {!pushed && !showRefine && (
        <div className="lim-sc-actions">
          <button
            type="button"
            className="lim-sc-secondary"
            onClick={() => setShowRefine(true)}
            disabled={buttonsDisabled}
          >
            {entry.refining ? 'REFINING…' : 'REFINE'}
          </button>
          <button
            type="button"
            className="lim-sc-primary"
            onClick={onPush}
            disabled={buttonsDisabled}
          >
            {entry.pushing ? 'PUSHING…' : 'PUSH TO CLICKUP'}
          </button>
        </div>
      )}

      {pushed && (
        <div className="lim-sc-pushed">
          pushed → <a href={pushed.taskUrl} target="_blank" rel="noreferrer">{pushed.taskId}</a> ↗
        </div>
      )}
    </div>
  );
}
