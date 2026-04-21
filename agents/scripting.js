// Scripting Agent — generates 3 concept scripts per filming event.
// Spec: workflows/scripting-agent.md
//
// Trigger: cron every 15 minutes, looks 48 hours ahead on each campus's
// configured Google Calendar. Dedup via processed_calendar_events.

const fs = require('fs');
const path = require('path');

const { supabase } = require('../lib/supabase');
const { askJson } = require('../lib/claude');
const { log } = require('../lib/logger');
const selfHeal = require('../lib/self-heal');
const clickup = require('../lib/clickup');
const gcal = require('../lib/gcal');
const { HOOK_TYPES } = require('./research');

const AGENT_NAME = 'scripting';
const WINDOW_HOURS = 48;

// Mirror of pipeline.js dbStatus — one-liner, not worth a circular import.
const dbStatus = (s) => s.toUpperCase();

/**
 * Main per-event processor. Exported so the integration test can inject
 * a fake event directly.
 * @param {{ id: string, title: string, description: string, startTime: string }} event
 * @param {string} campusId
 */
async function processEvent(event, campusId) {
  let claimId = null;

  try {
    await log({ campusId, agent: AGENT_NAME, action: 'event_received', payload: { eventId: event.id, title: event.title } });

    // 1. Fast dedup check — cheap optimization to skip events already in any
    //    terminal state without hitting the roster/campus loads.
    //    The atomic guarantee comes from the claim insert below, not this read.
    const { data: processed, error: dErr } = await supabase
      .from('processed_calendar_events')
      .select('id, status')
      .eq('campus_id', campusId)
      .eq('event_id', event.id)
      .maybeSingle();
    if (dErr) throw new Error(`Supabase query failed (processed_calendar_events): ${dErr.message}`);
    if (processed) {
      // Silent skip for any existing claim — completed, pending (in flight),
      // or failed_cleanup (halted for manual intervention).
      return { skipped: `already_claimed:${processed.status}` };
    }

    // 2. Campus row
    const { data: campus, error: cErr } = await supabase
      .from('campuses')
      .select('id, name, clickup_list_id, google_calendar_id')
      .eq('id', campusId)
      .single();
    if (cErr) throw new Error(`Supabase query failed (campuses): ${cErr.message}`);

    // 3. Student match
    const { data: students, error: sErr } = await supabase
      .from('students')
      .select('id, name, claude_project_context')
      .eq('campus_id', campusId);
    if (sErr) throw new Error(`Supabase query failed (students): ${sErr.message}`);

    const matchResult = gcal.parseStudentFromEvent(event, students || []);
    if (!matchResult.student) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: matchResult.reason === 'ambiguous' ? 'student_match_ambiguous' : 'student_not_matched',
        status: 'warning',
        payload: {
          eventId: event.id,
          title: event.title,
          reason: matchResult.reason,
          candidates: matchResult.candidates || [],
        },
      });
      // Do not claim — let a clarified event reprocess later.
      return { skipped: matchResult.reason };
    }
    const student = matchResult.student;

    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'student_matched',
      payload: { eventId: event.id, studentId: student.id, studentName: student.name },
    });

    // 4. Atomic claim — insert the row as "pending" BEFORE any side effects.
    //    The unique constraint on (campus_id, event_id) serializes races.
    const { data: claim, error: claimErr } = await supabase
      .from('processed_calendar_events')
      .insert({ campus_id: campusId, event_id: event.id, status: 'pending' })
      .select('id')
      .single();
    if (claimErr) {
      if (claimErr.code === '23505') {
        // Another run claimed this event between the read and the insert. Silent skip.
        await log({ campusId, agent: AGENT_NAME, action: 'event_claim_race_lost', payload: { eventId: event.id } });
        return { skipped: 'claim_race_lost' };
      }
      throw new Error(`Supabase insert failed (processed_calendar_events claim): ${claimErr.message}`);
    }
    claimId = claim.id;
    await log({ campusId, agent: AGENT_NAME, action: 'event_claimed', payload: { eventId: event.id, claimId } });

    // 5. Load context
    const context = await loadContext({ campusId, student });
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'context_loaded',
      payload: {
        hasStudentContext: !!student.claude_project_context,
        hasPerformanceSignals: !!context.performanceSignals,
        researchBenchmarkCount: context.researchBenchmarks.length,
        hasBrandVoiceExamples: !!context.brandVoiceExamples,
      },
    });

    // 6. Claude call — with one validation retry
    const concepts = await generateConcepts({ campusId, student, context });

    await log({ campusId, agent: AGENT_NAME, action: 'validation_passed', payload: { eventId: event.id } });

    // 7. Writes with rollback (rollback is claim-aware and marks failed_cleanup on partial failure)
    const result = await writeConcepts({ campus, student, event, concepts, claimId });

    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'event_processed',
      payload: { eventId: event.id, videoIds: result.videoIds, clickupTaskIds: result.clickupTaskIds },
    });

    return result;
  } catch (err) {
    // Self-heal runs first (it logs the original error per CLAUDE.md rule 1).
    // The rethrow at the bottom is still caught by runForCampus, which swallows
    // per-event errors so one bad event doesn't stall the run.
    await selfHeal.handle(err, {
      agent: AGENT_NAME,
      action: 'processEvent',
      campusId,
      payload: { eventId: event?.id, title: event?.title },
    });

    // Pre-write failure (context load, Claude, validation): no external side effects
    // exist yet, so release the claim so a future cron tick can retry.
    if (claimId) {
      const { error: relErr } = await supabase.from('processed_calendar_events').delete().eq('id', claimId);
      if (relErr) {
        // If the claim row somehow cannot be deleted, mark it failed_cleanup
        // so it doesn't block the event forever — but do log because it means
        // automatic retry is now off.
        await log({
          campusId,
          agent: AGENT_NAME,
          action: 'claim_release_failed',
          status: 'error',
          errorMessage: relErr.message,
          payload: { claimId, eventId: event?.id },
        });
        await supabase
          .from('processed_calendar_events')
          .update({ status: 'failed_cleanup', error_payload: { stage: 'pre_write', reason: relErr.message } })
          .eq('id', claimId);
      } else {
        await log({ campusId, agent: AGENT_NAME, action: 'claim_released', payload: { claimId, eventId: event?.id } });
      }
    }
    throw err;
  }
}

