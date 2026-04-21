// Pipeline Agent — deterministic automation, minimal LLM calls.
// Trigger: Webhooks from ClickUp and Dropbox.
//
// Trigger → Action Map:
//   Status → ready for shooting  →  Create Dropbox folders
//   Dropbox file count 0 → >0    →  Status → ready for editing (1hr delay)
//   Status → ready for editing   →  Assign editor by lowest active task count
//   Frame.io comments > 0        →  Status → waiting
//   Status → done                →  Create Frame.io share link, update ClickUp

const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const selfHeal = require('../lib/self-heal');
const dropbox = require('../lib/dropbox');
const clickup = require('../lib/clickup');
const frameio = require('../lib/frameio');
const qa = require('./qa');

const AGENT_NAME = 'pipeline';

/** Convert lowercase ClickUp status to uppercase DB format. */
const dbStatus = (s) => s.toUpperCase();

/**
 * Handle a ClickUp task status change.
 * @param {string} taskId - ClickUp task ID
 * @param {string} newStatus - New status value (case-sensitive)
 * @param {string} campusId - Campus UUID
 */
async function handleStatusChange(taskId, newStatus, campusId) {
  try {
    await log({ campusId, agent: AGENT_NAME, action: `status_change: ${newStatus}`, payload: { taskId } });

    switch (newStatus) {
      case 'ready for shooting':
        await createDropboxFolders(taskId, campusId);
        break;

      case 'ready for editing':
        await assignEditor(taskId, campusId);
        break;

      case 'edited':
        await triggerQA(taskId, campusId);
        break;

      case 'done':
        await createShareLink(taskId, campusId);
        break;

      default:
        // No automated action for this status
        break;
    }
  } catch (err) {
    // Self-heal logs + diagnoses + may recover. Rethrow only when recovery
    // did NOT happen, so handlers/clickup.js marks webhook_inbox failed for
    // replay. If self-heal recovered (e.g., retry succeeded), the operation
    // effectively completed and the inbox row should not be marked failed.
    const result = await selfHeal.handle(err, {
      agent: AGENT_NAME,
      action: 'handleStatusChange',
      taskId,
      campusId,
      payload: { newStatus },
    });
    if (!result || !result.recovered) throw err;
  }
}

/**
 * Resolve a ClickUp task ID to the video record and campus in Supabase.
 * If the video doesn't exist yet, fetches task details from ClickUp and
 * creates the video row.
 *
 * @param {string} taskId - ClickUp task ID
 * @param {string|null} campusId - Campus UUID if already known
 * @returns {{ video: object, campus: object }}
 */
async function resolveTask(taskId, campusId) {
  // Try to find existing video by clickup_task_id
  const { data: video, error: vErr } = await supabase
    .from('videos')
    .select('*')
    .eq('clickup_task_id', taskId)
    .maybeSingle();

  if (vErr) throw new Error(`Supabase query failed (videos): ${vErr.message}`);

  if (video) {
    const { data: campus, error: cErr } = await supabase
      .from('campuses')
      .select('*')
      .eq('id', video.campus_id)
      .single();
    if (cErr) throw new Error(`Supabase query failed (campuses): ${cErr.message}`);
    return { video, campus };
  }

  // Video not in Supabase yet — fetch task details from ClickUp and create it
  const taskData = await clickup.getTask(taskId);

  // Determine campus — use provided campusId or look up by ClickUp list ID
  let cid = campusId;
  if (!cid) {
    const { data: c } = await supabase
      .from('campuses')
      .select('id')
      .eq('clickup_list_id', taskData.list?.id)
      .maybeSingle();
    if (c) {
      cid = c.id;
    } else {
      const listId = taskData.list?.id || 'unknown';
      await log({
        campusId: null,
        agent: AGENT_NAME,
        action: 'resolve_task_rejected',
        status: 'error',
        errorMessage: `No campus mapped for ClickUp list ID: ${listId}`,
        payload: { taskId, listId },
      });
      throw new Error(`No campus mapped for ClickUp list ID: ${listId}. Configure clickup_list_id in the campuses table.`);
    }
  }

  const { data: campus, error: cErr } = await supabase
    .from('campuses')
    .select('*')
    .eq('id', cid)
    .single();
  if (cErr) throw new Error(`Supabase query failed (campuses): ${cErr.message}`);

  // Extract student name from task custom fields or description
  const studentName = extractStudentName(taskData);

  // Insert new video record
  const { data: newVideo, error: iErr } = await supabase
    .from('videos')
    .insert({
      campus_id: cid,
      clickup_task_id: taskId,
      title: taskData.name,
      student_name: studentName,
      status: dbStatus(taskData.status?.status || 'ready for shooting'),
    })
    .select('*')
    .single();
  if (iErr) throw new Error(`Supabase insert failed (videos): ${iErr.message}`);

  return { video: newVideo, campus };
}

/**
 * Extract student name from ClickUp task.
 * Checks "Internal Video Name" custom field, then description, then returns null.
 */
function extractStudentName(taskData) {
  // Check custom fields for student-related info
  if (taskData.custom_fields) {
    for (const f of taskData.custom_fields) {
      if (f.name === 'Internal Video Name' && f.value) {
        return String(f.value);
      }
    }
  }
  return null;
}

