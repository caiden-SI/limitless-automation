// Dropbox webhook handler — receives file change notifications.
// Challenge verification handled in server.js (GET route).
// File additions to [FOOTAGE] folders trigger Pipeline Agent status changes.
// NOTE: 1-hour delay recommended after footage upload before triggering editing pipeline.

const crypto = require('crypto');
const { log } = require('../lib/logger');

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
  try {
    // Verify webhook signature
    const signature = req.headers['x-dropbox-signature'];
    if (!verifySignature(req.rawBody, signature)) {
      await log({ agent: 'server', action: 'dropbox_webhook_rejected', status: 'warning', payload: { reason: 'invalid_signature' } });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Dropbox sends a list of accounts that have changes — we then poll for specifics
    const { list_folder } = req.body;

    await log({
      agent: 'pipeline',
      action: 'dropbox_webhook_received',
      payload: { accounts: list_folder?.accounts },
    });

    // TODO: For each changed account:
    // 1. Call Dropbox /files/list_folder to identify which folders changed
    // 2. Check if change is in a [FOOTAGE] subfolder
    // 3. If file count went from 0 → >0, schedule status change after 1-hour delay
    // 4. Route to Pipeline Agent

    res.status(200).json({ received: true });
  } catch (err) {
    await log({
      agent: 'server',
      action: 'dropbox_webhook_error',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack },
    });
    res.status(500).json({ error: 'Handler failed' });
  }
}

module.exports = handler;
