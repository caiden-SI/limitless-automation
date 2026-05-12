# Calendar Attendee Matching — Build Spec

Implements Fix 10 from `iteration-3-fixes.md`. Switches Scripting from
name-in-title matching to attendee-email matching so the agent can
identify which student a calendar event belongs to once Scott starts
scheduling filming events.

Smaller-scope version: derives the student name from the email
local-part on the fly. No schema change required. If we ever hit a
case where a Supabase `students.name` doesn't match the derived form,
we add an `email` column then. Until then, every name in the current
roster maps cleanly.

---

## 1. Why this build

The current `parseStudentFromEvent` in `lib/gcal.js` looks for student
names as whole-word regex matches against the event TITLE + DESCRIPTION.
That worked under an earlier assumption that filming events would be
titled like `"Sarah Johnson filming"`. Scott's actual format
(confirmed 2026-05-07):

- **Event title:** constant string `"Limitless Student Videos"` for
  every filming event
- **Attendees:** the student is invited via their alpha.school email,
  format `first.last@alpha.school`
- **Always-present non-student attendees** (to be filtered out):
  - `scott@limitlessyt.com`
  - `charles@limitlessyt.com`
  - `jack.oremus@alpha.school`

The current code WILL fail silently the moment Scott schedules his
first event — the title `"Limitless Student Videos"` contains no
student name, so the matcher returns `no_student_match` and the agent
skips the event without producing scripts. Scott would notice when
expected scripts don't appear in ClickUp.

The current Profile-views rebuild + sheet sync (shipped 2026-05-11)
verified the end-to-end pipeline downstream of Scripting works. This
build unblocks Scripting itself.

---

## 2. Verified inputs (use these, don't re-discover)

### 2.1 Sample event shape that Scripting needs to handle

```json
{
  "summary": "Limitless Student Videos",
  "description": "",
  "start": { "dateTime": "2026-05-14T15:00:00-05:00" },
  "attendees": [
    { "email": "scott@limitlessyt.com" },
    { "email": "charles@limitlessyt.com" },
    { "email": "geetesh.parelly@alpha.school" }
  ]
}
```

Expected outcome: matcher identifies Geetesh Parelly (the only
non-ignored attendee), Scripting generates 3 concept scripts for him.

### 2.2 Student roster (all clean email-derivation candidates)

The current Austin campus roster has 9 students. Their names map
cleanly to the email pattern:

| students.name | Email-derived |
|---|---|
| Alex Mathews | alex.mathews → Alex Mathews ✓ |
| Alpha High | (brand account, never receives calendar invites — `is_brand_account = true`) |
| Austin Way | austin.way → Austin Way ✓ |
| Cruce Sanders | cruce.sanders → Cruce Sanders ✓ |
| Geetesh Parelly | geetesh.parelly → Geetesh Parelly ✓ |
| Jackson Price | jackson.price → Jackson Price ✓ |
| Maddie Price | maddie.price → Maddie Price ✓ |
| Reuben Runacres | reuben.runacres → Reuben Runacres ✓ |
| Stella Grams | stella.grams → Stella Grams ✓ |

Confirm by running this against Supabase before implementing:

```sql
SELECT id, name, is_brand_account
FROM students
WHERE campus_id = '0ba4268f-f010-43c5-906c-41509bc9612f'
ORDER BY name;
```

If any name has a middle initial, hyphen, or other variant that
wouldn't derive cleanly from `first.last@alpha.school`, flag before
proceeding. (Add an `email` column then; otherwise the email-local-part
approach works.)

### 2.3 Ignored emails (env-driven)

```
SCRIPTING_IGNORED_ATTENDEE_EMAILS=scott@limitlessyt.com,charles@limitlessyt.com,jack.oremus@alpha.school
```

Add to `.env` on both MacBook and Mac Mini. Add the same line to
`.env.example` so future operators see what's expected.

The matcher filters attendees by this list before deriving names.
Comma-separated, case-insensitive comparison.

---

## 3. Implementation, file-by-file

### 3.1 `lib/gcal.js` — `listUpcomingFilmingEvents`

Around line 42. The current return shape strips attendees from each
event. Add them back:

```javascript
return items.map((ev) => ({
  id: ev.id,
  title: ev.summary || '',
  description: ev.description || '',
  startTime: ev.start?.dateTime || ev.start?.date || null,
  attendees: (ev.attendees || [])
    .map((a) => (a.email || '').toLowerCase())
    .filter(Boolean),
}));
```