/**
 * Parallel fetch of performance signals, research benchmarks, and the
 * optional brand voice examples file.
 */
async function loadContext({ campusId, student }) {
  const [signalRes, researchRes] = await Promise.all([
    supabase
      .from('performance_signals')
      .select('*')
      .eq('campus_id', campusId)
      .order('week_of', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('research_library')
      .select('transcript, hook_type, format, topic_tags, platform, view_count')
      .eq('campus_id', campusId)
      .order('view_count', { ascending: false, nullsFirst: false })
      .limit(10),
  ]);

  if (signalRes.error) throw new Error(`Supabase query failed (performance_signals): ${signalRes.error.message}`);
  if (researchRes.error) throw new Error(`Supabase query failed (research_library): ${researchRes.error.message}`);

  let brandVoiceExamples = null;
  const voicePath = process.env.BRAND_VOICE_EXAMPLES_PATH;
  if (voicePath) {
    try {
      const resolved = path.isAbsolute(voicePath) ? voicePath : path.resolve(process.cwd(), voicePath);
      if (fs.existsSync(resolved)) {
        brandVoiceExamples = fs.readFileSync(resolved, 'utf8');
      } else {
        await log({ campusId, agent: AGENT_NAME, action: 'brand_voice_file_missing', status: 'warning', payload: { path: resolved } });
      }
    } catch (err) {
      await log({ campusId, agent: AGENT_NAME, action: 'brand_voice_read_error', status: 'warning', errorMessage: err.message });
    }
  }

  return {
    studentContext: student.claude_project_context || null,
    performanceSignals: signalRes.data || null,
    researchBenchmarks: researchRes.data || [],
    brandVoiceExamples,
  };
}

/**
 * Build the system + user prompt. Optional `validationError` appends a retry
 * instruction when Claude's first attempt failed validation.
 */
function buildPrompt({ student, context, validationError }) {
  const { studentContext, performanceSignals, researchBenchmarks, brandVoiceExamples } = context;

  const sysParts = [
    `You are a content strategist for Alpha School, a private K-12 school network.`,
    `You generate short-form video scripts (30-60 seconds) for student creators.`,
    ``,
    `OUTPUT FORMAT: Return a JSON array of exactly 3 concept objects. No prose wrapper, no markdown fences. Each concept has:`,
    `  - title: string, 1 to 4 words`,
    `  - hook_type: one of [${HOOK_TYPES.join(', ')}]`,
    `  - hook_angle: one sentence describing the opening angle`,
    `  - script: 70 to 150 words, reads as 30 to 60 seconds spoken`,
    `  - creative_direction: non-empty array of short bullet strings (visual/shot/delivery cues)`,
    ``,
    `Match the student's brand voice exactly. Keep language natural for a high school student.`,
  ];

  if (brandVoiceExamples) {
    sysParts.push('', 'BRAND_VOICE_EXAMPLES (infer tone from these, do not copy):', brandVoiceExamples.slice(0, 4000));
  }

  const userParts = [];

  userParts.push(`STUDENT: ${student.name}`);
  if (studentContext) {
    userParts.push('', 'STUDENT CONTEXT (claude_project_context, verbatim):', studentContext);
  } else {
    userParts.push('', 'STUDENT CONTEXT: (none available — hedge and produce more generic concepts grounded in general Alpha School positioning)');
  }

  if (performanceSignals) {
    const { top_hooks, top_formats, top_topics, underperforming_patterns, recommendations, summary } = performanceSignals;
    const lines = ['', 'RECENT PERFORMANCE SIGNALS (what is working for this campus):'];
    if (summary) lines.push(`Summary: ${summary}`);
    if (Array.isArray(top_hooks) && top_hooks.length) {
      lines.push(`Top hooks: ${JSON.stringify(top_hooks.slice(0, 3))}`);
    }
    if (Array.isArray(top_formats) && top_formats.length) {
      lines.push(`Top formats: ${JSON.stringify(top_formats.slice(0, 3))}`);
    }
    if (Array.isArray(top_topics) && top_topics.length) {
      lines.push(`Top topics: ${JSON.stringify(top_topics.slice(0, 5))}`);
    }
    if (Array.isArray(underperforming_patterns) && underperforming_patterns.length) {
      lines.push(`Underperforming patterns to avoid: ${JSON.stringify(underperforming_patterns)}`);
    }
    if (Array.isArray(recommendations) && recommendations.length) {
      lines.push(`Recommendations: ${JSON.stringify(recommendations)}`);
    }
    userParts.push(...lines);
  } else {
    userParts.push('', 'RECENT PERFORMANCE SIGNALS: (none available — hedge, do not invent stats)');
  }

  if (researchBenchmarks.length) {
    userParts.push('', 'RESEARCH LIBRARY BENCHMARKS (top external videos by view count — study the hook patterns, do not copy):');
    for (const r of researchBenchmarks) {
      userParts.push(
        `- [${r.platform || '?'} | ${r.hook_type || '?'} | ${r.format || '?'} | ${r.view_count || '?'} views] ${String(r.transcript || '').slice(0, 240)}`
      );
    }
  } else {
    userParts.push('', 'RESEARCH LIBRARY BENCHMARKS: (none available — rely on student context and performance signals)');
  }

  const topHookCount = performanceSignals && Array.isArray(performanceSignals.top_hooks) ? performanceSignals.top_hooks.length : 0;
  if (topHookCount >= 3) {
    userParts.push('', 'REQUIREMENT: each of the 3 concepts must target a different hook_type, drawn from the top hooks above.');
  } else {
    userParts.push('', 'NOTE: fewer than 3 top_hooks are available. Prefer different hook_types across concepts, but repetition is acceptable.');
  }

  if (validationError) {
    userParts.push(
      '',
      `PREVIOUS ATTEMPT FAILED VALIDATION: ${validationError}`,
      'Fix the specific issue and return the corrected JSON array. Do not include any explanation.'
    );
  }

  return { system: sysParts.join('\n'), prompt: userParts.join('\n') };
}

/**
 * Call Claude, validate, retry once on validation failure, abort on second.
 */
async function generateConcepts({ campusId, student, context }) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { system, prompt } = buildPrompt({ student, context, validationError: lastError });

    let raw;
    try {
      raw = await askJson({ system, prompt, maxTokens: 3000 });
    } catch (err) {
      // Parse failure counts as a validation failure for retry purposes
      lastError = err.message;
      if (attempt === 2) throw new Error(`Claude failed to return valid JSON after retry: ${err.message}`);
      await log({ campusId, agent: AGENT_NAME, action: 'claude_parse_failed_retrying', status: 'warning', errorMessage: err.message });
      continue;
    }

    try {
      validateConcepts(raw);
      return raw;
    } catch (err) {
      lastError = err.message;
      if (attempt === 2) throw new Error(`Concept validation failed after retry: ${err.message}`);
      await log({ campusId, agent: AGENT_NAME, action: 'validation_failed_retrying', status: 'warning', errorMessage: err.message });
    }
  }
}

