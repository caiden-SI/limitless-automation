// Cron scheduler — manages recurring agent jobs.
// Uses node-cron for scheduling. All jobs log start/end to agent_logs.

const cron = require('node-cron');
const { log } = require('./logger');

const jobs = new Map();

/**
 * Register a cron job.
 * @param {string} name - Unique job name
 * @param {string} schedule - Cron expression (e.g. "0 6 * * *" for daily at 6 AM)
 * @param {Function} fn - Async function to execute
 */
function register(name, schedule, fn) {
  if (jobs.has(name)) {
    jobs.get(name).stop();
  }

  const task = cron.schedule(schedule, async () => {
    const startTime = Date.now();
    try {
      await log({ agent: 'scheduler', action: `job_started: ${name}` });
      await fn();
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      await log({ agent: 'scheduler', action: `job_complete: ${name}`, payload: { durationSecs: duration } });
    } catch (err) {
      await log({
        agent: 'scheduler',
        action: `job_error: ${name}`,
        status: 'error',
        errorMessage: err.message,
        payload: { stack: err.stack },
      });
    }
  });

  jobs.set(name, task);
  console.log(`[scheduler] Registered: "${name}" — ${schedule}`);
}

/**
 * Stop a specific job.
 */
function stop(name) {
  if (jobs.has(name)) {
    jobs.get(name).stop();
    jobs.delete(name);
    console.log(`[scheduler] Stopped: "${name}"`);
  }
}

/**
 * Stop all jobs.
 */
function stopAll() {
  for (const [name, task] of jobs) {
    task.stop();
    console.log(`[scheduler] Stopped: "${name}"`);
  }
  jobs.clear();
}

/**
 * List registered jobs.
 */
function list() {
  return Array.from(jobs.keys());
}

module.exports = { register, stop, stopAll, list };
