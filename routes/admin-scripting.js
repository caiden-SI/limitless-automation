// /admin/scripting/* — manual scripting console endpoints.
// Spec: docs/dashboard-consoles-spec.md §4 and §6.2
//
// All three handlers share a context-load helper that mirrors the cron
// flow in agents/scripting.processEvent (lines 117-137): performance
// signals + research benchmarks + brand-voice validator constraints.

const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const scripting = require('../agents/scripting');
const validator = require('../lib/brand-voice-validator');

const AGENT = 'scripting';

/**
 * Resolve the campus + student rows the manual handlers need, plus the
 * brand-voice constraints/context shared by generate/refine. Throws on
 * missing rows so handlers can map to 404.
 */
async function loadHandlerContext({ campusId, studentId }) {
  const [{ data: campus, error: cErr }, { data: student, error: sErr }] = await Promise.all([
    supabase
      .from('campuses')
      .select('id, name, clickup_list_id, google_calendar_id')
      .eq('id', campusId)
      .maybeSingle(),
    supabase
      .from('students')
      .select('id, name, campus_id, claude_project_context, handle_tiktok, handle_instagram, handle_youtube, content_format_preference, onboarding_completed_at, is_brand_account')
      .eq('id', studentId)
      .eq('campus_id', campusId)
      .maybeSingle(),
  ]);

  if (cErr) throw new Error(`campuses query failed: ${cErr.message}`);
  if (sErr) throw new Error(`students query failed: ${sErr.message}`);
  if (!campus) {
    const err = new Error(`Campus ${campusId} not found`);
    err.statusCode = 404;
    throw err;
  }
  if (!student) {
    const err = new Error(`Student ${studentId} not found on this campus`);
    err.statusCode = 404;
    throw err;
  }

  const context = await scripting.loadContext({ campusId, student });
  const validatorContext = await validator.loadSharedContext(student, campusId);
  const genConstraints = await validator.buildGenerationConstraints(student, {
    campusId,
    sharedContext: validatorContext,
  });

  return { campus, student, context, validatorContext, genConstraints };
}

function missingField(res, field) {
  return res.status(400).json({ error: 'missing_field', field });
}

async function generateHandler(req, res) {
  const { campusId, studentId, conceptTitle } = req.body || {};

  if (!campusId) return missingField(res, 'campusId');
  if (!studentId) return missingField(res, 'studentId');
  if (typeof conceptTitle !== 'string' || !conceptTitle.trim()) {
    return missingField(res, 'conceptTitle');
  }
  const cleanTitle = conceptTitle.trim().slice(0, 200);

  try {
    const { campus, student, context, validatorContext, genConstraints } = await loadHandlerContext({
      campusId,
      studentId,
    });

    const result = await scripting.generateConcepts({
      campusId,
      student,
      context,
      validatorContext,
      genConstraints,
      userConcept: { title: cleanTitle },
    });

    if (result.aborted) {
      await log({
        campusId,
        agent: AGENT,
        action: 'manual_scripting_generated',
        status: 'error',
        errorMessage: `Voice validation aborted after ${result.attempts} attempts`,
        payload: {
          studentId,
          studentName: student.name,
          conceptTitle: cleanTitle,
          aborted: true,
          attempts: result.attempts,
          issues: result.issues,
        },
      });
      return res.json({ aborted: true, issues: result.issues, attempts: result.attempts });
    }

    await log({
      campusId,
      agent: AGENT,
      action: 'manual_scripting_generated',
      payload: {
        studentId,
        studentName: student.name,
        conceptTitle: cleanTitle,
        conceptCount: result.concepts.length,
      },
    });

    return res.json({ concepts: result.concepts, validatorResults: result.validatorResults });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'not_found', message: err.message });
    }
    await log({
      campusId,
      agent: AGENT,
      action: 'manual_scripting_generated',
      status: 'error',
      errorMessage: err.message,
      payload: { studentId, conceptTitle: cleanTitle, stack: err.stack },
    });
    return res.status(500).json({ error: 'internal', message: err.message });
  }
}

