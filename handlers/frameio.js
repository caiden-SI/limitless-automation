// Frame.io webhook handler — receives comment and asset events.
// Comments on a review asset trigger Pipeline Agent to set NEEDS REVISIONS in ClickUp.
// NOTE: Frame.io was acquired by Adobe — v4 API is current. Verify comment webhook
// behavior before building QA trigger.

const crypto = require('crypto');
const { log } = require('../lib/logger');

/**
 * Verify Frame.io webhook signature.
 * Frame.io v4 signs webhooks with HMAC-SHA256(secret, rawBody) sent in X-Frameio-Signature as hex.
 * NOTE: Adobe acquired Frame.io — verify header name if v4 API behavior changes.
 * @param {Buffer} rawBody - Raw request body
 * @param {string} signature - X-Frameio-Signature header value
 * @returns {boolean}
 */
function verifySignature(rawBody, signature) {
  const secret = process.env.FRAMEIO_WEBHOOK_SECRET;
  if (!secret || !signature || !rawBody) return false;

  const expected = crypto
    .createHmac('sha256', secret)
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
    const signature = req.headers['x-frameio-signature'];
    if (!verifySignature(req.rawBody, signature)) {
      await log({ agent: 'server', action: 'frameio_webhook_rejected', status: 'warning', payload: { reason: 'invalid_signature' } });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { type, resource } = req.body;

    await log({
      agent: 'pipeline',
      action: `frameio_webhook_received: ${type}`,
      payload: { type, assetId: resource?.id },
    });

    // Route by event type
    switch (type) {
      case 'comment.created': {
        // TODO: Look up video by Frame.io asset ID in Supabase
        // If found, route to Pipeline Agent to set NEEDS REVISIONS in ClickUp
        break;
      }

      default:
        await log({ agent: 'server', action: `frameio_unhandled_event: ${type}`, status: 'warning' });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    await log({
      agent: 'server',
      action: 'frameio_webhook_error',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack },
    });
    res.status(500).json({ error: 'Handler failed' });
  }
}

module.exports = handler;
