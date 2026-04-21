// Dropbox webhook handler — receives file change notifications.
// Challenge verification handled in server.js (GET route).
//
// Events are durably recorded in webhook_inbox before returning 200.
// Processing happens asynchronously. Failures update the inbox row
// instead of being silently dropped (same pattern as handlers/clickup.js).
//
// Detection strategy: Dropbox webhooks only carry account IDs, not paths.
// On each webhook, scan videos in READY FOR SHOOTING with a dropbox_folder
// set, list each [FOOTAGE] subfolder, and route any with files present
// to pipeline.handleFootageDetected. handleFootageDetected is idempotent.
//
// TODO: 1-hour delay from CLAUDE.md is not applied here yet — status change
// fires as soon as footage is detected. Proposed fix: add a
// videos.footage_detected_at column, set it on first detection, and only
// route to handleFootageDetected when it is ≥1 hour old. Deferred to a
// follow-up change.

const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const dropboxLib = require('../lib/dropbox');
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
 * Scan videos awaiting footage and route any with files present to
 * pipeline.handleFootageDetected.
 *
 * Per-video errors are logged and swallowed so one bad video does not
 * block the rest of the scan. Errors that break the whole scan (e.g.
 * the Supabase query itself fails) propagate and mark the inbox row
 * failed.
 */
async function processDropboxChange(body, inboxId) {
  await log({
    agent: 'pipeline',
    action: 'dropbox_webhook_received',
    payload: { accounts: body?.list_folder?.accounts, inboxId },
  });

  const { data: candidates, error } = await supabase
    .from('videos')
    .select('id, clickup_task_id, campus_id, dropbox_folder, title')
    .eq('status', 'READY FOR SHOOTING')
    .not('dropbox_folder', 'is', null);

  if (error) throw new Error(`Supabase query failed (videos): ${error.message}`);

  if (!candidates || candidates.length === 0) {
    await log({ agent: 'pipeline', action: 'dropbox_scan_no_candidates', payload: { inboxId } });
    return;
  }

  let triggered = 0;
  let skipped = 0;

  for (const video of candidates) {
    if (!video.clickup_task_id) {
      skipped++;
      continue;
    }

    const footagePath = `${video.dropbox_folder}/[FOOTAGE]`;

    let files = [];
    try {
      const entries = await dropboxLib.listFolder(footagePath);
      files = entries.filter((e) => e.tag === 'file');
    } catch (err) {
      await log({
        campusId: video.campus_id,
        agent: 'pipeline',
        action: 'dropbox_list_folder_error',
        status: 'warning',
        errorMessage: err.message,
        payload: { videoId: video.id, footagePath },
      });
      continue;
    }

    if (files.length === 0) {
      skipped++;
      continue;
    }

    try {
      await pipeline.handleFootageDetected(video.clickup_task_id, video.campus_id);
      triggered++;
    } catch (err) {
      await log({
        campusId: video.campus_id,
        agent: 'pipeline',
        action: 'handle_footage_detected_error',
        status: 'error',
        errorMessage: err.message,
        payload: { videoId: video.id, taskId: video.clickup_task_id, stack: err.stack },
      });
      // Continue — don't let one bad video block the others
    }
  }

  await log({
    agent: 'pipeline',
    action: 'dropbox_scan_complete',
    payload: { inboxId, candidates: candidates.length, triggered, skipped },
  });
}

module.exports = handler;
