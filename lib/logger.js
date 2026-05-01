// Logger — dual output to console (PM2) and Supabase agent_logs table.
// Error handling rule: log full error context to agent_logs BEFORE attempting recovery.

const supabaseModule = require('./supabase');

// Retry delays for the Supabase insert. Three attempts; backoffs between
// attempts cover the macOS network-stack warmup window after a Mac Mini reboot,
// when the server starts before fetch() can resolve api.supabase.co.
// Delays are between attempts (no leading wait, no post-final wait).
const RETRY_DELAYS_MS = [1000, 3000, 7000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Log an agent action to both console and Supabase.
 * @param {object} entry
 * @param {string} entry.campusId - Campus UUID (null for system-level logs)
 * @param {string} entry.agent - Agent name: "pipeline", "qa", "research", "performance", "scripting", "server"
 * @param {string} entry.action - What the agent did
 * @param {string} [entry.status="success"] - "success", "error", "warning"
 * @param {object} [entry.payload] - Input/output data
 * @param {string} [entry.errorMessage] - Error message if status is "error"
 */
async function log({ campusId = null, agent, action, status = 'success', payload = null, errorMessage = null }) {
  // Always log to console first — this is available immediately via `pm2 logs`
  const prefix = `[${agent}] [${status.toUpperCase()}]`;
  if (status === 'error') {
    console.error(`${prefix} ${action}`, errorMessage || '', payload ? JSON.stringify(payload).slice(0, 500) : '');
  } else {
    console.log(`${prefix} ${action}`);
  }

  // Then persist to Supabase — do not let DB write failure crash the caller.
  // Retry with backoff so boot-time fetch failures (network stack not yet
  // ready after reboot) do not silently drop telemetry.
  const row = {
    campus_id: campusId,
    agent_name: agent,
    action,
    status,
    payload: payload ? payload : undefined,
    error_message: errorMessage,
  };

  let lastError = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      // Re-read .supabase on each attempt so a test or runtime caller can swap
      // the client without reloading this module.
      const { error } = await supabaseModule.supabase.from('agent_logs').insert(row);
      if (!error) return;
      lastError = error;
    } catch (err) {
      lastError = err;
    }

    // Sleep only if we have another attempt to try.
    if (attempt < RETRY_DELAYS_MS.length - 1) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  // All attempts exhausted — fall back to console only. Never throw.
  const message = lastError?.message || String(lastError);
  console.error(`[logger] Failed to write to agent_logs after ${RETRY_DELAYS_MS.length} attempts: ${message}`);
}

module.exports = { log, RETRY_DELAYS_MS };
