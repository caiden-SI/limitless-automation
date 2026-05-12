// Google Calendar client — service-account JWT auth, read-only.
// Used by the Scripting Agent to poll upcoming filming events.

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

let _authClient = null;
let _calendar = null;

function getCalendar() {
  if (_calendar) return _calendar;

  const credPath = process.env.GOOGLE_CALENDAR_CREDENTIALS_PATH;
  if (!credPath) {
    throw new Error('GOOGLE_CALENDAR_CREDENTIALS_PATH not set in .env');
  }

  const resolved = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Google Calendar service account file not found: ${resolved}`);
  }

  const creds = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  _authClient = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [SCOPE],
  });
  _calendar = google.calendar({ version: 'v3', auth: _authClient });
  return _calendar;
}

/**
 * List upcoming events on the given calendar within the next `windowHours`.
 * @param {string} calendarId
 * @param {number} windowHours
 * @returns {Promise<Array<{ id: string, title: string, description: string, startTime: string, attendees: string[] }>>}
 */
async function listUpcomingFilmingEvents(calendarId, windowHours = 48) {
  if (!calendarId) throw new Error('listUpcomingFilmingEvents: calendarId required');

  const calendar = getCalendar();
  const now = new Date();
  const end = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId,
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
  });

  const items = res.data.items || [];
  return items.map((ev) => ({
    id: ev.id,
    title: ev.summary || '',
    description: ev.description || '',
    startTime: ev.start?.dateTime || ev.start?.date || null,
    attendees: (ev.attendees || [])
      .map((a) => (a.email || '').toLowerCase())
      .filter(Boolean),
  }));
}

/**
 * Match a calendar event to a student by deriving a name from each
 * non-ignored attendee email's local-part (e.g. `geetesh.parelly@alpha.school`
 * → `Geetesh Parelly`) and comparing case-insensitively to `students.name`.
 *
 * Emails listed in `SCRIPTING_IGNORED_ATTENDEE_EMAILS` (comma-separated env)
 * are filtered out first so always-present non-student invitees (Scott,
 * Charles, jack.oremus, …) don't generate phantom matches.
 *
 * Returns:
 *   { student, reason: 'matched', candidates: [name] }         — exactly one match
 *   { student: null, reason: 'no_student_match' }              — no attendee derived a known student
 *   { student: null, reason: 'ambiguous', candidates: [...] }  — 2+ students matched
 *
 * Ambiguous matches are rejected rather than silently resolved, because a
 * wrong match causes visible data corruption (videos + ClickUp tasks created
 * for the wrong student). Operators fix ambiguity by splitting the event
 * into per-student bookings.
 *
 * @param {{ attendees?: string[] }} event
 * @param {Array<{ id: string, name: string }>} campusStudents
 * @returns {{ student: object|null, reason: string, candidates?: string[] }}
 */
function parseStudentFromEvent(event, campusStudents) {
  if (!event || !Array.isArray(campusStudents) || campusStudents.length === 0) {
    return { student: null, reason: 'no_student_match' };
  }

  const ignored = (process.env.SCRIPTING_IGNORED_ATTENDEE_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const candidateEmails = (event.attendees || [])
    .map((e) => String(e).toLowerCase())
    .filter((e) => e && !ignored.includes(e));

  if (candidateEmails.length === 0) {
    return { student: null, reason: 'no_student_match' };
  }

  const matches = [];
  for (const email of candidateEmails) {
    const localPart = email.split('@')[0];
    if (!localPart) continue;

    const derivedName = localPart
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');

    const student = campusStudents.find(
      (s) => s.name && s.name.toLowerCase() === derivedName.toLowerCase()
    );

    if (student && !matches.find((m) => m.id === student.id)) {
      matches.push(student);
    }
  }

  if (matches.length === 0) return { student: null, reason: 'no_student_match' };
  if (matches.length === 1) {
    return { student: matches[0], reason: 'matched', candidates: [matches[0].name] };
  }
  return {
    student: null,
    reason: 'ambiguous',
    candidates: matches.map((s) => s.name),
  };
}

module.exports = { listUpcomingFilmingEvents, parseStudentFromEvent };
