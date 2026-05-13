// Student helpers — shared between the CLI (scripts/create-student.js)
// and the admin HTTP routes (routes/admin-students.js).
//
// Encapsulates the previously-duplicated logic for resolving campus IDs
// from slugs, normalizing handles, guarding against duplicate names, and
// composing the personalized onboarding URL.

const { supabase } = require('./supabase');

const KNOWN_CAMPUS_SLUGS = {
  austin: '0ba4268f-f010-43c5-906c-41509bc9612f',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Custom error type so route handlers can map duplicate-name to HTTP 409. */
class DuplicateStudentNameError extends Error {
  constructor({ name, campusId, existingStudentId, existingUrl }) {
    super(`Student named "${name}" already exists on campus ${campusId} (id ${existingStudentId})`);
    this.code = 'DUPLICATE_STUDENT_NAME';
    this.name = 'DuplicateStudentNameError';
    this.existingStudentId = existingStudentId;
    this.existingUrl = existingUrl;
  }
}

/**
 * Resolve a campus input (UUID, slug, or partial name) to a campus UUID.
 * Throws when the input doesn't match any campus or matches more than one.
 */
async function resolveCampusId(campusInput) {
  if (campusInput && UUID_RE.test(campusInput)) return campusInput;

  const lower = String(campusInput || '').toLowerCase();
  if (KNOWN_CAMPUS_SLUGS[lower]) return KNOWN_CAMPUS_SLUGS[lower];

  const { data, error } = await supabase
    .from('campuses')
    .select('id, name')
    .ilike('name', `%${campusInput}%`)
    .limit(2);

  if (error) throw new Error(`campuses query failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`No campus found matching "${campusInput}". Add it via Supabase or pass a UUID directly.`);
  }
  if (data.length > 1) {
    throw new Error(`Multiple campuses match "${campusInput}": ${data.map((c) => c.name).join(', ')}. Be more specific or pass a UUID.`);
  }
  return data[0].id;
}

/** Strip whitespace + leading `@`. Empty / non-string becomes null. */
function normalizeHandle(h) {
  if (!h || typeof h !== 'string') return null;
  const trimmed = h.trim().replace(/^@/, '');
  return trimmed || null;
}

/**
 * Compose the onboarding URL. Throws if PUBLIC_DASHBOARD_URL is unset —
 * spec §5.3 explicitly closes the latent fallback-to-placeholder bug.
 */
function composeOnboardingUrl({ studentId, campusId }) {
  const base = process.env.PUBLIC_DASHBOARD_URL;
  if (!base || !base.trim()) {
    throw new Error(
      'PUBLIC_DASHBOARD_URL must be set in .env to compose onboarding URLs. ' +
        'Example: PUBLIC_DASHBOARD_URL=https://limitless-automations-mac-mini.tail15aca0.ts.net'
    );
  }
  return `${base.replace(/\/$/, '')}/onboard?student=${studentId}&campus=${campusId}`;
}

/**
 * Insert a new student row and return the personalized onboarding URL.
 * Caller is responsible for resolving `campusId` to a UUID (use
 * resolveCampusId if a slug is supplied).
 *
 * Throws DuplicateStudentNameError on a case-insensitive collision with
 * an existing student on the same campus; throws plain Error for other
 * failure modes.
 *
 * Returns `{ studentId, name, url }` on success.
 */
async function createStudent({ name, tiktokHandle, instagramHandle, campusId }) {
  if (!name || !String(name).trim()) throw new Error('name is required');
  if (!campusId) throw new Error('campusId is required');

  const cleanName = String(name).trim();
  const tiktok = normalizeHandle(tiktokHandle);
  const instagram = normalizeHandle(instagramHandle);

  // Duplicate-name guard. Scripting's parseStudentFromEvent matches by
  // whole-word name, so two students with the same name on the same
  // campus would always trigger an "ambiguous" rejection downstream.
  const { data: existing, error: dupErr } = await supabase
    .from('students')
    .select('id, name')
    .eq('campus_id', campusId)
    .ilike('name', cleanName);

  if (dupErr) throw new Error(`duplicate-check query failed: ${dupErr.message}`);
  if (existing && existing.length > 0) {
    const existingStudentId = existing[0].id;
    throw new DuplicateStudentNameError({
      name: cleanName,
      campusId,
      existingStudentId,
      existingUrl: composeOnboardingUrl({ studentId: existingStudentId, campusId }),
    });
  }

  const insertRow = { campus_id: campusId, name: cleanName };
  if (tiktok) insertRow.handle_tiktok = tiktok;
  if (instagram) insertRow.handle_instagram = instagram;

  const { data: inserted, error: insErr } = await supabase
    .from('students')
    .insert(insertRow)
    .select('id, name, campus_id')
    .single();

  if (insErr) throw new Error(`students insert failed: ${insErr.message}`);

  return {
    studentId: inserted.id,
    name: inserted.name,
    url: composeOnboardingUrl({ studentId: inserted.id, campusId: inserted.campus_id }),
  };
}

/**
 * Return the most recent non-brand students for a campus. UI uses this
 * for the "RECENT STUDENTS" strip on /students. Defaults to 10 rows.
 */
async function recentStudents({ campusId, limit = 10 }) {
  if (!campusId) throw new Error('campusId is required');

  const { data, error } = await supabase
    .from('students')
    .select('id, name, created_at, onboarding_completed_at')
    .eq('campus_id', campusId)
    .eq('is_brand_account', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`recentStudents query failed: ${error.message}`);
  return data || [];
}

module.exports = {
  KNOWN_CAMPUS_SLUGS,
  DuplicateStudentNameError,
  resolveCampusId,
  normalizeHandle,
  composeOnboardingUrl,
  createStudent,
  recentStudents,
};