/**
 * Throw on the first validation violation. Error string is precise enough
 * to hand back to Claude on retry.
 */
function validateConcepts(raw) {
  if (!Array.isArray(raw)) throw new Error('Output is not a JSON array');
  if (raw.length !== 3) throw new Error(`Expected exactly 3 concepts, got ${raw.length}`);

  raw.forEach((c, i) => {
    const idx = i + 1;
    if (!c || typeof c !== 'object') throw new Error(`Concept ${idx} is not an object`);

    for (const field of ['title', 'hook_type', 'hook_angle', 'script', 'creative_direction']) {
      if (!(field in c)) throw new Error(`Concept ${idx} missing field "${field}"`);
    }

    if (typeof c.title !== 'string') throw new Error(`Concept ${idx} title must be a string`);
    const titleWords = c.title.trim().split(/\s+/).filter(Boolean);
    if (titleWords.length < 1 || titleWords.length > 4) {
      throw new Error(`Concept ${idx} title must be 1 to 4 words, got ${titleWords.length} ("${c.title}")`);
    }

    if (!HOOK_TYPES.includes(c.hook_type)) {
      throw new Error(`Concept ${idx} hook_type "${c.hook_type}" not in [${HOOK_TYPES.join(', ')}]`);
    }

    if (typeof c.hook_angle !== 'string' || !c.hook_angle.trim()) {
      throw new Error(`Concept ${idx} hook_angle must be a non-empty string`);
    }

    if (typeof c.script !== 'string') throw new Error(`Concept ${idx} script must be a string`);
    const scriptWords = c.script.trim().split(/\s+/).filter(Boolean);
    if (scriptWords.length < 70 || scriptWords.length > 150) {
      throw new Error(`Concept ${idx} script must be 70 to 150 words, got ${scriptWords.length}`);
    }

    if (!Array.isArray(c.creative_direction) || c.creative_direction.length === 0) {
      throw new Error(`Concept ${idx} creative_direction must be a non-empty array`);
    }
    if (!c.creative_direction.every((x) => typeof x === 'string' && x.trim())) {
      throw new Error(`Concept ${idx} creative_direction must be all non-empty strings`);
    }
  });
}

