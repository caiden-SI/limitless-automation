#!/usr/bin/env node
// Operator tool — list, inspect, and release processed_calendar_events
// rows stuck in status='failed_cleanup'.
//
// A failed_cleanup claim means scripting.processEvent wrote some side
// effects (videos, ClickUp tasks) and the rollback could not fully
// reverse them. The claim is left in place to halt automatic retries —
// retrying would duplicate side effects on top of the orphans.
//
// "Release" = delete the claim row. The next scripting cron tick will
// re-process the event. Videos / ClickUp tasks from the prior attempt
// are NOT cleaned up by this script — the operator must investigate and
// clean up manually before releasing, or accept duplicates will be
// created on the retry.
//
// Usage:
//   node scripts/release-failed-cleanup.js                   # list all
//   node scripts/release-failed-cleanup.js <claim-id>        # show detail
//   node scripts/release-failed-cleanup.js <claim-id> --release
//   node scripts/release-failed-cleanup.js --release-all --confirm
//   node scripts/release-failed-cleanup.js --include-pending # also show orphaned pending rows

require('dotenv').config();

const { supabase } = require('../lib/supabase');

function fmtTs(ts) {
  if (!ts) return 'null';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function help() {
  console.log(`
Usage:
  node scripts/release-failed-cleanup.js                   List failed_cleanup claims
  node scripts/release-failed-cleanup.js <claim-id>        Inspect a claim
  node scripts/release-failed-cleanup.js <claim-id> --release
  node scripts/release-failed-cleanup.js --release-all --confirm
  node scripts/release-failed-cleanup.js --include-pending Also show orphaned pending rows

Release deletes the claim row only — it does NOT delete the videos or archive
the ClickUp tasks that were created before the failure. Clean those up manually
before releasing if you don't want the retry to create duplicates.
`);
}

async function listClaims(includePending) {
  const statuses = includePending ? ['failed_cleanup', 'pending'] : ['failed_cleanup'];

  const { data, error } = await supabase
    .from('processed_calendar_events')
    .select('id, campus_id, event_id, status, video_ids, processed_at, completed_at, error_payload')
    .in('status', statuses)
    .order('processed_at', { ascending: false });

  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  if (!data || data.length === 0) {
    console.log('No failed_cleanup claims.');
    if (!includePending) console.log('(pass --include-pending to also list orphaned pending rows)');
    return;
  }

  const campusIds = [...new Set(data.map((r) => r.campus_id))];
  const { data: campuses } = await supabase.from('campuses').select('id, name').in('id', campusIds);
  const campusById = new Map((campuses || []).map((c) => [c.id, c.name]));

  console.log(`\n${data.length} claim(s):\n`);
  console.log('  id                                   status          campus                  event_id                            processed_at         videos');
  console.log('  ' + '-'.repeat(150));
  for (const row of data) {
    const vids = Array.isArray(row.video_ids) ? row.video_ids.length : 0;
    const campus = (campusById.get(row.campus_id) || '?').padEnd(22).slice(0, 22);
    const eventId = (row.event_id || '').padEnd(34).slice(0, 34);
    console.log(
      `  ${row.id}  ${row.status.padEnd(14)}  ${campus}  ${eventId}  ${fmtTs(row.processed_at)}  ${vids}`
    );
  }

  if (data.some((r) => r.status === 'pending')) {
    console.log('\nNote: pending claims are in-flight OR orphans from a crash. Do not release without checking.');
  }
  console.log('\nInspect: node scripts/release-failed-cleanup.js <id>');
  console.log('Release: node scripts/release-failed-cleanup.js <id> --release');
}

async function inspectClaim(id) {
  const { data, error } = await supabase
    .from('processed_calendar_events')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  if (!data) { console.log(`No claim with id ${id}`); return; }

  const { data: campus } = await supabase
    .from('campuses').select('name').eq('id', data.campus_id).maybeSingle();

  console.log(`
Claim        : ${data.id}
Campus       : ${campus?.name || '(unknown)'} (${data.campus_id})
Event ID     : ${data.event_id}
Status       : ${data.status}
Processed at : ${fmtTs(data.processed_at)}
Completed at : ${fmtTs(data.completed_at)}
Video IDs    : ${Array.isArray(data.video_ids) ? data.video_ids.length : 0}`);

  if (Array.isArray(data.video_ids) && data.video_ids.length) {
    for (const vid of data.video_ids) console.log(`  - ${vid}`);

    // Check which still exist in Supabase.
    const { data: videos } = await supabase
      .from('videos')
      .select('id, title, status, clickup_task_id')
      .in('id', data.video_ids);
    if (videos && videos.length) {
      console.log(`\nOrphan videos still in Supabase (${videos.length}):`);
      for (const v of videos) {
        console.log(`  - ${v.id}  status=${v.status}  task=${v.clickup_task_id || 'null'}  "${v.title}"`);
      }
      console.log('\n(These were inserted by the failed run. They will NOT be deleted by --release.)');
    } else {
      console.log('\n✓ No matching videos in Supabase — rollback appears to have cleaned those up.');
    }
  }

  if (data.error_payload) {
    console.log('\nError payload:');
    console.log(JSON.stringify(data.error_payload, null, 2).split('\n').map((l) => '  ' + l).join('\n'));
  }

  console.log(`\nRelease: node scripts/release-failed-cleanup.js ${data.id} --release`);
}

async function releaseClaim(id) {
  // Fetch first to confirm status and show what's being released.
  const { data: claim, error: qErr } = await supabase
    .from('processed_calendar_events')
    .select('id, status, event_id, video_ids')
    .eq('id', id)
    .maybeSingle();
  if (qErr) throw new Error(`Supabase query failed: ${qErr.message}`);
  if (!claim) { console.log(`No claim with id ${id}`); return; }

  if (claim.status === 'completed') {
    console.log(`Refusing to release: claim status=completed. Completed claims intentionally dedup future runs — do not release them.`);
    return;
  }

  const vids = Array.isArray(claim.video_ids) ? claim.video_ids.length : 0;
  if (vids > 0) {
    console.log(`WARNING: this claim has ${vids} video_id(s) from the prior attempt. Releasing will allow retry, which will create duplicates unless you've already cleaned up.`);
    console.log('Check videos & ClickUp tasks first: node scripts/release-failed-cleanup.js ' + id);
  }

  const { error: dErr } = await supabase
    .from('processed_calendar_events')
    .delete()
    .eq('id', id);
  if (dErr) throw new Error(`Delete failed: ${dErr.message}`);

  console.log(`✓ Claim ${id} deleted. Next scripting cron tick will re-process event ${claim.event_id}.`);
}

async function releaseAll() {
  const { data, error } = await supabase
    .from('processed_calendar_events')
    .select('id, event_id, video_ids')
    .eq('status', 'failed_cleanup');
  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  if (!data || data.length === 0) { console.log('No failed_cleanup claims to release.'); return; }

  const withVideos = data.filter((r) => Array.isArray(r.video_ids) && r.video_ids.length > 0);
  if (withVideos.length) {
    console.log(`WARNING: ${withVideos.length} of ${data.length} claims have video_ids from prior attempts. Retries may create duplicates.`);
  }

  const { error: dErr } = await supabase
    .from('processed_calendar_events')
    .delete()
    .eq('status', 'failed_cleanup');
  if (dErr) throw new Error(`Bulk delete failed: ${dErr.message}`);

  console.log(`✓ Released ${data.length} claim(s). Next scripting cron tick will re-process.`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) { help(); return; }

  if (args.includes('--release-all')) {
    if (!args.includes('--confirm')) {
      console.log('--release-all requires --confirm to proceed.');
      console.log('Preview first: node scripts/release-failed-cleanup.js');
      return;
    }
    await releaseAll();
    return;
  }

  // First non-flag arg is a claim id.
  const claimId = args.find((a) => !a.startsWith('--'));
  const release = args.includes('--release');
  const includePending = args.includes('--include-pending');

  if (claimId && release) { await releaseClaim(claimId); return; }
  if (claimId) { await inspectClaim(claimId); return; }
  await listClaims(includePending);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