async function refineHandler(req, res) {
  const { campusId, studentId, originalConcept, refinementInput } = req.body || {};

  if (!campusId) return missingField(res, 'campusId');
  if (!studentId) return missingField(res, 'studentId');
  if (!originalConcept || typeof originalConcept !== 'object') return missingField(res, 'originalConcept');
  if (typeof refinementInput !== 'string' || !refinementInput.trim()) {
    return missingField(res, 'refinementInput');
  }
  const cleanRefinement = refinementInput.trim().slice(0, 1000);

  try {
    const { student, context, validatorContext, genConstraints } = await loadHandlerContext({
      campusId,
      studentId,
    });

    const result = await scripting.refineConcept({
      campusId,
      student,
      context,
      validatorContext,
      genConstraints,
      originalConcept,
      refinementInput: cleanRefinement,
    });

    if (result.aborted) {
      await log({
        campusId,
        agent: AGENT,
        action: 'manual_scripting_refined',
        status: 'error',
        errorMessage: `Voice validation aborted after ${result.attempts} attempts`,
        payload: {
          studentId,
          studentName: student.name,
          aborted: true,
          attempts: result.attempts,
          issues: result.issues,
          originalTitle: originalConcept.title,
        },
      });
      return res.json({ aborted: true, issues: result.issues, attempts: result.attempts });
    }

    await log({
      campusId,
      agent: AGENT,
      action: 'manual_scripting_refined',
      payload: {
        studentId,
        studentName: student.name,
        originalTitle: originalConcept.title,
        refinedTitle: result.concept.title,
      },
    });

    return res.json({ concept: result.concept, validatorResult: result.validatorResult });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'not_found', message: err.message });
    }
    await log({
      campusId,
      agent: AGENT,
      action: 'manual_scripting_refined',
      status: 'error',
      errorMessage: err.message,
      payload: { studentId, stack: err.stack },
    });
    return res.status(500).json({ error: 'internal', message: err.message });
  }
}

async function pushHandler(req, res) {
  const { campusId, studentId, concept } = req.body || {};

  if (!campusId) return missingField(res, 'campusId');
  if (!studentId) return missingField(res, 'studentId');
  if (!concept || typeof concept !== 'object') return missingField(res, 'concept');

  try {
    // Reuse the campus + student load but skip the validator/context loads
    // — push doesn't need them.
    const [{ data: campus, error: cErr }, { data: student, error: sErr }] = await Promise.all([
      supabase
        .from('campuses')
        .select('id, name, clickup_list_id')
        .eq('id', campusId)
        .maybeSingle(),
      supabase
        .from('students')
        .select('id, name, campus_id')
        .eq('id', studentId)
        .eq('campus_id', campusId)
        .maybeSingle(),
    ]);
    if (cErr) throw new Error(`campuses query failed: ${cErr.message}`);
    if (sErr) throw new Error(`students query failed: ${sErr.message}`);
    if (!campus) return res.status(404).json({ error: 'not_found', message: 'Campus not found' });
    if (!student) return res.status(404).json({ error: 'not_found', message: 'Student not found on this campus' });

    const { videoId, taskId, taskUrl } = await scripting.pushConceptToClickUp(concept, { campus, student });

    await log({
      campusId,
      agent: AGENT,
      action: 'manual_scripting_pushed',
      payload: {
        studentId,
        studentName: student.name,
        conceptTitle: concept.title,
        videoId,
        taskId,
        taskUrl,
      },
    });

    return res.json({ taskId, taskUrl, videoId });
  } catch (err) {
    // Manual pushes have no rollback — a partial failure may leave an
    // orphan videos row (per spec §4.5). Log loudly so an operator can clean up.
    await log({
      campusId,
      agent: AGENT,
      action: 'manual_scripting_pushed',
      status: 'error',
      errorMessage: err.message,
      payload: {
        studentId,
        conceptTitle: concept?.title,
        partial: err.partial || null,
        stack: err.stack,
      },
    });
    return res.status(500).json({ error: 'internal', message: err.message });
  }
}

module.exports = {
  generateHandler,
  refineHandler,
  pushHandler,
  // Exposed for tests
  loadHandlerContext,
};