/**
 * Insert 3 videos rows, create 3 ClickUp tasks with custom fields, wire
 * clickup_task_id back onto videos, then transition the existing claim row
 * from "pending" to "completed". On any write failure, roll back and either
 * release the claim (on clean rollback) or mark it failed_cleanup (on
 * partial rollback failure — halts automatic retry).
 */
async function writeConcepts({ campus, student, event, concepts, claimId }) {
  const INTERNAL_FIELD = process.env.CLICKUP_INTERNAL_VIDEO_NAME_FIELD_ID;
  const PROJECT_FIELD = process.env.CLICKUP_PROJECT_DESCRIPTION_FIELD_ID;
  if (!INTERNAL_FIELD || !PROJECT_FIELD) {
    throw new Error('CLICKUP_INTERNAL_VIDEO_NAME_FIELD_ID and CLICKUP_PROJECT_DESCRIPTION_FIELD_ID must be set in .env');
  }
  if (!campus.clickup_list_id) {
    throw new Error(`Campus ${campus.id} has no clickup_list_id configured`);
  }
  if (!claimId) {
    throw new Error('writeConcepts called without a claimId — atomic claim is required');
  }

  // Atomic 3-row insert
  const rows = concepts.map((c) => ({
    campus_id: campus.id,
    student_id: student.id,
    student_name: student.name,
    status: dbStatus('idea'),
    title: c.title,
    script: JSON.stringify(c),
  }));

  const { data: insertedVideos, error: iErr } = await supabase.from('videos').insert(rows).select('id, title');
  if (iErr) {
    await rollback({
      campusId: campus.id,
      eventId: event.id,
      claimId,
      videoIds: [],
      clickupTaskIds: [],
      cause: `videos insert failed: ${iErr.message}`,
    });
    throw new Error(`Supabase insert failed (videos): ${iErr.message}`);
  }
  if (!insertedVideos || insertedVideos.length !== 3) {
    await rollback({
      campusId: campus.id,
      eventId: event.id,
      claimId,
      videoIds: (insertedVideos || []).map((v) => v.id),
      clickupTaskIds: [],
      cause: `videos insert returned ${insertedVideos ? insertedVideos.length : 0} rows`,
    });
    throw new Error(`Expected 3 videos rows, got ${insertedVideos ? insertedVideos.length : 0}`);
  }

  const createdClickupIds = [];

  try {
    for (let i = 0; i < 3; i++) {
      const concept = concepts[i];
      const video = insertedVideos[i];

      const task = await clickup.createTask(campus.clickup_list_id, {
        name: concept.title,
        description: concept.hook_angle,
        status: 'idea',
      });

      const taskId = task.id;
      createdClickupIds.push(taskId);

      await clickup.setCustomField(taskId, INTERNAL_FIELD, concept.title);
      await clickup.setCustomField(taskId, PROJECT_FIELD, concept.script);

      const { error: uErr } = await supabase
        .from('videos')
        .update({ clickup_task_id: taskId, updated_at: new Date().toISOString() })
        .eq('id', video.id);
      if (uErr) throw new Error(`Supabase update failed (videos.clickup_task_id): ${uErr.message}`);
    }
  } catch (err) {
    await rollback({
      campusId: campus.id,
      eventId: event.id,
      claimId,
      videoIds: insertedVideos.map((v) => v.id),
      clickupTaskIds: createdClickupIds,
      cause: err.message,
    });
    throw err;
  }

  // All side effects succeeded — transition the claim to completed.
  const videoIds = insertedVideos.map((v) => v.id);
  const { error: uErr } = await supabase
    .from('processed_calendar_events')
    .update({ status: 'completed', video_ids: videoIds, completed_at: new Date().toISOString() })
    .eq('id', claimId);
  if (uErr) {
    // Data is consistent externally — videos and ClickUp tasks exist — but
    // we can't mark the claim completed. Leaving it pending would block
    // retry (good). Log loudly; operator can flip it manually.
    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'claim_completion_update_failed',
      status: 'error',
      errorMessage: uErr.message,
      payload: { claimId, videoIds, clickupTaskIds: createdClickupIds },
    });
    // Do not throw — external state is correct.
  }

  return { videoIds, clickupTaskIds: createdClickupIds };
}

