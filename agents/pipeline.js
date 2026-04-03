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
const dropbox = require('../lib/dropbox');
const qa = require('./qa');

const AGENT_NAME = 'pipeline';

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
    await log({
      campusId,
      agent: AGENT_NAME,
      action: `status_change_error: ${newStatus}`,
      status: 'error',
      errorMessage: err.message,
      payload: { taskId, stack: err.stack },
    });
    throw err;
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
  // TODO: Replace stub with real ClickUp API call once CLICKUP_API_KEY is set
  // const taskData = await clickup.getTask(taskId);
  // const title = taskData.name;
  // const studentName = extractStudentName(taskData); // from custom field or description
  const taskData = await getClickUpTaskStub(taskId);

  // Determine campus — use provided campusId or look up by ClickUp list ID
  let cid = campusId;
  if (!cid) {
    // TODO: Replace stub — resolve campus from taskData.list.id against campuses.clickup_list_id
    // const { data: c } = await supabase.from('campuses').select('id').eq('clickup_list_id', taskData.list.id).single();
    // cid = c.id;
    const { data: c } = await supabase.from('campuses').select('id').limit(1).single();
    cid = c.id;
  }

  const { data: campus, error: cErr } = await supabase
    .from('campuses')
    .select('*')
    .eq('id', cid)
    .single();
  if (cErr) throw new Error(`Supabase query failed (campuses): ${cErr.message}`);

  // Insert new video record
  const { data: newVideo, error: iErr } = await supabase
    .from('videos')
    .insert({
      campus_id: cid,
      clickup_task_id: taskId,
      title: taskData.name,
      student_name: taskData.studentName || null,
      status: 'ready for shooting',
    })
    .select('*')
    .single();
  if (iErr) throw new Error(`Supabase insert failed (videos): ${iErr.message}`);

  return { video: newVideo, campus };
}

/**
 * Stub for ClickUp GET /task/{id} — returns minimal task shape.
 * TODO: Remove when CLICKUP_API_KEY is available.
 */
async function getClickUpTaskStub(taskId) {
  // TODO: Replace with real ClickUp API call:
  // const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
  //   headers: { Authorization: process.env.CLICKUP_API_KEY },
  // });
  // if (!res.ok) throw new Error(`ClickUp API error: ${res.status}`);
  // return res.json();
  return {
    id: taskId,
    name: `Task ${taskId}`,
    studentName: null,
    list: { id: null },
  };
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
        .eq('status', 'in editing');
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

  // TODO: Update ClickUp task assignee once CLICKUP_API_KEY is available
  // await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
  //   method: 'PUT',
  //   headers: { Authorization: process.env.CLICKUP_API_KEY, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ assignees: { add: [chosen.clickup_user_id] } }),
  // });

  await log({
    campusId: campus.id,
    agent: AGENT_NAME,
    action: 'editor_assigned',
    payload: { taskId, videoId: video.id, editorId: chosen.id, editorName: chosen.name, activeCount: counts[0].count },
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
    // The actual upload happens when status moves to DONE.
  } else {
    // TODO: Update ClickUp status to waiting once CLICKUP_API_KEY is available
    // await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    //   method: 'PUT',
    //   headers: { Authorization: process.env.CLICKUP_API_KEY, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ status: 'waiting' }),
    // });

    // Update status in Supabase to reflect the block
    await supabase
      .from('videos')
      .update({ status: 'waiting', updated_at: new Date().toISOString() })
      .eq('id', video.id);

    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'qa_gate_blocked',
      payload: { taskId, videoId: video.id, issueCount: report.totalIssues },
    });
  }

  return { passed, report };
}

/**
 * Create Frame.io share link and update ClickUp custom field.
 */
async function createShareLink(taskId, campusId) {
  // TODO: Implement
  // 1. Query videos table for frameio_link by clickup_task_id
  // 2. Call Frame.io API POST /assets/{asset_id}/share_links
  // 3. Update videos.frameio_share_link in Supabase
  // 4. Update ClickUp custom link field via API
  await log({ campusId, agent: AGENT_NAME, action: 'create_share_link', payload: { taskId } });
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
    .update({ status: 'ready for editing', updated_at: new Date().toISOString() })
    .eq('id', video.id);
  if (uErr) throw new Error(`Supabase update failed (videos.status): ${uErr.message}`);

  // TODO: Update ClickUp task status once CLICKUP_API_KEY is available
  // await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
  //   method: 'PUT',
  //   headers: { Authorization: process.env.CLICKUP_API_KEY, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ status: 'ready for editing' }),
  // });

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
  createDropboxFolders,
  assignEditor,
  triggerQA,
  createShareLink,
};
