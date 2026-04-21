// Self-healing error handler — implements CLAUDE.md error contract.
// Spec: workflows/self-healing-handler.md
//
// Contract:
//   1. Log the original error to agent_logs with status "error" BEFORE any recovery.
//   2. Check for a self_heal_attempted entry for the same (agent, action) in the
//      last 5 minutes. If one exists, skip diagnosis and escalate to ClickUp alert.
//   3. Ask Claude to diagnose. The Claude call is wrapped so an Anthropic outage
//      cannot re-throw into the outer entry point.
//   4. Execute ONE recovery action from a bounded allow-list: retry,
//      refresh_dropbox_token, skip_record, mark_waiting, none.
//   5. On failure, post a formatted ClickUp comment to the associated task.
//   6. handle() never throws. If anything inside it throws, log self_heal_crashed
//      and return. PM2 is the last line of defense.

const { log } = require('./logger');
// Import as module ref (not destructure) so tests can monkey-patch claude.askJson.
const claude = require('./claude');
const { supabase } = require('./supabase');
const clickup = require('./clickup');
const dropbox = require('./dropbox');

const WINDOW_MINUTES = 5;
const RETRY_DELAY_MS = 2000;

const ALLOWED_CLASSIFICATIONS = ['transient', 'auth', 'data', 'bug', 'unknown'];
const ALLOWED_CONFIDENCES = ['high', 'medium', 'low'];
const ALLOWED_RECOVERY_ACTIONS = ['retry', 'refresh_dropbox_token', 'skip_record', 'mark_waiting', 'none'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stackHead(err, lines = 10) {
  if (!err || !err.stack) return null;
  return err.stack.split('\n').slice(0, lines).join('\n');
}

function safeArgs(args) {
  try {
    const s = JSON.stringify(args, (_k, v) => {
      if (typeof v === 'string' && /token|secret|key|password/i.test(String(_k || ''))) return '[redacted]';
      return v;
    });
    return s && s.length > 2048 ? s.slice(0, 2048) + '…' : s;
  } catch {
    return '[unserializable]';
  }
}

// ── Claude diagnosis ────────────────────────────────────────

const DIAGNOSIS_SYSTEM = `You diagnose errors from the Limitless Media Agency automation system.

Return strict JSON ONLY — no prose, no markdown fences — matching this exact schema:

{
  "classification": "transient | auth | data | bug | unknown",
  "confidence": "high | medium | low",
  "recovery_action": "retry | refresh_dropbox_token | skip_record | mark_waiting | none",
  "recovery_params": {},
  "human_summary": "one sentence describing the failure for a human operator"
}

ALLOWED recovery_action values and when to pick them:
- "retry" — transient 5xx, rate limit, network timeout. Safe to try the same call again after a short delay.
- "refresh_dropbox_token" — Dropbox 401, expired_access_token, or other stale-token signal. Refresh and retry.
- "skip_record" — one input record (one calendar event, one ClickUp task, one scrape) is malformed but the batch should continue.
- "mark_waiting" — a video cannot proceed without human intervention. Sets videos.status = WAITING and marks the ClickUp task waiting. Only valid when context includes a videoId.
- "none" — anything you do not confidently recognize. ALWAYS pick "none" when unsure.

CONFIDENCE rules:
- "high" — the error message clearly matches one of the patterns above.
- "medium" — the error is plausibly one of the patterns but ambiguous.
- "low" — uncertain. Recovery will NOT run on "low" confidence; the handler will escalate to a human alert instead.

If the error looks like a code bug (logic error, reference error, type error) or you do not recognize it, return classification "bug" or "unknown" with confidence "low" and recovery_action "none".`;

function buildDiagnosisPrompt(error, context) {
  const parts = [
    `AGENT: ${context.agent}`,
    `ACTION: ${context.action}`,
  ];
  if (context.taskId) parts.push(`TASK_ID: ${context.taskId}`);
  if (context.videoId) parts.push(`VIDEO_ID: ${context.videoId}`);
  if (context.campusId) parts.push(`CAMPUS_ID: ${context.campusId}`);
  if (context.payload) parts.push(`CONTEXT_PAYLOAD: ${safeArgs(context.payload)}`);

  parts.push('', 'ERROR MESSAGE:', error.message || String(error));

  const stack = stackHead(error);
  if (stack) parts.push('', 'STACK (first 10 lines):', stack);

  return parts.join('\n');
}

async function diagnose(error, context) {
  try {
    const raw = await claude.askJson({
      system: DIAGNOSIS_SYSTEM,
      prompt: buildDiagnosisPrompt(error, context),
      maxTokens: 512,
    });
    return validateDiagnosis(raw);
  } catch (err) {
    // Anthropic down, network failure, malformed JSON — fail safe.
    await log({
      campusId: context.campusId || null,
      agent: context.agent,
      action: 'self_heal_claude_error',
      status: 'error',
      errorMessage: err.message,
      payload: { originalAction: context.action },
    });
    return {
      classification: 'unknown',
      confidence: 'low',
      recovery_action: 'none',
      recovery_params: {},
      human_summary: 'Claude diagnosis unavailable',
    };
  }
}

function validateDiagnosis(raw) {
  const fallback = {
    classification: 'unknown',
    confidence: 'low',
    recovery_action: 'none',
    recovery_params: {},
    human_summary: 'Malformed diagnosis response',
  };
  if (!raw || typeof raw !== 'object') return fallback;
  if (!ALLOWED_CLASSIFICATIONS.includes(raw.classification)) return fallback;
  if (!ALLOWED_CONFIDENCES.includes(raw.confidence)) return fallback;
  if (!ALLOWED_RECOVERY_ACTIONS.includes(raw.recovery_action)) return fallback;
  const params = raw.recovery_params && typeof raw.recovery_params === 'object' ? raw.recovery_params : {};
  const summary = typeof raw.human_summary === 'string' && raw.human_summary.trim() ? raw.human_summary : 'No summary provided';
  return { ...raw, recovery_params: params, human_summary: summary };
}

// ── Recovery dispatcher ────────────────────────────────────────

const RECOVERY_ACTIONS = {
  async retry({ retry }) {
    if (!retry) throw new Error('retry recovery unavailable: no retry callback passed to handle()');
    await sleep(RETRY_DELAY_MS);
    return retry();
  },
  async refresh_dropbox_token({ retry }) {
    await dropbox.refreshAccessToken();
    if (retry) return retry();
    return { refreshed: true };
  },
  async skip_record({ params }) {
    // Intentionally a no-op — the "recovery" here is declaring the record unrecoverable.
    // handle() logs self_heal_attempted with succeeded=true so the caller treats it as handled.
    return { skipped: params?.recordId ?? true };
  },
  async mark_waiting({ context }) {
    if (!context.videoId) {
      throw new Error('mark_waiting requires videoId on context');
    }
    const { error: uErr } = await supabase
      .from('videos')
      .update({ status: 'WAITING', updated_at: new Date().toISOString() })
      .eq('id', context.videoId);
    if (uErr) throw new Error(`Supabase update failed (videos.status): ${uErr.message}`);

    const { data } = await supabase
      .from('videos')
      .select('clickup_task_id')
      .eq('id', context.videoId)
      .maybeSingle();

    if (data?.clickup_task_id) {
      await clickup.updateTask(data.clickup_task_id, { status: 'waiting' });
    }
    return { markedWaiting: true, taskId: data?.clickup_task_id || null };
  },
  none: null,
};

// ── Dedup window ────────────────────────────────────────

async function wasRecentlyAttempted(context) {
  try {
    const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('agent_logs')
      .select('id')
      .eq('agent_name', context.agent)
      .eq('action', 'self_heal_attempted')
      .eq('payload->>originalAction', context.action)
      .gte('created_at', since)
      .limit(1);

    if (error) {
      // Query failure is non-fatal — fail open so we still attempt diagnosis.
      // Logged for visibility but do not block the recovery flow.
      console.error('[self-heal] dedup query failed:', error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    console.error('[self-heal] dedup query threw:', err.message);
    return false;
  }
}

// ── ClickUp alert ────────────────────────────────────────

function formatAlert(context, error, diagnosis, attempt) {
  const lines = [
    `:rotating_light: **Automation self-heal: unresolved failure**`,
    ``,
    `**Agent:** ${context.agent}`,
    `**Action:** ${context.action}`,
    `**Error:** ${error.message || String(error)}`,
  ];

  if (diagnosis) {
    lines.push(`**Diagnosis:** ${diagnosis.classification} / ${diagnosis.confidence} — ${diagnosis.human_summary}`);
  }

  if (attempt) {
    const status = attempt.succeeded ? 'succeeded' : 'failed';
    lines.push(`**Recovery attempted:** ${attempt.recoveryAction} — ${status}${attempt.error ? ` (${attempt.error})` : ''}`);
  } else {
    lines.push(`**Recovery attempted:** none`);
  }

  lines.push('', `See \`agent_logs\` filtered by \`agent_name = "${context.agent}"\` for full context.`);

  return lines.join('\n');
}

async function escalate(context, error, diagnosis, attempt) {
  let taskId = context.taskId || null;

  if (!taskId && context.videoId) {
    try {
      const { data } = await supabase
        .from('videos')
        .select('clickup_task_id')
        .eq('id', context.videoId)
        .maybeSingle();
      if (data?.clickup_task_id) taskId = data.clickup_task_id;
    } catch (_err) {
      // swallow — fall through to skipped-alert branch
    }
  }

  if (!taskId) {
    await log({
      campusId: context.campusId || null,
      agent: context.agent,
      action: 'self_heal_alert_skipped',
      status: 'warning',
      payload: { originalAction: context.action, reason: 'no_task_id_resolvable' },
    });
    return;
  }

  try {
    await clickup.addComment(taskId, formatAlert(context, error, diagnosis, attempt));
    await log({
      campusId: context.campusId || null,
      agent: context.agent,
      action: 'self_heal_alert_sent',
      payload: { originalAction: context.action, taskId },
    });
  } catch (err) {
    await log({
      campusId: context.campusId || null,
      agent: context.agent,
      action: 'self_heal_alert_failed',
      status: 'error',
      errorMessage: err.message,
      payload: { originalAction: context.action, taskId },
    });
  }
}

// ── Main handler ────────────────────────────────────────

/**
 * Handle an error. Never throws — the outer entry point may rely on this.
 *
 * @param {Error} error
 * @param {object} context - { agent, action, taskId?, videoId?, campusId?, payload? }
 * @param {object} [options]
 * @param {Function} [options.retry] - async () => <result>. If Claude recommends retry, this is invoked once after a 2s delay.
 */
async function handle(error, context, options = {}) {
  try {
    if (!context || !context.agent || !context.action) {
      // Malformed call — log and return without blowing up.
      await log({
        agent: 'self-heal',
        action: 'self_heal_bad_context',
        status: 'error',
        errorMessage: 'handle() called without agent+action context',
        payload: { errorMessage: error?.message },
      });
      return;
    }

    // Step 1: log original error BEFORE any recovery.
    await log({
      campusId: context.campusId || null,
      agent: context.agent,
      action: context.action,
      status: 'error',
      errorMessage: error.message || String(error),
      payload: {
        ...(context.payload || {}),
        taskId: context.taskId,
        videoId: context.videoId,
        stack: stackHead(error),
      },
    });

    // Step 2: dedup window.
    if (await wasRecentlyAttempted(context)) {
      await log({
        campusId: context.campusId || null,
        agent: context.agent,
        action: 'self_heal_window_hit',
        status: 'warning',
        payload: { originalAction: context.action, windowMinutes: WINDOW_MINUTES },
      });
      await escalate(context, error, null, null);
      return;
    }

    // Step 3-4: Claude diagnosis (fail-safe).
    const diagnosis = await diagnose(error, context);

    // Step 5: skip recovery on low confidence or "none".
    if (diagnosis.recovery_action === 'none' || diagnosis.confidence === 'low') {
      await escalate(context, error, diagnosis, null);
      return;
    }

    // Step 6: execute recovery.
    const fn = RECOVERY_ACTIONS[diagnosis.recovery_action];
    if (!fn) {
      // validateDiagnosis should have caught this, belt-and-braces check.
      await escalate(context, error, diagnosis, null);
      return;
    }

    let attempt;
    try {
      await fn({ retry: options.retry, params: diagnosis.recovery_params, context });
      attempt = { recoveryAction: diagnosis.recovery_action, succeeded: true };
      await log({
        campusId: context.campusId || null,
        agent: context.agent,
        action: 'self_heal_attempted',
        payload: {
          originalAction: context.action,
          diagnosis,
          recoveryAction: diagnosis.recovery_action,
          succeeded: true,
        },
      });
      return;
    } catch (recErr) {
      attempt = { recoveryAction: diagnosis.recovery_action, succeeded: false, error: recErr.message };
      await log({
        campusId: context.campusId || null,
        agent: context.agent,
        action: 'self_heal_attempted',
        status: 'error',
        errorMessage: recErr.message,
        payload: {
          originalAction: context.action,
          diagnosis,
          recoveryAction: diagnosis.recovery_action,
          succeeded: false,
        },
      });
    }

    // Recovery failed — escalate.
    await escalate(context, error, diagnosis, attempt);
  } catch (handlerErr) {
    // Outermost guard — the handler itself crashed. Log and move on.
    try {
      await log({
        campusId: context?.campusId || null,
        agent: context?.agent || 'self-heal',
        action: 'self_heal_crashed',
        status: 'error',
        errorMessage: handlerErr.message,
        payload: { originalAction: context?.action, stack: stackHead(handlerErr) },
      });
    } catch (_) {
      console.error('[self-heal] crashed while logging its own crash:', handlerErr.message);
    }
  }
}

/**
 * Higher-order wrap for opt-in self-healing. Cron-invoked functions that don't
 * need rich context can wrap their top-level fn to get automatic retry support.
 *
 * @param {string} agent
 * @param {string} action
 * @param {Function} fn - async function to wrap
 */
function wrap(agent, action, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      await handle(
        err,
        { agent, action, payload: { args: safeArgs(args) } },
        { retry: () => fn(...args) }
      );
      return undefined;
    }
  };
}

module.exports = {
  handle,
  wrap,
  // Exposed for tests
  validateDiagnosis,
  RECOVERY_ACTIONS,
  WINDOW_MINUTES,
  DIAGNOSIS_SYSTEM,
};