/**
 * Unwind any partial state from a failed writeConcepts, then decide the
 * claim row's fate. If everything rolls back cleanly, delete the claim so
 * the event can retry on the next cron tick. If any compensating action
 * fails, mark the claim failed_cleanup to halt automatic retries — a
 * repeated retry loop would otherwise amplify orphans every 15 minutes.
 */
async function rollback({ campusId, eventId, claimId, videoIds, clickupTaskIds, cause }) {
  await log({
    campusId,
    agent: AGENT_NAME,
    action: 'rollback_started',
    status: 'error',
    errorMessage: cause,
    payload: { eventId, claimId, videoIds, clickupTaskIds },
  });

  let cleanupOk = true;
  const failures = [];

  if (videoIds.length) {
    const { error: delErr } = await supabase.from('videos').delete().in('id', videoIds);
    if (delErr) {
      cleanupOk = false;
      failures.push({ step: 'videos_delete', videoIds, message: delErr.message });
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'rollback_videos_delete_failed',
        status: 'error',
        errorMessage: delErr.message,
        payload: { videoIds },
      });
    }
  }

  for (const taskId of clickupTaskIds) {
    try {
      // ClickUp REST v2 has no hard delete. Archive is the closest available.
      await clickup.updateTask(taskId, { archived: true });
    } catch (err) {
      cleanupOk = false;
      failures.push({ step: 'clickup_archive', taskId, message: err.message });
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'rollback_clickup_archive_failed',
        status: 'error',
        errorMessage: err.message,
        payload: { taskId },
      });
    }
  }

  if (claimId) {
    if (cleanupOk) {
      // Clean rollback — release the claim so the next cron tick can retry.
      const { error: relErr } = await supabase.from('processed_calendar_events').delete().eq('id', claimId);
      if (relErr) {
        // Failed to delete the released claim; flip to failed_cleanup so we
        // don't silently block the event forever with no diagnostic.
        await supabase
          .from('processed_calendar_events')
          .update({
            status: 'failed_cleanup',
            error_payload: { cause, stage: 'claim_release', release_error: relErr.message },
          })
          .eq('id', claimId);
        await log({
          campusId,
          agent: AGENT_NAME,
          action: 'rollback_claim_release_failed',
          status: 'error',
          errorMessage: relErr.message,
          payload: { claimId, eventId },
        });
      }
    } else {
      // Partial cleanup — mark terminal so retries stop.
      const { error: upErr } = await supabase
        .from('processed_calendar_events')
        .update({ status: 'failed_cleanup', error_payload: { cause, failures } })
        .eq('id', claimId);
      if (upErr) {
        await log({
          campusId,
          agent: AGENT_NAME,
          action: 'rollback_claim_mark_failed',
          status: 'error',
          errorMessage: upErr.message,
          payload: { claimId, eventId },
        });
      }
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'rollback_quarantined',
        status: 'error',
        errorMessage: 'Partial cleanup — claim marked failed_cleanup; manual intervention required',
        payload: { claimId, eventId, failures },
      });
    }
  }

  await log({
    campusId,
    agent: AGENT_NAME,
    action: 'rollback_complete',
    payload: { eventId, claimId, videoIds, clickupTaskIds, cleanupOk },
  });
}

