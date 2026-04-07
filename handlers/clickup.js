// ClickUp webhook handler — receives taskStatusUpdated and taskCreated events.
// Verifies signature header before processing. Routes to Pipeline Agent.
//
// Events are durably recorded in webhook_inbox before returning 200.
// Processing happens asynchronously. Failures update the inbox row
// instead of being silently dropped.

const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const pipeline = require('../agents/pipeline');

/**
 * Verify ClickUp webhook signature.
 * ClickUp signs webhooks with HMAC-SHA256(secret, rawBody) sent in X-Signature as hex.
 * @param {Buffer} rawBody - Raw request body
 * @param {string} signature - X-Signature header value
 * @returns {boolean}
 */
function verifySignature(rawBody, signature) {
  const secret = process.env.CLICKUP_WEBHOOK_SECRET;
  if (!secret || !signature || !rawBody) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // timingSafeEqual throws on length mismatch — guard against malformed signatures
  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

async function handler(req, res) {
  // Verify webhook signature — skip if secret is not configured
  const signature = req.headers['x-signature'];
  const secret = process.env.CLICKUP_WEBHOOK_SECRET;
  if (secret) {
    if (!verifySignature(req.rawBody, signature)) {
      await log({ agent: 'server', action: 'clickup_webhook_rejected', status: 'warning', payload: { reason: 'invalid_signature' } });
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const { event, task_id: taskId, history_items: historyItems } = req.body;

  // Durably record the event before acknowledging
  let inboxId;
  try {
    const { data: row, error: insertErr } = await supabase
      .from('webhook_inbox')
      .insert({
        event_type: event || 'unknown',
        payload: req.body,
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;
    inboxId = row.id;
  } catch (err) {
    // If inbox insert fails, reject the webhook so ClickUp retries
    await log({
      agent: 'server',
      action: 'webhook_inbox_insert_failed',
      status: 'error',
      errorMessage: err.message,
    });
    return res.status(500).json({ error: 'Failed to record event' });
  }

  // Acknowledge — the event is now durable in webhook_inbox
  res.status(200).json({ received: true });

  // Process asynchronously
  try {
    await log({
      agent: 'pipeline',
      action: `clickup_webhook_received: ${event}`,
      payload: { taskId, event, inboxId },
    });

    switch (event) {
      case 'taskStatusUpdated': {
        const newStatus = historyItems?.[0]?.after?.status;
        if (!newStatus) {
          await log({ agent: 'pipeline', action: 'clickup_status_missing', status: 'warning', payload: { taskId, historyItems } });
          break;
        }
        // Pass null for campusId — resolveTask will look up the task's list
        // and resolve campus from clickup_list_id in the campuses table.
        await pipeline.handleStatusChange(taskId, newStatus, null);
        break;
      }

      case 'taskCreated': {
        // No automated action on task creation yet — scripting agent creates tasks directly
        break;
      }

      default:
        await log({ agent: 'server', action: `clickup_unhandled_event: ${event}`, status: 'warning' });
    }

    // Mark as processed
    await supabase
      .from('webhook_inbox')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', inboxId);

  } catch (err) {
    // Mark as failed — event is preserved for retry/investigation
    await supabase
      .from('webhook_inbox')
      .update({
        failed_at: new Date().toISOString(),
        error_message: err.message,
        retry_count: 1,
      })
      .eq('id', inboxId);

    await log({
      agent: 'server',
      action: 'clickup_webhook_error',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack, inboxId },
    });
  }
}

module.exports = handler;