Attendees come back lowercased and de-duped (well, just lowercased —
Google Calendar shouldn't return dupes but we'll normalize anyway).

### 3.2 `lib/gcal.js` — `parseStudentFromEvent`

Around line 84. Full rewrite. Replace the title/description regex
matching with attendee-email derivation.

```javascript
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

    // Derive name: 'geetesh.parelly' → 'Geetesh Parelly'
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

  if (matches.length === 0) {
    return { student: null, reason: 'no_student_match' };
  }
  if (matches.length === 1) {
    return {
      student: matches[0],
      reason: 'matched',
      candidates: [matches[0].name],
    };
  }
  return {
    student: null,
    reason: 'ambiguous',
    candidates: matches.map((s) => s.name),
  };
}
```

Keep the same return shape (`{ student, reason, candidates }`) — the
agent already handles all three outcomes. Only the internal matching
logic changes.

### 3.3 `agents/scripting.js` — no changes needed

The agent already does:
```javascript
const matchResult = gcal.parseStudentFromEvent(event, students || []);
```

Same call, same return contract. The event now has `attendees` in
it (because `listUpcomingFilmingEvents` adds them), but `scripting.js`
doesn't read attendees directly — it just passes the event through.

Verify by inspection: the only reference to attendees in
`agents/scripting.js` should be none. If you find code that depends
on the old name-in-title matching, that's a separate bug worth
flagging.

### 3.4 `.env` and `.env.example`

Add to `.env.example`:
```
# Scripting ignored attendees — these emails on filming events are
# filtered out before the agent tries to match the event to a student.
# Used by lib/gcal.js parseStudentFromEvent.
SCRIPTING_IGNORED_ATTENDEE_EMAILS=scott@limitlessyt.com,charles@limitlessyt.com,jack.oremus@alpha.school
```

Add the same line to `.env` on both MacBook and Mac Mini after
implementation. (Use `echo '...' >> ~/limitless-automation/.env` on
the MacBook and the analogous SSH command for Mac Mini, as we did
during the Profile-views rebuild.)

---

## 4. Edge cases

- **Event has no attendees array** (single-person blocker on
  calendar): `attendees` will be empty array, matcher returns
  `no_student_match`. Agent skips. Correct.
- **All attendees are in the ignored list** (Scott + Charles +
  Jack, no student): same path — `no_student_match`, skip.
- **Two students at one event** (group filming): matcher returns
  `ambiguous`, skip. Logged warning so Caiden can see and split the
  event into per-student bookings if needed.
- **Attendee email is not `first.last@alpha.school` format**
  (e.g., a guest at `john@othercompany.com`): derived name won't
  match any `students.name`, attendee is effectively ignored. If
  it's the only non-ignored attendee, `no_student_match`. Safe.
- **Student in `students` table has unusual name** (e.g., middle
  initial, hyphen, accented characters): email-derivation won't
  match. Log warning, fall through to `no_student_match`. Add the
  `email` column later if this happens to anyone in the roster.
- **Empty/null `name` field on a `students` row**: `find` returns
  undefined, no match attempted against that student. Safe.

---

## 5. Verification protocol

### Step 1: Confirm roster maps cleanly

Run the SQL from §2.2. Spot-check each row's name against the
derived form. If all 9 students map cleanly, proceed. If anyone
doesn't, add an `email` column instead and pivot to schema-based
matching.

### Step 2: Schedule a test calendar event

Open the Limitless Student Videos calendar (whichever one is
configured in `campuses.google_calendar_id` for Austin). Create a
new event:

