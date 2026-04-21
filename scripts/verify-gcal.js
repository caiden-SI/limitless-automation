#!/usr/bin/env node
// Google Calendar connectivity check.
//
// Runs five diagnostic steps against the live Google Calendar API using the
// service-account JWT configured in .env, and reports exactly where it fails.
// Useful for verifying:
//   1. Credentials path env var set
//   2. Service account JSON file present and parseable
//   3. JWT auth succeeds
//   4. Austin campus has a google_calendar_id in Supabase
//   5. Service account has at least read access to that calendar
//
// Run: node scripts/verify-gcal.js

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const gcal = require('../lib/gcal');
const { supabase } = require('../lib/supabase');

function ok(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ ${msg}`); }
function info(msg) { console.log(`    ${msg}`); }
function step(n, msg) { console.log(`\n[${n}] ${msg}`); }

async function main() {
  let exitCode = 0;
  let serviceAccountEmail = null;

  step(1, 'Env var: GOOGLE_CALENDAR_CREDENTIALS_PATH');
  const credPath = process.env.GOOGLE_CALENDAR_CREDENTIALS_PATH;
  if (!credPath) {
    fail('GOOGLE_CALENDAR_CREDENTIALS_PATH not set in .env');
    info('Add: GOOGLE_CALENDAR_CREDENTIALS_PATH=./credentials/google-calendar-sa.json');
    return 1;
  }
  ok(`path = ${credPath}`);

  step(2, 'Service account JSON file');
  const resolved = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
  if (!fs.existsSync(resolved)) {
    fail(`File not found: ${resolved}`);
    info('To provision:');
    info('  1. Google Cloud Console → IAM & Admin → Service Accounts → Create');
    info('  2. Grant no project-level roles (calendar access is per-calendar)');
    info('  3. Keys → Add Key → JSON → download');
    info(`  4. Save to ${resolved}`);
    info('  5. Share the target Google Calendar with the service account email');
    info('     (role: "See all event details" or higher)');
    return 1;
  }
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    fail(`JSON parse failed: ${err.message}`);
    return 1;
  }
  if (!creds.client_email || !creds.private_key) {
    fail('JSON missing client_email or private_key');
    return 1;
  }
  serviceAccountEmail = creds.client_email;
  ok(`file present, client_email = ${serviceAccountEmail}`);

  step(3, 'Austin campus google_calendar_id in Supabase');
  const { data: campus, error: cErr } = await supabase
    .from('campuses')
    .select('name, google_calendar_id')
    .ilike('name', '%austin%')
    .maybeSingle();
  if (cErr) { fail(`Supabase query failed: ${cErr.message}`); return 1; }
  if (!campus) { fail('No Austin campus row found'); return 1; }
  if (!campus.google_calendar_id) {
    fail(`campus.google_calendar_id is null for ${campus.name}`);
    info('Update campuses.google_calendar_id with the calendar ID Scott owns');
    return 1;
  }
  ok(`${campus.name}: google_calendar_id = ${campus.google_calendar_id}`);
  const calendarId = campus.google_calendar_id;

  step(4, 'JWT auth (calling calendar.events.list)');
  let events;
  try {
    events = await gcal.listUpcomingFilmingEvents(calendarId, 48);
  } catch (err) {
    fail(`API call failed: ${err.message}`);
    const code = err.code || err.response?.status;
    if (code === 404) {
      info('404 — calendar does not exist, OR the service account has no access');
      info(`Fix: share ${calendarId} with ${serviceAccountEmail}`);
      info('     (Google Calendar → Settings → share with specific people)');
    } else if (code === 403) {
      info('403 — calendar API disabled or insufficient permissions');
      info('Fix: enable Google Calendar API in the GCP project for this service account');
    } else if (code === 401 || /invalid_grant|invalid_token/i.test(err.message)) {
      info('401 — JWT auth failed. Check the private_key and client_email fields.');
    }
    return 1;
  }
  ok(`API call succeeded — ${events.length} event(s) in the next 48 hours`);

  step(5, 'Event sample');
  if (events.length === 0) {
    info('(no upcoming events — that is fine; connectivity is proven)');
    info('Add a test event titled "Filming with <student name>" to exercise scripting cron');
  } else {
    for (const ev of events.slice(0, 5)) {
      info(`• ${ev.startTime}  ${ev.title}`);
    }
    if (events.length > 5) info(`  ... and ${events.length - 5} more`);
  }

  console.log('\n✓ GCal connectivity verified');
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
