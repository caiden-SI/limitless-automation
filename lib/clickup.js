// ClickUp API client — thin wrapper over REST API v2.
// Uses personal API key from .env (Authorization header).

const BASE_URL = 'https://api.clickup.com/api/v2';

function headers() {
  const key = process.env.CLICKUP_API_KEY;
  if (!key) throw new Error('CLICKUP_API_KEY not set in .env');
  return {
    Authorization: key,
    'Content-Type': 'application/json',
  };
}

/**
 * GET /task/{task_id} — fetch full task details.
 * @param {string} taskId
 * @returns {Promise<object>} ClickUp task object
 */
async function getTask(taskId) {
  const res = await fetch(`${BASE_URL}/task/${taskId}`, {
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp getTask(${taskId}) failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * GET /list/{list_id}/task — fetch tasks in a list.
 * @param {string} listId
 * @param {object} [params] - Optional query params (page, statuses[], etc.)
 * @returns {Promise<object>} { tasks: [...] }
 */
async function getTasks(listId, params = {}) {
  const url = new URL(`${BASE_URL}/list/${listId}/task`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      v.forEach((val) => url.searchParams.append(`${k}[]`, val));
    } else {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp getTasks(${listId}) failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * PUT /task/{task_id} — update task fields (status, assignees, custom fields, etc.).
 * @param {string} taskId
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated task object
 */
async function updateTask(taskId, updates) {
  const res = await fetch(`${BASE_URL}/task/${taskId}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp updateTask(${taskId}) failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * POST /task/{task_id}/comment — add a comment to a task.
 * @param {string} taskId
 * @param {string} commentText - Plain text comment body
 * @returns {Promise<object>} Comment object
 */
async function addComment(taskId, commentText) {
  const res = await fetch(`${BASE_URL}/task/${taskId}/comment`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ comment_text: commentText }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp addComment(${taskId}) failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * POST /list/{list_id}/task — create a new task.
 * @param {string} listId
 * @param {object} taskData - { name, description, status, assignees, ... }
 * @returns {Promise<object>} Created task object
 */
async function createTask(listId, taskData) {
  const res = await fetch(`${BASE_URL}/list/${listId}/task`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(taskData),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp createTask(${listId}) failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * POST /task/{task_id}/field/{field_id} — set a custom field value.
 * @param {string} taskId
 * @param {string} fieldId - Custom field UUID
 * @param {*} value - Field value (type depends on field)
 * @returns {Promise<void>}
 */
async function setCustomField(taskId, fieldId, value) {
  const res = await fetch(`${BASE_URL}/task/${taskId}/field/${fieldId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp setCustomField(${taskId}, ${fieldId}) failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

/**
 * GET /list/{list_id}/field — retrieve custom fields for a list.
 * @param {string} listId
 * @returns {Promise<Array>} Array of custom field definitions
 */
async function getCustomFields(listId) {
  const res = await fetch(`${BASE_URL}/list/${listId}/field`, {
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp getCustomFields(${listId}) failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.fields || [];
}

module.exports = {
  getTask,
  getTasks,
  updateTask,
  addComment,
  createTask,
  setCustomField,
  getCustomFields,
};
