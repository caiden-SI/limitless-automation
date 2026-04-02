// Pipeline Agent — deterministic automation, minimal LLM calls.
// Trigger: Webhooks from ClickUp and Dropbox.
//
// Trigger → Action Map:
//   Status → READY FOR SHOOTING  →  Create Dropbox folders
//   Dropbox file count 0 → >0    →  Status → READY FOR EDITING (1hr delay)
//   Status → READY FOR EDITING   →  Assign editor by lowest active task count
//   Frame.io comments > 0        →  Status → NEEDS REVISIONS
//   Status → DONE                →  Create Frame.io share link, update ClickUp

const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');

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
      case 'READY FOR SHOOTING':
        await createDropboxFolders(taskId, campusId);
        break;

      case 'READY FOR EDITING':
        await assignEditor(taskId, campusId);
        break;

      case 'DONE':
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
 * Create Dropbox folders for a concept.
 * Folder structure: /[campus-slug]/[concept-title]/[FOOTAGE]/ and /[PROJECT]/
 */
async function createDropboxFolders(taskId, campusId) {
  // TODO: Implement
  // 1. Query videos table for concept title by clickup_task_id
  // 2. Query campuses table for campus slug
  // 3. Call Dropbox API POST /files/create_folder_v2 for both subfolders
  // 4. Update videos.dropbox_folder in Supabase
  await log({ campusId, agent: AGENT_NAME, action: 'create_dropbox_folders', payload: { taskId } });
}

/**
 * Assign editor with fewest active (IN EDITING) tasks.
 */
async function assignEditor(taskId, campusId) {
  // TODO: Implement
  // 1. Query editors table for active editors in this campus
  // 2. Count videos with status IN EDITING per editor
  // 3. Assign to editor with lowest count
  // 4. Update ClickUp task assignee via API
  // 5. Update videos.assignee_id in Supabase
  await log({ campusId, agent: AGENT_NAME, action: 'assign_editor', payload: { taskId } });
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
  // TODO: Implement
  // 1. Verify files still exist in folder (not a false trigger)
  // 2. Update ClickUp status: READY FOR SHOOTING → READY FOR EDITING
  // 3. Update videos.status in Supabase
  await log({ campusId, agent: AGENT_NAME, action: 'footage_detected', payload: { taskId } });
}

module.exports = {
  handleStatusChange,
  handleFootageDetected,
  createDropboxFolders,
  assignEditor,
  createShareLink,
};
