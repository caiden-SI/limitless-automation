// ClickUp webhook handler — receives taskStatusUpdated and taskCreated events.
// Verifies signature header before processing. Routes to Pipeline Agent.

const crypto = require('crypto');
const { log } = require('../lib/logger');

/**
 * Verify ClickUp webhook signature.
 * @param {Buffer} rawBody - Raw request body
 * @param {string} signature - X-Signature header value
 * @returns {boolean}
 */
function verifySignature(rawBody, signature) {
  const secret = process.env.CLICKUP_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function handler(req, res) {
  try {
    // Verify webhook signature
    const signature = req.headers['x-signature'];
    if (!verifySignature(req.rawBody, signature)) {
      await log({ agent: 'server', action: 'clickup_webhook_rejected', status: 'warning', payload: { reason: 'invalid_signature' } });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { event, task_id: taskId, history_items: historyItems } = req.body;

    await log({
      agent: 'pipeline',
      action: `clickup_webhook_received: ${event}`,
      payload: { taskId, event },
    });

    // Route by event type
    switch (event) {
      case 'taskStatusUpdated': {
        // TODO: Extract new status from history_items, route to Pipeline Agent
        // const newStatus = historyItems?.[0]?.after?.status;
        // await pipelineAgent.handleStatusChange(taskId, newStatus);
        break;
      }

      case 'taskCreated': {
        // TODO: Route to Pipeline Agent for any auto-setup on new tasks
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
