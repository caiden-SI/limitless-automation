// Self-serve student creation. Scott enters name + TikTok + Instagram +
// campus, hits Create, gets the personalized /onboard URL ready to copy.
// Spec: docs/dashboard-consoles-spec.md §5

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCampuses } from '../lib/hooks';
import { buildCssVars, useDisplayPrefs } from '../lib/theme';
import '../ops.css';
import './StudentsConsole.css';

const STUDENTS_BASE = '/admin/students';

export default function StudentsConsole() {
  const { theme, bg, mono, alpha } = useDisplayPrefs();
  const cssVars = useMemo(() => buildCssVars({ theme, bg, alpha }), [theme, bg, alpha]);

  const { data: campuses } = useCampuses();
  const [campusId, setCampusId] = useState(null);
  useEffect(() => {
    if (!campusId && campuses?.length > 0) setCampusId(campuses[0].id);
  }, [campusId, campuses]);

  const campus = (campuses || []).find((c) => c.id === campusId) || null;

  const [name, setName] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [instagram, setInstagram] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState(null);
  const [recentVersion, setRecentVersion] = useState(0);
  // Per-row "COPIED" flash for the recent-students list. Tracked
  // separately from the create-form `copied` state so concurrent clicks
  // on multiple rows don't clobber each other.
  const [copiedRowId, setCopiedRowId] = useState(null);

  useEffect(() => {
    if (!campusId) return;
    let cancelled = false;
    setRecentLoading(true);
    setRecentError(null);
    fetch(`${STUDENTS_BASE}/recent?campusId=${campusId}&limit=10`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`recent students failed (${r.status})`);
        return r.json();
      })
      .then((data) => !cancelled && setRecent(data.students || []))
      .catch((err) => !cancelled && setRecentError(err.message))
      .finally(() => !cancelled && setRecentLoading(false));
    return () => { cancelled = true; };
  }, [campusId, recentVersion]);

  const onboardedCount = recent.filter((s) => !!s.onboarding_completed_at).length;

  const canCreate = name.trim().length > 0 && tiktok.trim().length > 0
    && instagram.trim().length > 0 && !!campusId && !creating;

  async function handleCreate(e) {
    e.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    setCreateError(null);
    setDuplicate(null);
    setCreated(null);
    setCopied(false);
    try {
      const res = await fetch(`${STUDENTS_BASE}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          tiktokHandle: tiktok.trim(),
          instagramHandle: instagram.trim(),
          campusId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === 'duplicate_name') {
        setDuplicate({ existingStudentId: data.existingStudentId, existingUrl: data.existingUrl });
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || `Create failed (${res.status})`);
      setCreated({ studentId: data.studentId, name: data.name, url: data.url });
      setName('');
      setTiktok('');
      setInstagram('');
      setRecentVersion((n) => n + 1);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleRowCopy(rowId, url) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedRowId(rowId);
    // Functional update guards against a later row's flash clobbering
    // an earlier row's (concurrent clicks within the 2s window).
    setTimeout(() => setCopiedRowId((cur) => (cur === rowId ? null : cur)), 2000);
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
            <div className="lim-header2__clock" style={{ fontSize: 30 }}>STUDENTS</div>
          </div>
          <div className="lim-header2__right">
            <div className="lim-header2__counts">
              {recent.length} recent · {onboardedCount} onboarded
              {campus ? ` · ${campus.name}` : ''}
            </div>
          </div>
        </div>

        <form className="lim-st-form" onSubmit={handleCreate}>
          <div className="lim-st-card-head">CREATE NEW STUDENT</div>
          <div className="lim-st-row">
            <label className="lim-st-label" htmlFor="lim-st-name">NAME</label>
            <input
              id="lim-st-name"
              type="text"
              className="lim-st-input"
              placeholder="Marcus Reyes"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="lim-st-row">
            <label className="lim-st-label" htmlFor="lim-st-tt">TIKTOK HANDLE</label>
            <input
              id="lim-st-tt"
              type="text"
              className="lim-st-input"
              placeholder="@marcus.reyes"
              maxLength={64}
              value={tiktok}
              onChange={(e) => setTiktok(e.target.value)}
            />
          </div>
          <div className="lim-st-row">
            <label className="lim-st-label" htmlFor="lim-st-ig">INSTAGRAM HANDLE</label>
            <input
              id="lim-st-ig"
              type="text"
              className="lim-st-input"
              placeholder="@marcus_reyes_"
              maxLength={64}
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
            />
          </div>
          <div className="lim-st-row">
            <label className="lim-st-label" htmlFor="lim-st-campus">CAMPUS</label>
            <select
              id="lim-st-campus"
              className="lim-st-input"
              value={campusId || ''}
              onChange={(e) => setCampusId(e.target.value || null)}
            >
              {(campuses || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="lim-st-actions">
            <button type="submit" className="lim-st-primary" disabled={!canCreate}>
              {creating ? 'CREATING…' : 'CREATE & GENERATE URL'}
            </button>
          </div>
          {createError && <div className="lim-st-error">Create failed: {createError}</div>}
        </form>

        {duplicate && (
          <div className="lim-st-card lim-st-card--warn">
            <div className="lim-st-card-head">ALREADY EXISTS</div>
            <p>
              A student named <strong>{name.trim()}</strong> already exists on this campus.
              Use a distinguishing suffix (e.g., middle initial) to avoid the Scripting matcher's
              ambiguous-rejection path, or copy their existing onboarding URL below.
            </p>
            <div className="lim-st-url">{duplicate.existingUrl}</div>
            <div className="lim-st-actions">
              <button
                type="button"
                className={`lim-st-primary${copied ? ' lim-st-primary--copied' : ''}`}
                onClick={() => handleCopy(duplicate.existingUrl)}
              >
                {copied ? 'COPIED' : 'COPY EXISTING LINK'}
              </button>
            </div>
          </div>
        )}

        {created && (
          <div className="lim-st-card">
            <div className="lim-st-card-head">ONBOARDING LINK</div>
            <div className="lim-st-url">{created.url}</div>
            <div className="lim-st-actions">
              <button
                type="button"
                className={`lim-st-primary${copied ? ' lim-st-primary--copied' : ''}`}
                onClick={() => handleCopy(created.url)}
              >
                {copied ? 'COPIED' : 'COPY LINK'}
              </button>
            </div>
            <p className="lim-st-hint">
              Send this to <strong>{created.name}</strong>. The link stays valid until they complete
              onboarding (~15 minutes, six sections).
            </p>
          </div>
        )}

        <div className="lim-st-card">
          <div className="lim-st-card-head">RECENT STUDENTS</div>
          {recentLoading && <div className="lim-st-hint">Loading…</div>}
          {recentError && <div className="lim-st-error">Failed to load recent students: {recentError}</div>}
          {!recentLoading && recent.length === 0 && !recentError && (
            <div className="lim-st-hint">No students on this campus yet.</div>
          )}
          {recent.length > 0 && (
            <ul className="lim-st-recent">
              {recent.map((s) => {
                const showCopy = !s.onboarding_completed_at && !!s.url;
                const isFlashing = copiedRowId === s.id;
                return (
                  <li key={s.id}>
                    <span className="lim-st-recent-name">{s.name}</span>
                    <span className="lim-st-recent-right">
                      <span className="lim-st-recent-state">{describeStudent(s)}</span>
                      {showCopy && (
                        <button
                          type="button"
                          className={`lim-st-recent-copy${isFlashing ? ' lim-st-recent-copy--copied' : ''}`}
                          disabled={isFlashing}
                          onClick={() => handleRowCopy(s.id, s.url)}
                          title={s.url}
                        >
                          {isFlashing ? 'COPIED' : 'COPY URL'}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function describeStudent(s) {
  if (s.onboarding_completed_at) {
    const d = new Date(s.onboarding_completed_at).toISOString().slice(0, 10);
    return `onboarded ${d}`;
  }
  const created = new Date(s.created_at);
  if (!Number.isFinite(created.getTime())) return 'created';
  const ageMs = Date.now() - created.getTime();
  const ageMin = Math.round(ageMs / 60000);
  if (ageMin < 1) return 'created just now';
  if (ageMin < 60) return `created ${ageMin}m ago`;
  const ageHrs = Math.round(ageMin / 60);
  if (ageHrs < 24) return `created ${ageHrs}h ago`;
  const ageDays = Math.round(ageHrs / 24);
  if (ageDays < 14) return `created ${ageDays}d ago`;
  return `created ${created.toISOString().slice(0, 10)}`;
}
