// Logger — dual output to console (PM2) and Supabase agent_logs table.
// Error handling rule: log full error context to agent_logs BEFORE attempting recovery.

const { supabase } = require('./supabase');

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

  // Then persist to Supabase — do not let DB write failure crash the caller
  try {
    const { error } = await supabase.from('agent_logs').insert({
      campus_id: campusId,
      agent_name: agent,
      action,
      status,
      payload: payload ? payload : undefined,
      error_message: errorMessage,
    });

    if (error) {
      console.error(`[logger] Failed to write to agent_logs: ${error.message}`);
    }
  } catch (err) {
    console.error(`[logger] Supabase write crashed: ${err.message}`);
  }
}

module.exports = { log };
