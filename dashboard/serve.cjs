// Production static server for the dashboard bundle.
// Vercel's `serve` only does static + SPA fallback; we need it to also
// forward /admin, /onboarding, /health to the webhooks server on :3000
// since the browser hits the dashboard origin (5173) for everything.
//
// .cjs extension because dashboard/package.json has "type": "module" —
// Node would otherwise treat a .js file as ESM and reject `require`.
// The repo root is CommonJS; this file matches that style.
const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = 5173;
const TARGET = 'http://localhost:3000';
const DIST = path.join(__dirname, 'dist');

const app = express();

// Single mount with pathFilter: http-proxy-middleware v4 reads req.url
// AFTER express strips a mount prefix, so app.use('/admin', proxy) ends
// up forwarding /students/recent (prefix gone) and the webhooks server
// 404s. Mounting at root with a function-form pathFilter keeps the full
// path intact and matches all three prefixes deterministically.
const PROXY_PATH_RE = /^\/(admin|onboarding|health)(\/|$)/;
app.use(
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: false,
    pathFilter: (pathname) => PROXY_PATH_RE.test(pathname),
  })
);

app.use(express.static(DIST));
app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard] serving ${DIST} on :${PORT}`);
  console.log(`[dashboard] proxying /admin /onboarding /health → ${TARGET}`);
});
