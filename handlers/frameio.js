// Frame.io v4 webhook handler. Migrated from v2 on 2026-05-08.
//
// Events are durably recorded in webhook_inbox before returning 200.
// Processing happens asynchronously. Failures update the inbox row
// instead of being silently dropped (same pattern as handlers/clickup.js).
//
// V4 changes from V2:
//   - Signature: was `HMAC-SHA256(secret, body)` hex in X-Frameio-Signature.
//     Now `v0=` prefix + HMAC-SHA256(secret, `v0:{timestamp}:{body}`).
//     Also requires X-Frameio-Request-Timestamp with a 500-second
//     drift check to prevent replay.
//   - Payload: was body.asset.id at top level. Now body.resource.id
//     with body.resource.type === 'file' (or 'comment', etc.).
//   - team_id is no longer in payload (account.id, workspace.id,
//     project.id are present instead).
//
// comment.created flow:
//   1. v4 webhook arrives with body.resource.id (file UUID)
//   2. Look up videos by frameio_asset_id (populated upstream by
//      pipeline.syncFrameioLink on the `edited` status transition —
//      see agents/pipeline.js)
//   3. Route to pipeline.handleReviewComment — sets ClickUp task to `waiting`

const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const pipeline = require('../agents/pipeline');

// 500 seconds matches the Frame.io v4 sample code's drift tolerance.
// (The narrative docs say 5 minutes, but the canonical Python sample
// uses 500. Going with the code path's stricter / authoritative number.)
const SIGNATURE_TIMESTAMP_DRIFT_SECONDS = 500;

/**
 * Verify a Frame.io v4 webhook signature.
 *
 * Algorithm:
 *   message = "v0:" + timestamp + ":" + rawBody
 *   expected = "v0=" + hex(HMAC-SHA256(secret, message))
 *   compare with X-Frameio-Signature using timing-safe equal
 *
 * Also validates the timestamp is within SIGNATURE_TIMESTAMP_DRIFT_SECONDS
 * of the current time (replay-attack guard).
 */
function verifySignature(rawBody, signature, timestamp) {
  const secret = process.env.FRAMEIO_WEBHOOK_SECRET;
  if (!secret || !signature || !timestamp || !rawBody) return false;

  // Replay guard: timestamp must be within drift window of now.
  const reqTime = Number(timestamp);
  if (!Number.isFinite(reqTime)) return false;
  const driftSeconds = Math.abs(Math.floor(Date.now() / 1000) - reqTime);
  if (driftSeconds > SIGNATURE_TIMESTAMP_DRIFT_SECONDS) return false;

  // Compute expected signature.
  const message = `v0:${timestamp}:${rawBody}`;
  const computedHex = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
  const expected = `v0=${computedHex}`;

  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

async function handler(req, res) {
  const signature = req.headers['x-frameio-signature'];
  const timestamp = req.headers['x-frameio-request-timestamp'];

  if (!verifySignature(req.rawBody, signature, timestamp)) {
    await log({
      agent: 'server',
      action: 'frameio_webhook_rejected',
      status: 'warning',
      payload: { reason: 'invalid_signature_or_timestamp' },
    });
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
 * Route a Frame.io v4 event to the right pipeline action.
 * Currently only comment.created is handled.
 */
async function processFrameioEvent(body, inboxId) {
  const { type } = body || {};
  // v4 puts the resource ID at body.resource.id with body.resource.type
  // identifying what kind of resource. For comment.created the resource
  // is the comment itself; we want the file the comment was made on,
  // which v4 does not surface directly in the webhook payload — see
  // the warning in the v4 docs:
  //   "We do not include any additional information beyond the
  //    resource ID about the subscribed resource."
  // So for comment.created we must call back to the API to fetch the
  // comment and read its parent file_id. Wire that lookup in
  // handleCommentCreated.
  const resourceId = body?.resource?.id || null;
  const resourceType = body?.resource?.type || null;

  await log({
    agent: 'pipeline',
    action: `frameio_webhook_received: ${type}`,
    payload: { type, resourceId, resourceType, inboxId },
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
 *
 * v4 doesn't include the parent file_id directly in the webhook
 * payload — only the comment's own resource ID. To find the matching
 * video, we call back to /v4/comments/{id} to get its parent file ID,
 * then look that file up in our videos table by frameio_asset_id.
 *
 * If no match: log and skip (either the editor has not yet pasted the
 * Frame.io URL into ClickUp, or the URL was opaque and the asset UUID
 * could not be extracted).
 */
async function handleCommentCreated(body, inboxId) {
  const commentId = body?.resource?.id || null;

  if (!commentId) {
    await log({
      agent: 'server',
      action: 'frameio_comment_no_resource_id',
      status: 'warning',
      payload: { inboxId, payloadKeys: Object.keys(body || {}) },
    });
    return;
  }

  // Look up the comment to find its parent file ID.
  const { getAccessToken } = require('../lib/frameio-oauth');
  const token = await getAccessToken();
  const commentRes = await fetch(`https://api.frame.io/v4/comments/${commentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!commentRes.ok) {
    const errText = await commentRes.text().catch(() => '');
    await log({
      agent: 'pipeline',
      action: 'frameio_comment_lookup_failed',
      status: 'error',
      errorMessage: `comment lookup ${commentRes.status}: ${errText.slice(0, 200)}`,
      payload: { commentId, inboxId },
    });
    return;
  }

  const commentData = await commentRes.json();
  const fileId =
    commentData?.data?.file_id ||
    commentData?.data?.parent?.id ||
    commentData?.file_id ||
    null;

  if (!fileId) {
    await log({
      agent: 'pipeline',
      action: 'frameio_comment_no_file_id',
      status: 'warning',
      payload: { commentId, inboxId, commentData: JSON.stringify(commentData).slice(0, 300) },
    });
    return;
  }

  const { data: video, error } = await supabase
    .from('videos')
    .select('id, clickup_task_id, campus_id')
    .eq('frameio_asset_id', fileId)
    .maybeSingle();

  if (error) throw new Error(`Supabase query failed (videos): ${error.message}`);

  if (!video) {
    await log({
      agent: 'pipeline',
      action: 'frameio_comment_no_matching_video',
      status: 'warning',
      payload: { fileId, commentId, inboxId },
    });
    return;
  }

  if (!video.clickup_task_id) {
    await log({
      campusId: video.campus_id,
      agent: 'pipeline',
      action: 'frameio_comment_video_missing_task_id',
      status: 'warning',
      payload: { videoId: video.id, fileId, commentId, inboxId },
    });
    return;
  }

  await pipeline.handleReviewComment(video.clickup_task_id, video.campus_id);
}

module.exports = handler;
// Exposed for tests
module.exports.verifySignature = verifySignature;
module.exports.processFrameioEvent = processFrameioEvent;