/**
 * Create Dropbox folders for a concept.
 * Folder structure: /{campus-slug}/{concept-title}/[FOOTAGE]/ and /[PROJECT]/
 *
 * @param {string} taskId - ClickUp task ID
 * @param {string|null} campusId - Campus UUID
 */
async function createDropboxFolders(taskId, campusId) {
  const { video, campus } = await resolveTask(taskId, campusId);

  // Sanitize title for use as folder name — strip chars Dropbox doesn't allow
  const safeTitle = video.title.replace(/[<>:"/\\|?*]/g, '').trim();
  const basePath = `${campus.dropbox_root}/${safeTitle}`;
  const footagePath = `${basePath}/[FOOTAGE]`;
  const projectPath = `${basePath}/[PROJECT]`;

  await log({
    campusId: campus.id,
    agent: AGENT_NAME,
    action: 'creating_dropbox_folders',
    payload: { taskId, basePath, footagePath, projectPath },
  });

  // Create all three folders — parent first, then subfolders
  const baseResult = await dropbox.createFolder(basePath);
  const footageResult = await dropbox.createFolder(footagePath);
  const projectResult = await dropbox.createFolder(projectPath);

  const created = [
    baseResult ? basePath : `${basePath} (existed)`,
    footageResult ? footagePath : `${footagePath} (existed)`,
    projectResult ? projectPath : `${projectPath} (existed)`,
  ];

  // Update video record with Dropbox folder path
  const { error: uErr } = await supabase
    .from('videos')
    .update({ dropbox_folder: basePath, updated_at: new Date().toISOString() })
    .eq('id', video.id);
  if (uErr) throw new Error(`Supabase update failed (videos.dropbox_folder): ${uErr.message}`);

  await log({
    campusId: campus.id,
    agent: AGENT_NAME,
    action: 'dropbox_folders_created',
    payload: { taskId, videoId: video.id, created },
  });

  return { basePath, footagePath, projectPath };
}

/**
 * Assign editor with fewest active (in editing) tasks.
 */
async function assignEditor(taskId, campusId) {
  const { video, campus } = await resolveTask(taskId, campusId);

  // Get active editors for this campus
  const { data: editors, error: eErr } = await supabase
    .from('editors')
    .select('*')
    .eq('campus_id', campus.id)
    .eq('active', true);
  if (eErr) throw new Error(`Supabase query failed (editors): ${eErr.message}`);

  if (!editors || editors.length === 0) {
    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'assign_editor_skipped',
      status: 'warning',
      payload: { taskId, reason: 'no active editors' },
    });
    return;
  }

  // Count active tasks per editor
  const counts = await Promise.all(
    editors.map(async (editor) => {
      const { count, error } = await supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('assignee_id', editor.id)
        .eq('status', dbStatus('in editing'));
      return { editor, count: error ? Infinity : count };
    })
  );

  // Pick editor with lowest count
  counts.sort((a, b) => a.count - b.count);
  const chosen = counts[0].editor;

  // Update video assignee in Supabase
  const { error: uErr } = await supabase
    .from('videos')
    .update({ assignee_id: chosen.id, updated_at: new Date().toISOString() })
    .eq('id', video.id);
  if (uErr) throw new Error(`Supabase update failed (videos.assignee_id): ${uErr.message}`);

  // Update ClickUp task assignee
  await clickup.updateTask(taskId, {
    assignees: { add: [Number(chosen.clickup_user_id)] },
  });

  await log({
    campusId: campus.id,
    agent: AGENT_NAME,
    action: 'editor_assigned',
    payload: { taskId, videoId: video.id, editorId: chosen.id, editorName: chosen.name, clickupUserId: chosen.clickup_user_id, activeCount: counts[0].count },
  });

  return chosen;
}

/**
 * Trigger QA checks when an editor marks a video as edited.
 * If QA passes, the video is eligible for Frame.io upload.
 * If QA fails, issues are posted to ClickUp and status set to waiting.
 */
async function triggerQA(taskId, campusId) {
  const { video, campus } = await resolveTask(taskId, campusId);

  const { passed, report } = await qa.runQA(video.id, campus.id);

  if (passed) {
    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'qa_gate_passed',
      payload: { taskId, videoId: video.id },
    });
    // QA passed — video is now eligible for Frame.io upload.
    // The actual upload happens when status moves to done.
  } else {
    // Update ClickUp status to waiting
    await clickup.updateTask(taskId, { status: 'waiting' });

    // Update status in Supabase to reflect the block
    await supabase
      .from('videos')
      .update({ status: dbStatus('waiting'), updated_at: new Date().toISOString() })
      .eq('id', video.id);

    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'qa_gate_blocked',
      payload: { taskId, videoId: video.id, issueCount: report?.totalIssues ?? 0 },
    });
  }

  return { passed, report };
}

/**
 * Frame.io comment.created webhook arrived — a reviewer left notes.
 * Move the task to `waiting` so the editor knows to revise.
 *
 * Idempotent: firing twice lands the task in `waiting` twice, which is a
 * no-op. Does not check current status — a late comment on a `done` video
 * still sends the task back to `waiting` and operator can decide.
 */