/**
 * Process every upcoming filming event for one campus. Swallows per-event
 * errors so one bad event does not stall the run.
 */
async function runForCampus(campus) {
  if (!campus.google_calendar_id) {
    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'campus_skipped_no_calendar',
      status: 'warning',
      payload: { campusName: campus.name },
    });
    return { events: 0, processed: 0, skipped: 0, errors: 0 };
  }

  await log({ campusId: campus.id, agent: AGENT_NAME, action: 'campus_run_started', payload: { campusName: campus.name } });

  let events = [];
  try {
    events = await gcal.listUpcomingFilmingEvents(campus.google_calendar_id, WINDOW_HOURS);
  } catch (err) {
    await log({
      campusId: campus.id,
      agent: AGENT_NAME,
      action: 'gcal_list_error',
      status: 'error',
      errorMessage: err.message,
      payload: { calendarId: campus.google_calendar_id, stack: err.stack },
    });
    throw err;
  }

  const stats = { events: events.length, processed: 0, skipped: 0, errors: 0 };

  for (const event of events) {
    try {
      const result = await processEvent(event, campus.id);
      if (result && result.skipped) stats.skipped++;
      else stats.processed++;
    } catch (_err) {
      // Already logged inside processEvent — continue to next event
      stats.errors++;
    }
  }

  await log({ campusId: campus.id, agent: AGENT_NAME, action: 'campus_run_complete', payload: stats });
  return stats;
}

/**
 * Cron entry. One run across every active campus. Mirrors research.runAll().
 */
async function runAll() {
  const { data: campuses, error } = await supabase
    .from('campuses')
    .select('id, name, clickup_list_id, google_calendar_id')
    .eq('active', true);

  if (error) {
    await log({ agent: AGENT_NAME, action: 'run_all_error', status: 'error', errorMessage: error.message });
    return;
  }

  for (const campus of campuses || []) {
    try {
      await runForCampus(campus);
    } catch (_err) {
      // Already logged — continue to next campus
    }
  }
}

/**
 * Orchestrator hook referenced by workflows/e2e-test.md. Alias for runAll().
 */
async function runOnce() {
  return runAll();
}

module.exports = {
  // Public API
  processEvent,
  runForCampus,
  runAll,
  runOnce,
  // Legacy alias (pre-stub signature was `run(studentName, campusId)`; now `run(event, campusId)`)
  run: processEvent,
  // Exposed for tests
  validateConcepts,
  buildPrompt,
  loadContext,
  writeConcepts,
};
