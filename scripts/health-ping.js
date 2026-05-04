#!/usr/bin/env node
// Health-ping agent — runs every 60s on the Mac Mini via PM2 cron_restart.
// Five active checks, one row per check inserted into agent_logs in a single
// batch:
//
//   ping_tunnel  — fetch TUNNEL_URL/health (5s timeout)
//   ping_pm2     — pm2 jlist; any non-online process is an error
//   ping_ffmpeg  — ffmpeg -version exit code
//   ping_disk    — df -k / capacity (% used)
//   ping_memory  — os.totalmem / os.freemem
//
// Each row uses agent_name='health' so the dashboard's
// get_campus_system_health_summary RPC can filter by action and read the
// most recent value per check. Statuses follow agent_logs convention:
// 'success' / 'warning' / 'error'. Every failure includes a brief
// error_message so the dashboard's tunnel-down / pm2-fail / etc. action
// items have something concrete to surface.

require('dotenv').config();
const os = require('node:os');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const execAsync = promisify(exec);
const { supabase } = require('../lib/supabase');

const TUNNEL_URL = process.env.TUNNEL_URL;
// Fallback to Austin so a fresh Mac Mini install with TUNNEL_URL set but
// CAMPUS_ID forgotten still produces useful pings.
const CAMPUS_ID = process.env.CAMPUS_ID || '0ba4268f-f010-43c5-906c-41509bc9612f';

const PING_TIMEOUT_MS = 5000;
const DISK_AMBER_PCT = 85;
const DISK_RED_PCT = 95;
const MEMORY_AMBER_PCT = 85;
const MEMORY_RED_PCT = 95;

async function pingTunnel() {
  if (!TUNNEL_URL) {
    return {
      action: 'ping_tunnel',
      status: 'error',
      error_message: 'TUNNEL_URL not configured',
    };
  }
  const url = `${TUNNEL_URL.replace(/\/$/, '')}/health`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) {
      return {
        action: 'ping_tunnel',
        status: 'error',
        error_message: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
      };
    }
    return { action: 'ping_tunnel', status: 'success', error_message: null };
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? `timeout after ${PING_TIMEOUT_MS / 1000}s`
      : err.message || String(err);
    return { action: 'ping_tunnel', status: 'error', error_message: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function pingPm2() {
  try {
    const { stdout } = await execAsync('pm2 jlist', { timeout: PING_TIMEOUT_MS });
    const procs = JSON.parse(stdout || '[]');
    if (procs.length === 0) {
      return {
        action: 'ping_pm2',
        status: 'error',
        error_message: 'no PM2 processes registered',
      };
    }
    const bad = procs.filter((p) => (p.pm2_env?.status ?? 'unknown') !== 'online');
    if (bad.length > 0) {
      const summary = bad
        .map((p) => `${p.name}: ${p.pm2_env?.status || 'unknown'}`)
        .join(', ');
      return { action: 'ping_pm2', status: 'error', error_message: summary };
    }
    return {
      action: 'ping_pm2',
      status: 'success',
      error_message: `${procs.length} process${procs.length === 1 ? '' : 'es'} online`,
    };
  } catch (err) {
    return {
      action: 'ping_pm2',
      status: 'error',
      error_message: err.message || String(err),
    };
  }
}

async function pingFfmpeg() {
  try {
    const { stdout } = await execAsync('ffmpeg -version', { timeout: PING_TIMEOUT_MS });
    const firstLine = (stdout || '').split('\n')[0] || 'ffmpeg ok';
    return { action: 'ping_ffmpeg', status: 'success', error_message: firstLine };
  } catch (err) {
    return {
      action: 'ping_ffmpeg',
      status: 'error',
      error_message: (err.stderr || err.message || String(err)).split('\n')[0],
    };
  }
}

async function pingDisk() {
  try {
    const { stdout } = await execAsync('df -k /', { timeout: PING_TIMEOUT_MS });
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) {
      return {
        action: 'ping_disk',
        status: 'error',
        error_message: 'unexpected df output',
      };
    }
    // df row: filesystem 1k-blocks used available capacity ... mountpoint
    const cols = lines[1].trim().split(/\s+/);
    const capacityCol = cols.find((c) => c.endsWith('%'));
    const pct = capacityCol ? parseInt(capacityCol, 10) : NaN;
    if (Number.isNaN(pct)) {
      return {
        action: 'ping_disk',
        status: 'error',
        error_message: `unparsable capacity: ${capacityCol ?? cols.join(' ')}`,
      };
    }
    if (pct >= DISK_RED_PCT) {
      return { action: 'ping_disk', status: 'error', error_message: `disk ${pct}%` };
    }
    if (pct >= DISK_AMBER_PCT) {
      return { action: 'ping_disk', status: 'warning', error_message: `disk ${pct}%` };
    }
    return { action: 'ping_disk', status: 'success', error_message: `disk ${pct}%` };
  } catch (err) {
    return {
      action: 'ping_disk',
      status: 'error',
      error_message: err.message || String(err),
    };
  }
}

function pingMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  if (total <= 0) {
    return {
      action: 'ping_memory',
      status: 'error',
      error_message: 'unable to read totalmem',
    };
  }
  const used = total - free;
  const pct = Math.round((used / total) * 100);
  if (pct >= MEMORY_RED_PCT) {
    return { action: 'ping_memory', status: 'error', error_message: `memory ${pct}%` };
  }
  if (pct >= MEMORY_AMBER_PCT) {
    return { action: 'ping_memory', status: 'warning', error_message: `memory ${pct}%` };
  }
  return { action: 'ping_memory', status: 'success', error_message: `memory ${pct}%` };
}

async function main() {
  const [tunnel, pm2, ffmpeg, disk] = await Promise.all([
    pingTunnel(),
    pingPm2(),
    pingFfmpeg(),
    pingDisk(),
  ]);
  const memory = pingMemory();

  const rows = [tunnel, pm2, ffmpeg, disk, memory].map((r) => ({
    campus_id: CAMPUS_ID,
    agent_name: 'health',
    action: r.action,
    status: r.status,
    error_message: r.error_message,
  }));

  const { error } = await supabase.from('agent_logs').insert(rows);
  if (error) {
    console.error('[health-ping] supabase insert failed:', error.message);
    process.exit(1);
  }

  const summary = rows
    .map((r) => `${r.action}=${r.status}`)
    .join(' · ');
  console.log(`[health-ping] ${summary}`);
}

main().catch((err) => {
  console.error('[health-ping] failed:', err);
  process.exit(1);
});