- **Title:** `Limitless Student Videos`
- **Date/time:** anywhere within the next 47 hours (to fit the
  agent's 48-hour lookahead window)
- **Attendees:**
  - `scott@limitlessyt.com`
  - `charles@limitlessyt.com`
  - `geetesh.parelly@alpha.school` (or pick any student in the
    roster, but the test must use a real student name that
    matches Supabase exactly)
- **Description:** leave empty or `"Test event for Scripting matcher verification"`

Save the event. Take note of the event ID if possible (visible in
the URL or via the Google Calendar API).

### Step 3: Wait for the next 15-minute cron tick OR trigger manually

The Scripting agent fires every 15 minutes. To verify quickly,
trigger manually:

```bash
cd ~/repos/limitless-automation && node -e "
require('dotenv').config();
require('./agents/scripting').runAll()
  .then(() => { console.log('done'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
"
```

### Step 4: Inspect `agent_logs`

```sql
SELECT created_at, action, status, payload
FROM agent_logs
WHERE agent_name = 'scripting'
  AND created_at > (now() - interval '15 minutes')
ORDER BY created_at;
```

Expected lifecycle for a successful match:

- `campus_run_started`
- `event_received` (payload contains the test event's title/id)
- `student_matched` (payload contains studentId, studentName)
- `event_claimed`
- `context_loaded`
- `validation_passed` (or `voice_validation_failed_retrying`
  if voice validation flags concepts)
- `event_processed` (payload contains videoIds and clickupTaskIds)
- `campus_run_complete`

If the matcher returned `no_student_match` or `ambiguous`, those
log rows will show up instead of `student_matched`. Investigate the
payload to identify which attendee/name combination failed.

### Step 5: Verify ClickUp got the tasks

Open ClickUp's Austin list. Look for 3 new tasks with the student's
name and the concept titles. The tasks should be in `idea` status
with the script populated in custom fields.

### Step 6: Clean up the test

- Delete the 3 ClickUp tasks (idea-status tasks safe to remove)
- Delete the 3 corresponding `videos` rows in Supabase:
  ```sql
  DELETE FROM videos
  WHERE clickup_task_id IN ('id1', 'id2', 'id3');
  ```
  (Get the IDs from the agent_logs `event_processed` payload.)
- Delete the test calendar event from Google Calendar
- Delete the `processed_calendar_events` row:
  ```sql
  DELETE FROM processed_calendar_events
  WHERE event_id = '<test event id>';
  ```

### Step 7: Promote to production behavior

The agent runs on the same cron schedule (every 15 min) in
production already. Once Step 4 passes, the next real filming event
Scott schedules will automatically produce scripts. No additional
deploy needed beyond shipping this code.

---

## 6. Acceptance criteria

1. **Roster verified clean.** All 9 current students' names map
   cleanly to email-local-part derivation.
2. **Code compiles.** `node -e "require('./lib/gcal')"` runs without
   error.
3. **Test event matches.** Step 4 of the verification shows
   `student_matched` with the right student name in the payload.
4. **Scripts generate.** Step 5 shows 3 new ClickUp tasks for the
   right student, with concept text in the custom fields.
5. **Ignored emails actually ignored.** A test event with only
   ignored emails (no student attendee) returns `no_student_match`
   and the agent skips silently.
6. **Multi-student event rejected.** A test event with two student
   emails as attendees returns `ambiguous`, agent skips, warning
   logged.
7. **No regression** to other Scripting paths (voice validation,
   campus_run_started/complete, ClickUp task creation, video row
   insertion).

---

## 7. Out of scope

- Adding `email` column to `students` table. Defer until needed.
- Supporting multi-student events (group filming). For now,
  ambiguous → skip is the safe default. If Scott wants group
  filming events later, build a separate flow.
- Following calendar event updates (Scott edits an attendee
  list after the event was processed). The atomic claim in
  `processed_calendar_events` prevents re-processing once an
  event is claimed; if Scott needs to retrigger after an attendee
  change, manual cleanup of the claim row is required for now.
- Calendar event format other than Scott's confirmed one.

---

## 8. Rollback

```bash
git revert <commit-sha>
~/deploy-limitless.sh
```

No data to clean up — this change only affects the matcher logic
at runtime. No new rows written to any table by the matcher itself.

`SCRIPTING_IGNORED_ATTENDEE_EMAILS` env var stays in `.env` as
documentation; nothing reads it after revert.

---

## 9. Claude Code kickoff prompt

```
Implement calendar attendee matching per
docs/calendar-attendee-matching-spec.md. Read end-to-end first.

The build is bounded to two files:
  - lib/gcal.js (listUpcomingFilmingEvents + parseStudentFromEvent)
  - .env.example (add SCRIPTING_IGNORED_ATTENDEE_EMAILS)

Plus add the same env var to .env on this machine (MacBook). Do NOT
push to the Mac Mini yet — verification happens against the local
.env first.

Verification steps in §5 of the spec require Caiden to create a
test calendar event before you can fully verify. Stop after the
code changes are made and the SQL roster check passes; do not
trigger Scripting manually or commit/push until Caiden has created
the test event and verified the matcher works.

If anything in the spec is ambiguous, stop and ask before guessing.
```

---

That's the full spec. Once Claude Code finishes the code changes
and the SQL roster check passes, you create a test calendar event,
run the verification, then commit/push/deploy if everything works.
