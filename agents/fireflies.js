// Fireflies Agent — owns every Fireflies consumer in the system.
// Trigger: cron at 9PM (env-gated by FIREFLIES_CRON_ENABLED in server.js).
//
// Two jobs in one agent (per workflows/fireflies-integration.md):
//   1. Pull full meeting transcripts → meeting_transcripts.
//   2. Extract action items via Claude → ClickUp tasks (status `idea`).
//
// Replaces Scott's `fireflies_sync.py` on cutover. The created_action_items
// ledger keeps OUR agent idempotent night-to-night (UNIQUE constraint on
// fireflies_id + action_item_hash). It does not dedup against Scott's last
// run's output — that 48-hour overlap is handled by manual archive once.

const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { askJson } = require('../lib/claude');
const { log } = require('../lib/logger');
const selfHeal = require('../lib/self-heal');
const fireflies = require('../lib/fireflies');
const clickup = require('../lib/clickup');

const AGENT_NAME = 'fireflies';

// Phase 1: single-campus mapping. When a second campus onboards, move
// this into a campuses.google_workspace_domain column and resolve via
// Supabase. Until then, the constant is the source of truth per SOP
// §"Data model additions".
const CAMPUS_DOMAIN_MAP = {
  'limitlessyt.com': '0ba4268f-f010-43c5-906c-41509bc9612f', // Austin
};

const TRANSCRIPT_TEXT_CAP_BYTES = 1_000_000; // 1 MB per SOP §"Validation"
const NAME_SUBSTRING_MIN = 3;

const EXTRACTION_SYSTEM = `You extract discrete action items from a meeting transcript.

Rules:
- Only items where someone commits to do something. "We should consider X" is NOT an action item; "Caiden will send Sarah the outline by Friday" IS.
- Capture implicit phrasings, not just explicit "action item:" callouts. Inferred owners count.
- Each item must be a single concrete action — split compound items.
- If an owner is named and you can identify their email from the participant list, include it as assignee_email. Otherwise omit.

Return JSON only, no prose:
{ "action_items": [ { "text": "...", "assignee_email": "..." }, ... ] }
If there are no action items, return { "action_items": [] }.`;

/**
 * Normalize action-item text for hashing. Lowercase, collapse whitespace,
 * strip trailing punctuation. Cosmetic differences ("send the outline." vs
 * "Send the outline") collapse to the same hash so dedup works across runs.
 */
function normalizeActionItem(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?;,]+$/, '')
    .trim();
}

function hashActionItem(text) {
  return crypto.createHash('sha256').update(normalizeActionItem(text)).digest('hex');
}

/**
 * Resolve a transcript to a student. Returns { studentId, ambiguous }.
 * Email match is exact-case against participant emails. Name fallback is
 * a case-insensitive substring of the student's name in the title, with
 * a minimum length to avoid matching "Al" against every "Alex".
 */
async function matchStudent(transcript, students) {
  const participantEmails = new Set(
    (transcript.participants || [])
      .map((p) => (typeof p === 'string' ? p : p?.email))
      .filter(Boolean)
  );

  const emailMatches = students.filter((s) => s.email && participantEmails.has(s.email));
  if (emailMatches.length === 1) return { studentId: emailMatches[0].id, ambiguous: false };
  if (emailMatches.length > 1) return { studentId: null, ambiguous: true };

  const title = (transcript.title || '').toLowerCase();
  const nameMatches = students.filter(
    (s) => s.name && s.name.length >= NAME_SUBSTRING_MIN && title.includes(s.name.toLowerCase())
  );
  if (nameMatches.length === 1) return { studentId: nameMatches[0].id, ambiguous: false };
  if (nameMatches.length > 1) return { studentId: null, ambiguous: true };

  return { studentId: null, ambiguous: false };
}

function resolveCampusFromOrganizer(organizerEmail) {
  if (!organizerEmail) return null;
  const at = organizerEmail.lastIndexOf('@');
  if (at < 0) return null;
  const domain = organizerEmail.slice(at + 1).toLowerCase();
  return CAMPUS_DOMAIN_MAP[domain] || null;
}

function buildTranscriptText(sentences) {
  if (!Array.isArray(sentences)) return '';
  const lines = sentences.map((s) => `${s.speaker_name || 'Unknown'}: ${s.text || ''}`);
  let out = lines.join('\n');
  if (Buffer.byteLength(out, 'utf8') > TRANSCRIPT_TEXT_CAP_BYTES) {
    out = out.slice(0, TRANSCRIPT_TEXT_CAP_BYTES);
  }
  return out;
}

