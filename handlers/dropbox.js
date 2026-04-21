// Dropbox webhook handler — receives file change notifications.
// Challenge verification handled in server.js (GET route).
//
// Events are durably recorded in webhook_inbox before returning 200.
// Processing happens asynchronously. Failures update the inbox row
// instead of being silently dropped (same pattern as handlers/clickup.js).
//
// Detection strategy: Dropbox webhooks carry account IDs only, not paths.
// On each webhook, delegate to pipeline.scanPendingFootage which enforces
// the 1-hour stabilization window before advancing any video to
// READY FOR EDITING. A 15-minute cron (registered in server.js) catches
// videos whose delay elapses without a follow-up Dropbox webhook firing.

const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const pipeline = require('../agents/pipeline');

/**
 * Verify Dropbox webhook signature.
 * Dropbox signs webhooks with HMAC-SHA256(app_secret, rawBody) sent in X-Dropbox-Signature as hex.
 * @param {Buffer} rawBody - Raw request body
 * @param {string} signature - X-Dropbox-Signature header value
 * @returns {boolean}
 */
function verifySignature(rawBody, signature) {
  const appSecret = process.env.DROPBOX_APP_SECRET;
  if (!appSecret || !signature || !rawBody) return false;

  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

async function handler(req, res) {
  // Verify webhook signature
  const signature = req.headers['x-dropbox-signature'];
  if (!verifySignature(req.rawBody, signature)) {
    await log({ agent: 'server', action: 'dropbox_webhook_rejected', status: 'warning', payload: { reason: 'invalid_signature' } });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Durably record the event before acknowledging
  let inboxId;
  try {
    const { data: row, error: insertErr } = await supabase
      .from('webhook_inbox')
      .insert({
        event_type: 'dropbox_file_change',
        payload: req.body,
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;
    inboxId = row.id;
  } catch (err) {
    // If inbox insert fails, reject so Dropbox retries
    await log({
      agent: 'server',
      action: 'webhook_inbox_insert_failed',
      status: 'error',
      errorMessage: err.message,
      payload: { source: 'dropbox' },
    });
    return res.status(500).json({ error: 'Failed to record event' });
  }

  // Acknowledge — the event is now durable in webhook_inbox
  res.status(200).json({ received: true });

  // Process asynchronously
  try {
    await processDropboxChange(req.body, inboxId);

    await supabase
      .from('webhook_inbox')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', inboxId);
  } catch (err) {
    // Per scripting-agent.md edge cases: log full error BEFORE recovery.
    // No per-agent auto-fix — global self-healing handler owns diagnosis.
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
      action: 'dropbox_webhook_error',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack, inboxId },
    });
  }
}

/**
 * Log receipt and delegate the scan to pipeline.scanPendingFootage.
 * Scan-level errors (e.g. the Supabase query itself throws) propagate
 * and mark the webhook_inbox row failed; per-video errors are handled
 * inside scanPendingFootage.
 */
async function processDropboxChange(body, inboxId) {
  await log({
    agent: 'pipeline',
    action: 'dropbox_webhook_received',
    payload: { accounts: body?.list_folder?.accounts, inboxId },
  });

  const counts = await pipeline.scanPendingFootage();

  await log({
    agent: 'pipeline',
    action: 'dropbox_scan_complete',
    payload: { inboxId, ...counts, trigger: 'webhook' },
  });
}

module.exports = handler;
