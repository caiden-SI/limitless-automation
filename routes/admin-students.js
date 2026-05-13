// /admin/students/* — student creation + recent-students list.
// Spec: docs/dashboard-consoles-spec.md §5 and §6.2

const { log } = require('../lib/logger');
const {
  DuplicateStudentNameError,
  createStudent,
  recentStudents,
} = require('../lib/students');

const AGENT = 'admin_students';

function missingField(res, field) {
  return res.status(400).json({ error: 'missing_field', field });
}

async function createHandler(req, res) {
  const { name, tiktokHandle, instagramHandle, campusId } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) return missingField(res, 'name');
  if (!campusId) return missingField(res, 'campusId');

  try {
    const { studentId, name: createdName, url } = await createStudent({
      name,
      tiktokHandle,
      instagramHandle,
      campusId,
    });

    await log({
      campusId,
      agent: AGENT,
      action: 'admin_student_created',
      payload: { studentId, name: createdName },
    });

    return res.json({ studentId, name: createdName, url });
  } catch (err) {
    if (err instanceof DuplicateStudentNameError) {
      await log({
        campusId,
        agent: AGENT,
        action: 'admin_student_create_duplicate',
        status: 'error',
        errorMessage: err.message,
        payload: {
          attemptedName: name,
          existingStudentId: err.existingStudentId,
        },
      });
      return res.status(409).json({
        error: 'duplicate_name',
        existingStudentId: err.existingStudentId,
        existingUrl: err.existingUrl,
      });
    }

    await log({
      campusId,
      agent: AGENT,
      action: 'admin_student_created',
      status: 'error',
      errorMessage: err.message,
      payload: { attemptedName: name, stack: err.stack },
    });
    return res.status(500).json({ error: 'internal', message: err.message });
  }
}

async function recentHandler(req, res) {
  const campusId = req.query?.campusId;
  if (!campusId) return missingField(res, 'campusId');

  const rawLimit = parseInt(req.query?.limit, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;

  try {
    const students = await recentStudents({ campusId, limit });
    return res.json({ students });
  } catch (err) {
    // No agent_logs row on read endpoints — spec §6.2 (would flood the feed).
    return res.status(500).json({ error: 'internal', message: err.message });
  }
}

module.exports = {
  createHandler,
  recentHandler,
};