/**
 * Claude pass over a transcript's sentences. Returns an array of
 * { text, assignee_email? } objects. Empty array when no action items.
 */
async function extractActionItems(transcript) {
  const transcriptForPrompt = buildTranscriptText(transcript.sentences);
  const participants = (transcript.participants || [])
    .map((p) => (typeof p === 'string' ? p : `${p?.name || ''} <${p?.email || ''}>`))
    .join(', ');

  const prompt = `Meeting: ${transcript.title || '(untitled)'}
Date: ${transcript.date || '(unknown)'}
Participants: ${participants || '(unknown)'}

Transcript:
${transcriptForPrompt}`;

  const result = await askJson({ system: EXTRACTION_SYSTEM, prompt, maxTokens: 2048 });
  const items = Array.isArray(result?.action_items) ? result.action_items : [];
  return items
    .filter((i) => i && typeof i.text === 'string' && i.text.trim().length > 0)
    .map((i) => ({
      text: i.text.trim(),
      assignee_email: typeof i.assignee_email === 'string' ? i.assignee_email.trim() : undefined,
    }));
}

async function getCampusListId(campusId) {
  const { data, error } = await supabase
    .from('campuses')
    .select('clickup_list_id')
    .eq('id', campusId)
    .maybeSingle();
  if (error) throw new Error(`Supabase query failed (campuses): ${error.message}`);
  return data?.clickup_list_id || null;
}

function fireflyTranscriptUrl(fireflyId) {
  return `https://app.fireflies.ai/view/${fireflyId}`;
}

/**
 * Step 3: retry pending ClickUp creates whose previous attempt failed.
 * Reads any created_action_items rows with null clickup_task_id and
 * tries the create again. Sustained failures stay null and surface on
 * the next run (and via agent_logs).
 */
async function retryPendingClickUpCreates(stats) {
  const { data: pending, error } = await supabase
    .from('created_action_items')
    .select('id, fireflies_id, action_item_hash, action_item_text, campus_id')
    .is('clickup_task_id', null);
  if (error) throw new Error(`Supabase query failed (created_action_items pending): ${error.message}`);

  for (const row of pending || []) {
    if (!row.campus_id) {
      stats.action_items_skipped_unmatched_campus++;
      continue;
    }
    try {
      const listId = await getCampusListId(row.campus_id);
      if (!listId) {
        stats.action_items_skipped_unmatched_campus++;
        continue;
      }
      const description = `${row.action_item_text}\n\nFireflies transcript: ${fireflyTranscriptUrl(row.fireflies_id)}`;
      const created = await clickup.createTask(listId, {
        name: row.action_item_text.slice(0, 200),
        description,
        status: 'idea',
      });
      const { error: updErr } = await supabase
        .from('created_action_items')
        .update({ clickup_task_id: created.id })
        .eq('id', row.id);
      if (updErr) throw new Error(`Supabase update failed: ${updErr.message}`);
      stats.action_items_retried++;
    } catch (err) {
      await log({
        campusId: row.campus_id,
        agent: AGENT_NAME,
        action: 'clickup_retry_failed',
        status: 'error',
        errorMessage: err.message,
        payload: { action_item_hash: row.action_item_hash, fireflies_id: row.fireflies_id },
      });
      // Leave clickup_task_id null; next run will retry again.
    }
  }
}

/**
 * Step 4: per-transcript extraction → ledger insert → ClickUp create.
 * Run for both newly-inserted transcripts AND skipped duplicates so a
 * failed extraction or ClickUp write can recover next run.
 */