async function handleReviewComment(taskId, campusId) {
  const { video, campus } = await resolveTask(taskId, campusId);

  await clickup.updateTask(taskId, { status: 'waiting' });

  const { error: uErr } = await supabase
    .from('videos')
    .update({ status: dbStatus('waiting'), updated_at: new Date().toISOString() })
    .eq('id', video.id);
  if (uErr) throw new Error(`Supabase update failed (videos.status): ${uErr.message}`);

  await log({
    campusId: campus.id,
    agent: AGENT_NAME,
    action: 'review_comment_routed',
    payload: { taskId, videoId: video.id, newStatus: 'waiting' },
  });
}

/**
 * Create a client-facing Frame.io share link and push it to the ClickUp
 * "E - Frame Link" custom field.
 *
 * Idempotent: if videos.frameio_share_link is already set, skip the
 * Frame.io API call and just re-push the existing URL to ClickUp.
 * If videos.frameio_asset_id is null, log a warning and return — the
 * upload step hasn't populated it yet, so there's nothing to share.
 *
 * Spec: workflows/frame-io-share-link.md
 */
async function createShareLink(taskId, campusId) {
  const { video, campus } = await resolveTask(taskId, campusId);

  await log({
    campusId: campus.id,
    agent: AGENT_NAME,
    action: 'create_share_link_started',
    payload: { taskId, videoId: video.id, hasAssetId: !!video.frameio_asset_id, hasShareLink: !!video.frameio_share_link },
  });

  if (!video.frameio_asset_id) {
    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'create_share_link_skipped',
      status: 'warning',
      payload: { taskId, videoId: video.id, reason: 'no frameio_asset_id on video row' },
    });
    return;
  }

  const fieldId = process.env.CLICKUP_FRAMEIO_FIELD_ID;
  if (!fieldId) {
    throw new Error('CLICKUP_FRAMEIO_FIELD_ID not set in .env');
  }

  let shareUrl = video.frameio_share_link;

  if (!shareUrl) {
    const result = await frameio.createShareLink(video.frameio_asset_id, { name: video.title });
    shareUrl = result.url;

    // Validate URL shape. Spec: https:// + contains frame.io. Relaxed to
    // also accept f.io (Frame.io's own URL shortener, which is what v2
    // share_links returns as short_url).
    if (typeof shareUrl !== 'string' || !shareUrl.startsWith('https://') || !/frame\.io|f\.io/.test(shareUrl)) {
      throw new Error(`Frame.io returned invalid share URL: ${String(shareUrl).slice(0, 200)}`);
    }

    const { error: uErr } = await supabase
      .from('videos')
      .update({ frameio_share_link: shareUrl, updated_at: new Date().toISOString() })
      .eq('id', video.id);
    if (uErr) throw new Error(`Supabase update failed (videos.frameio_share_link): ${uErr.message}`);

    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'share_link_created',
      payload: { taskId, videoId: video.id, shareUrl, frameioId: result.id },
    });
  } else {
    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'share_link_reused',
      payload: { taskId, videoId: video.id, shareUrl },
    });
  }

  await clickup.setCustomField(taskId, fieldId, shareUrl);

  await log({
    campusId: campus.id,
    agent: AGENT_NAME,
    action: 'clickup_frame_link_updated',
    payload: { taskId, videoId: video.id, fieldId, shareUrl },
  });
}

/**
 * Handle footage detected in Dropbox folder.
 * Called after 1-hour delay from Dropbox webhook.
 */
async function handleFootageDetected(taskId, campusId) {
  const { video, campus } = await resolveTask(taskId, campusId);

  if (!video.dropbox_folder) {
    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'footage_detected_skipped',
      status: 'warning',
      payload: { taskId, reason: 'no dropbox_folder set' },
    });
    return;
  }

  // Verify files actually exist in [FOOTAGE] subfolder
  const footagePath = `${video.dropbox_folder}/[FOOTAGE]`;
  const entries = await dropbox.listFolder(footagePath);
  const files = entries.filter((e) => e.tag === 'file');

  if (files.length === 0) {
    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'footage_detected_empty',
      status: 'warning',
      payload: { taskId, footagePath },
    });
    return;
  }

  // Update status in Supabase
  const { error: uErr } = await supabase
    .from('videos')
    .update({ status: dbStatus('ready for editing'), updated_at: new Date().toISOString() })
    .eq('id', video.id);
  if (uErr) throw new Error(`Supabase update failed (videos.status): ${uErr.message}`);

  // Update ClickUp task status
  await clickup.updateTask(taskId, { status: 'ready for editing' });

  await log({
    campusId: campus.id,
    agent: AGENT_NAME,
    action: 'footage_detected_status_updated',
    payload: { taskId, videoId: video.id, fileCount: files.length, newStatus: 'ready for editing' },
  });
}

module.exports = {
  handleStatusChange,
  handleFootageDetected,
  handleReviewComment,
  createDropboxFolders,
  assignEditor,
  triggerQA,
  createShareLink,
};
