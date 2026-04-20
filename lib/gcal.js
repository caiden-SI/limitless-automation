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
 * @returns {Promise<Array<{ id: string, title: string, description: string, startTime: string }>>}
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
  }));
}

/**
 * Match a calendar event to a student via case-insensitive word-boundary
 * match on event title + description.
 *
 * Returns:
 *   { student, reason: 'matched', candidates: [name] }         — exactly one match
 *   { student: null, reason: 'no_student_match' }              — no name found
 *   { student: null, reason: 'ambiguous', candidates: [...] }  — 2+ names matched
 *
 * Ambiguous matches are rejected rather than silently resolved, because a
 * wrong match causes visible data corruption (videos + ClickUp tasks created
 * for the wrong student). Operators fix ambiguity by clarifying the event.
 *
 * @param {{ title: string, description: string }} event
 * @param {Array<{ id: string, name: string }>} campusStudents
 * @returns {{ student: object|null, reason: string, candidates?: string[] }}
 */
function parseStudentFromEvent(event, campusStudents) {
  if (!event || !Array.isArray(campusStudents) || campusStudents.length === 0) {
    return { student: null, reason: 'no_student_match' };
  }

  const haystack = `${event.title || ''} ${event.description || ''}`;
  if (!haystack.trim()) return { student: null, reason: 'no_student_match' };

  const matches = [];
  for (const student of campusStudents) {
    const name = (student.name || '').trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
    if (pattern.test(haystack)) {
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