async function syncActionItemsForTranscript(transcript, campusId, stats) {
  let items;
  try {
    items = await extractActionItems(transcript);
  } catch (err) {
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'extraction_failed',
      status: 'error',
      errorMessage: err.message,
      payload: { fireflies_id: transcript.id, title: transcript.title },
    });
    return;
  }

  stats.action_items_extracted += items.length;

  if (!campusId) {
    stats.action_items_skipped_unmatched_campus += items.length;
    return;
  }

  const listId = await getCampusListId(campusId);
  if (!listId) {
    stats.action_items_skipped_unmatched_campus += items.length;
    return;
  }

  for (const item of items) {
    const hash = hashActionItem(item.text);

    // Insert into the ledger. UNIQUE(fireflies_id, action_item_hash) means
    // a re-extracted item collides with a prior row — we then look up that
    // row and, if its ClickUp task was never created (null), retry with
    // the fresh text in hand. The persisted action_item_text on the row is
    // what step 3's pending-scan uses for transcripts that have rolled out
    // of the 48-hour fetch window.
    let ledgerId = null;
    let isFreshRetry = false;
    const { data: inserted, error: insErr } = await supabase
      .from('created_action_items')
      .insert({
        fireflies_id: transcript.id,
        action_item_hash: hash,
        action_item_text: item.text,
        campus_id: campusId,
      })
      .select('id')
      .maybeSingle();

    if (insErr) {
      if (insErr.code !== '23505') {
        await log({
          campusId,
          agent: AGENT_NAME,
          action: 'action_item_insert_failed',
          status: 'error',
          errorMessage: insErr.message,
          payload: { fireflies_id: transcript.id, hash },
        });
        continue;
      }
      // Conflict — look up existing row and decide skip vs in-window retry.
      const { data: existing, error: lookupErr } = await supabase
        .from('created_action_items')
        .select('id, clickup_task_id')
        .eq('fireflies_id', transcript.id)
        .eq('action_item_hash', hash)
        .maybeSingle();
      if (lookupErr || !existing) {
        stats.action_items_skipped_duplicate++;
        continue;
      }
      if (existing.clickup_task_id) {
        stats.action_items_skipped_duplicate++;
        continue;
      }
      ledgerId = existing.id;
      isFreshRetry = true;
    } else {
      ledgerId = inserted?.id || null;
    }

    if (!ledgerId) {
      stats.action_items_skipped_duplicate++;
      continue;
    }

    try {
      const description = `${item.text}\n\nFrom meeting: ${transcript.title || '(untitled)'}\nFireflies transcript: ${fireflyTranscriptUrl(transcript.id)}${item.assignee_email ? `\nProposed owner: ${item.assignee_email}` : ''}`;
      const created = await clickup.createTask(listId, {
        name: item.text.slice(0, 200),
        description,
        status: 'idea',
      });
      const { error: updErr } = await supabase
        .from('created_action_items')
        .update({ clickup_task_id: created.id })
        .eq('id', ledgerId);
      if (updErr) throw new Error(`Supabase update failed: ${updErr.message}`);
      if (isFreshRetry) stats.action_items_retried++;
      else stats.action_items_created++;
    } catch (err) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'clickup_create_failed',
        status: 'error',
        errorMessage: err.message,
        payload: { fireflies_id: transcript.id, hash },
      });
      // Leave clickup_task_id null; step 3 retries on the next run.
    }
  }
}

/**
 * Run the full nightly sync. Cron-invoked from server.js.
 */
