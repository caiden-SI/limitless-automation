// Frame.io webhook handler — receives comment.created and other asset events.
//
// Events are durably recorded in webhook_inbox before returning 200.
// Processing happens asynchronously. Failures update the inbox row
// instead of being silently dropped (same pattern as handlers/clickup.js).
//
// comment.created flow:
//   1. Webhook arrives with asset.id on the payload
//   2. Look up videos by frameio_asset_id (populated upstream — TODO)
//   3. Route to pipeline.handleReviewComment — sets ClickUp task to `waiting`
//
// NOTE: Frame.io was acquired by Adobe. Decision 2026-04-02 commits to v2 API
// and v2 webhook shape. When migrating to v4 (Adobe I/O Events), the signature
// header and payload shape may change.

const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const pipeline = require('../agents/pipeline');

/**
 * Verify Frame.io webhook signature.
 * Frame.io signs webhooks with HMAC-SHA256(secret, rawBody) sent in X-Frameio-Signature as hex.
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
  // Verify webhook signature
  const signature = req.headers['x-frameio-signature'];
  if (!verifySignature(req.rawBody, signature)) {
    await log({ agent: 'server', action: 'frameio_webhook_rejected', status: 'warning', payload: { reason: 'invalid_signature' } });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { type } = req.body || {};

  // Durably record the event before acknowledging
  let inboxId;
  try {
    const { data: row, error: insertErr } = await supabase
      .from('webhook_inbox')
      .insert({
        event_type: `frameio:${type || 'unknown'}`,
        payload: req.body,
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;
    inboxId = row.id;
  } catch (err) {
    // If inbox insert fails, reject so Frame.io retries
    await log({
      agent: 'server',
      action: 'webhook_inbox_insert_failed',
      status: 'error',
      errorMessage: err.message,
      payload: { source: 'frameio' },
    });
    return res.status(500).json({ error: 'Failed to record event' });
  }

  // Acknowledge — the event is now durable in webhook_inbox
  res.status(200).json({ received: true });

  // Process asynchronously
  try {
    await processFrameioEvent(req.body, inboxId);

    await supabase
      .from('webhook_inbox')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', inboxId);
  } catch (err) {
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
      action: 'frameio_webhook_error',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack, inboxId },
    });
  }
}

/**
 * Route a Frame.io event to the right pipeline action.
 * Currently only comment.created is handled.
 */
async function processFrameioEvent(body, inboxId) {
  const { type } = body || {};
  const assetId = body?.asset?.id || null;

  await log({
    agent: 'pipeline',
    action: `frameio_webhook_received: ${type}`,
    payload: { type, assetId, inboxId },
  });

  switch (type) {
    case 'comment.created':
      await handleCommentCreated(body, inboxId);
      break;

    default:
      await log({
        agent: 'server',
        action: `frameio_unhandled_event: ${type}`,
        status: 'warning',
        payload: { inboxId },
      });
  }
}

/**
 * comment.created → set the associated ClickUp task to `waiting`.
 * Matches the video by frameio_asset_id. If no match, log and skip —
 * upstream that populates frameio_asset_id is not yet wired.
 */
async function handleCommentCreated(body, inboxId) {
  const assetId = body?.asset?.id || null;

  if (!assetId) {
    await log({
      agent: 'server',
      action: 'frameio_comment_no_asset_id',
      status: 'warning',
      payload: { inboxId, payloadKeys: Object.keys(body || {}) },
    });
    return;
  }

  const { data: video, error } = await supabase
    .from('videos')
    .select('id, clickup_task_id, campus_id')
    .eq('frameio_asset_id', assetId)
    .maybeSingle();

  if (error) throw new Error(`Supabase query failed (videos): ${error.message}`);

  if (!video) {
    await log({
      agent: 'pipeline',
      action: 'frameio_comment_no_matching_video',
      status: 'warning',
      payload: { assetId, inboxId },
    });
    return;
  }

  if (!video.clickup_task_id) {
    await log({
      campusId: video.campus_id,
      agent: 'pipeline',
      action: 'frameio_comment_video_missing_task_id',
      status: 'warning',
      payload: { videoId: video.id, assetId, inboxId },
    });
    return;
  }

  await pipeline.handleReviewComment(video.clickup_task_id, video.campus_id);
}

module.exports = handler;
