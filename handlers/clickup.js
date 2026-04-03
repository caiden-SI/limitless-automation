// ClickUp webhook handler — receives taskStatusUpdated and taskCreated events.
// Verifies signature header before processing. Routes to Pipeline Agent.

const crypto = require('crypto');
const { log } = require('../lib/logger');
const clickup = require('../lib/clickup');
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
  try {
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

    await log({
      agent: 'pipeline',
      action: `clickup_webhook_received: ${event}`,
      payload: { taskId, event },
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

    res.status(200).json({ received: true });
  } catch (err) {
    await log({
      agent: 'server',
      action: 'clickup_webhook_error',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack },
    });
    res.status(500).json({ error: 'Handler failed' });
  }
}

module.exports = handler;