async function run() {
  const stats = {
    fetched: 0,
    skipped_duplicate_transcripts: 0,
    inserted_transcripts: 0,
    action_items_extracted: 0,
    action_items_created: 0,
    action_items_retried: 0,
    action_items_skipped_duplicate: 0,
    action_items_skipped_unmatched_campus: 0,
    unmatched_student: 0,
    unmatched_campus: 0,
  };

  try {
    await log({ agent: AGENT_NAME, action: 'fireflies_run_started' });

    // Step 1: pull recent transcripts.
    const transcripts = await fireflies.fetchRecentTranscripts(48);
    stats.fetched = transcripts.length;

    // Pre-load students once. Single-tenant Phase 1 — fine to load all.
    const { data: students, error: sErr } = await supabase
      .from('students')
      .select('id, name, email, campus_id');
    if (sErr) throw new Error(`Supabase query failed (students): ${sErr.message}`);

    // Step 2: per-transcript ingest.
    const ingested = []; // { transcript, campusId } for step 4
    for (const t of transcripts) {
      try {
        if (!t.id || !t.date) {
          await log({
            agent: AGENT_NAME,
            action: 'transcript_rejected_missing_fields',
            status: 'warning',
            payload: { id: t.id || null, has_date: !!t.date, title: t.title },
          });
          continue;
        }

        // Hydrate sentences if the list query returned metadata only.
        let full = t;
        if (!Array.isArray(t.sentences) || t.sentences.length === 0) {
          full = (await fireflies.fetchTranscriptDetail(t.id)) || t;
        }

        const { studentId, ambiguous } = await matchStudent(full, students || []);
        if (ambiguous) {
          stats.unmatched_student++;
          await log({
            agent: AGENT_NAME,
            action: 'student_match_ambiguous',
            status: 'warning',
            payload: { fireflies_id: full.id, title: full.title },
          });
        } else if (!studentId) {
          stats.unmatched_student++;
        }

        let campusId = null;
        if (studentId) {
          const s = (students || []).find((row) => row.id === studentId);
          campusId = s?.campus_id || null;
        }
        if (!campusId) {
          campusId = resolveCampusFromOrganizer(full.organizer_email);
        }
        if (!campusId) {
          stats.unmatched_campus++;
          await log({
            agent: AGENT_NAME,
            action: 'campus_match_failed',
            status: 'warning',
            payload: {
              fireflies_id: full.id,
              title: full.title,
              organizer_email: full.organizer_email,
            },
          });
        }

        // Check existence — skip insert if already ingested, but still
        // hand to step 4 so a previous failed ClickUp write can retry.
        const { data: existing, error: exErr } = await supabase
          .from('meeting_transcripts')
          .select('id')
          .eq('fireflies_id', full.id)
          .maybeSingle();
        if (exErr) throw new Error(`Supabase query failed (meeting_transcripts): ${exErr.message}`);

        if (existing) {
          stats.skipped_duplicate_transcripts++;
        } else {
          const durationRaw = full.duration;
          let durationSeconds = null;
          if (typeof durationRaw === 'number') {
            // Fireflies sometimes returns ms; cap heuristic at 24h in seconds.
            durationSeconds = durationRaw > 86_400 ? Math.round(durationRaw / 1000) : Math.round(durationRaw);
          } else if (typeof durationRaw === 'string') {
            const parsed = parseFloat(durationRaw);
            if (!Number.isNaN(parsed)) {
              durationSeconds = parsed > 86_400 ? Math.round(parsed / 1000) : Math.round(parsed);
            }
          }

          const transcriptText = buildTranscriptText(full.sentences);
          const meetingDate = (() => {
            const d = new Date(full.date);
            return Number.isNaN(d.getTime()) ? null : d.toISOString();
          })();

          const { error: insErr } = await supabase.from('meeting_transcripts').insert({
            campus_id: campusId,
            student_id: studentId,
            fireflies_id: full.id,
            title: full.title || null,
            meeting_date: meetingDate,
            duration_seconds: durationSeconds,
            organizer_email: full.organizer_email || null,
            participants: full.participants || null,
            transcript_text: transcriptText,
            summary: full.summary?.overview || null,
            raw_payload: full,
          });
          if (insErr) {
            // 23505 means a concurrent insert won the race — treat as skip.
            if (insErr.code === '23505') {
              stats.skipped_duplicate_transcripts++;
            } else {
              throw new Error(`Supabase insert failed (meeting_transcripts): ${insErr.message}`);
            }
          } else {
            stats.inserted_transcripts++;
          }
        }

        ingested.push({ transcript: full, campusId });
      } catch (err) {
        await log({
          agent: AGENT_NAME,
          action: 'transcript_ingest_error',
          status: 'error',
          errorMessage: err.message,
          payload: { fireflies_id: t?.id, title: t?.title },
        });
      }
    }

    // Step 3: retry pending ClickUp creates from prior runs.
    await retryPendingClickUpCreates(stats);

    // Step 4: action-item sync per transcript (including duplicates).
    for (const { transcript, campusId } of ingested) {
      try {
        await syncActionItemsForTranscript(transcript, campusId, stats);
      } catch (err) {
        await log({
          agent: AGENT_NAME,
          action: 'action_item_sync_error',
          status: 'error',
          errorMessage: err.message,
          payload: { fireflies_id: transcript.id, title: transcript.title },
        });
      }
    }

    // Step 5: summary.
    await log({ agent: AGENT_NAME, action: 'fireflies_run_complete', payload: stats });
    return stats;
  } catch (err) {
    // Cron-invoked. Hand to self-heal with a single retry of the full run.
    await selfHeal.handle(err, {
      agent: AGENT_NAME,
      action: 'run',
      retryFn: () => run(),
    });
    return stats;
  }
}

module.exports = {
  run,
  extractActionItems,
  hashActionItem,
  normalizeActionItem,
  CAMPUS_DOMAIN_MAP,
};
