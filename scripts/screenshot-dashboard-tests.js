#!/usr/bin/env node
// Drives the 8 manual tests for docs/dashboard-scoring-fix-spec.md.
// For each test:
//   1. Run scripts/test-dashboard-scoring.js setup <id>
//   2. Wait for the dashboard to poll new data
//   3. Capture full-viewport screenshot via Chrome headless
//   4. Run cleanup <id>
//
// Prerequisites:
//   - Dev server running at http://localhost:5173/ops
//   - The updated SQL in scripts/setup-dashboard-rls.sql applied to
//     Supabase (otherwise audio cell + webhook-fail detail render
//     defaults instead of synthetic test outcomes)
//   - macOS Chrome at /Applications/Google Chrome.app
//
// Output: docs/dashboard-scoring-screenshots/test-{id}.png

require('dotenv').config();
const { exec } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execAsync = promisify(exec);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TARGET_URL = 'http://localhost:5173/ops';
const VIEWPORT = '1440,2560';
const OUT_DIR = path.join(__dirname, '..', 'docs', 'dashboard-scoring-screenshots');
const POLL_WAIT_MS = 35_000; // allow one full system_health polling cycle (30s) plus margin
const VIRTUAL_BUDGET_MS = 18_000;

const TESTS = ['1', '2', '3', '4', '4b', '4c', '5', '6', '7', '8'];

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function runTestScript(action, id) {
  const cmd = `node ${path.join(__dirname, 'test-dashboard-scoring.js')} ${action}${id ? ` ${id}` : ''}`;
  const { stdout, stderr } = await execAsync(cmd);
  if (stderr) process.stderr.write(stderr);
  process.stdout.write(stdout);
}

async function chromeShot(filePath) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--window-size=${VIEWPORT}`,
    `--virtual-time-budget=${VIRTUAL_BUDGET_MS}`,
    `--screenshot=${filePath}`,
    `--user-data-dir=/tmp/dashboard-scoring-chrome-${Date.now()}`,
    TARGET_URL,
  ];
  return new Promise((resolve, reject) => {
    const child = exec(`"${CHROME}" ${args.join(' ')}`, { timeout: 60_000 }, (err) => {
      if (err && err.code !== 0 && err.code !== null) reject(err);
      else resolve();
    });
    child.on('error', reject);
  });
}

async function preflight() {
  // Confirm the dev server is up.
  try {
    const res = await fetch(TARGET_URL, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(`dev server not reachable at ${TARGET_URL}: ${e.message}\n→ run "cd dashboard && npm run dev" in another terminal first.`);
  }
  if (!fs.existsSync(CHROME)) {
    throw new Error(`Chrome not found at ${CHROME}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function main() {
  await preflight();
  console.log(`output dir: ${OUT_DIR}`);
  console.log(`viewport: ${VIEWPORT}, polling wait: ${POLL_WAIT_MS / 1000}s\n`);

  // Ensure clean state up front
  console.log('>>> cleanup-all (start from a known empty synthetic state)');
  await runTestScript('cleanup-all');
  console.log();

  for (const id of TESTS) {
    console.log(`========== TEST ${id} ==========`);
    console.log(`>>> setup ${id}`);
    await runTestScript('setup', id);

    console.log(`>>> waiting ${POLL_WAIT_MS / 1000}s for dashboard polling cycle`);
    await sleep(POLL_WAIT_MS);

    const out = path.join(OUT_DIR, `test-${id}.png`);
    console.log(`>>> capture → ${out}`);
    try {
      await chromeShot(out);
    } catch (e) {
      console.error(`screenshot failed for test ${id}:`, e.message);
    }

    console.log(`>>> cleanup ${id}`);
    await runTestScript('cleanup', id);
    console.log();
  }

  console.log('>>> final cleanup-all');
  await runTestScript('cleanup-all');
  console.log('\ndone.');
}

main().catch((err) => {
  console.error('orchestrator failed:', err);
  process.exit(1);
});
