// In-app toolbar — ported from claude_design/project/dir-c-responsive.jsx's
// InAppToolbar. Position: fixed bottom-right inside the dashboard root so it
// survives static export. Style: ■/□ marks, four pairs (Theme · Mono · Grain)
// plus an opacity dial that controls panel transparency in glass mode.

export default function Toolbar({
  theme, bg, mono, alpha,
  onTheme, onBg, onMono, onAlpha,
  compact = false,
}) {
  const Pair = ({ optA, optB, value, set }) => (
    <span className="lim-iat-pair">
      <button
        type="button"
        className="lim-iat-opt"
        aria-pressed={value === optA.value}
        onClick={() => set(optA.value)}
      >
        <span className="lim-iat-mark">{value === optA.value ? '■' : '□'}</span>
        <span className="lim-iat-text">{optA.label}</span>
      </button>
      <button
        type="button"
        className="lim-iat-opt"
        aria-pressed={value === optB.value}
        onClick={() => set(optB.value)}
      >
        <span className="lim-iat-mark">{value === optB.value ? '■' : '□'}</span>
        <span className="lim-iat-text">{optB.label}</span>
      </button>
    </span>
  );

  return (
    <div className={`lim-iat${compact ? ' lim-iat--compact' : ''}`} role="toolbar" aria-label="Display options">
      <Pair value={theme} set={onTheme}
        optA={{ value: 'light', label: 'LIGHT' }}
        optB={{ value: 'dark',  label: 'DARK' }} />
      <Pair value={mono} set={onMono}
        optA={{ value: 'on',  label: 'MONOSPACED' }}
        optB={{ value: 'off', label: 'SANS' }} />
      <Pair value={bg} set={onBg}
        optA={{ value: 'on',  label: 'GRAIN' }}
        optB={{ value: 'off', label: 'PLAIN' }} />
      {typeof alpha === 'number' && onAlpha ? (
        <span className="lim-iat-dial" title="Card transparency">
          <span className="lim-iat-text lim-iat-dial-label">OPACITY</span>
          <input
            type="range" min="0" max="100" step="1"
            value={alpha}
            onChange={(e) => onAlpha(parseInt(e.target.value, 10))}
            aria-label="Card transparency"
          />
          <span className="lim-iat-dial-num">{String(alpha).padStart(2, '0')}</span>
        </span>
      ) : null}
    </div>
  );
}
