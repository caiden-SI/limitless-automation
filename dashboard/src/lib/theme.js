// Persisted display state — theme/grain/mono/alpha. Hydrated synchronously
// from localStorage on the first useState call so there's no flash of wrong
// theme. Values match the design source (claude_design/project/dir-c-responsive.jsx).

import { useEffect, useState } from 'react';

export const STORAGE_KEYS = {
  theme: 'limitless.theme',
  bg: 'limitless.bg',
  mono: 'limitless.mono',
  alpha: 'limitless.alpha',
};

function read(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* noop */ }
}

function detectInitialTheme() {
  const stored = read(STORAGE_KEYS.theme, null);
  if (stored === 'light' || stored === 'dark') return stored;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

export function useDisplayPrefs() {
  const [theme, setThemeRaw] = useState(detectInitialTheme);
  const [bg, setBgRaw]       = useState(() => read(STORAGE_KEYS.bg, 'off'));
  const [mono, setMonoRaw]   = useState(() => read(STORAGE_KEYS.mono, 'off'));
  const [alpha, setAlphaRaw] = useState(() => parseInt(read(STORAGE_KEYS.alpha, '65'), 10));

  // Sync the html attributes for any global selectors (font, html bg, etc.)
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.setAttribute('data-bg', bg);       }, [bg]);
  useEffect(() => { document.documentElement.setAttribute('data-mono', mono);   }, [mono]);

  const setTheme = (v) => { setThemeRaw(v); write(STORAGE_KEYS.theme, v); };
  const setBg    = (v) => { setBgRaw(v);    write(STORAGE_KEYS.bg, v); };
  const setMono  = (v) => { setMonoRaw(v);  write(STORAGE_KEYS.mono, v); };
  const setAlpha = (v) => {
    const n = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
    setAlphaRaw(n); write(STORAGE_KEYS.alpha, n);
  };

  return { theme, bg, mono, alpha, setTheme, setBg, setMono, setAlpha };
}

// CSS custom properties matching the design source exactly. Returned as an
// object for inline style application on the dashboard root. Glass mode
// (when grain is on) swaps bg-2/bg-3 to alpha-aware rgba so the shader shows
// through. Accent stays at hue 148 (the design's default — Tweaks panel hue
// dial is dropped from production per project requirements).
export function buildCssVars({ theme, bg, alpha }) {
  const dark  = theme === 'dark';
  const glass = bg === 'on';
  const a  = (typeof alpha === 'number') ? Math.max(0, Math.min(100, alpha)) / 100 : 0.65;
  const a2 = Math.min(1, a + 0.05);
  return {
    '--bg':     dark ? '#0a0c0e' : '#f6f6f4',
    '--bg-2':   glass ? (dark ? `rgba(20,20,24,${a})`  : `rgba(255,255,255,${a})`)  : (dark ? '#13161a' : '#ececea'),
    '--bg-3':   glass ? (dark ? `rgba(28,32,38,${a2})` : `rgba(255,255,255,${a2})`) : (dark ? '#1c2026' : '#e2e2df'),
    '--ink':    dark ? '#f5f5f2' : '#0a0c0e',
    '--ink-2':  dark ? '#a8aaad' : '#54565a',
    '--ink-3':  dark ? '#62656b' : '#9a9ca0',
    '--rule':   dark ? '#262a30' : '#d8d8d4',
    '--accent': 'oklch(0.62 0.16 148)',
    '--green':  dark ? '#5cd18b' : '#1c8a3c',
    '--amber':  dark ? '#f0b03a' : '#b8721a',
    '--red':    dark ? '#ff5c4a' : '#cc2a18',
  };
}

// Live wall clock that ticks every second so the header shows real time
// instead of the mocked "FRI · 09:03 CT" string from the design seed data.
export function useLiveClock(timeZone = 'America/Chicago') {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const dow = now
    .toLocaleDateString('en-US', { weekday: 'short', timeZone })
    .toUpperCase();
  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone,
  });
  const tzAbbrev = now
    .toLocaleTimeString('en-US', { timeZoneName: 'short', timeZone })
    .split(' ')
    .pop();
  return { now, dow, time, tzAbbrev };
}
