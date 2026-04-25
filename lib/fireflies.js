// Fireflies GraphQL client — owns every Fireflies API call in the system.
// Auth: Bearer FIREFLIES_API_KEY.
// Spec: workflows/fireflies-integration.md §"Tools used"
//
// Two methods:
//   fetchRecentTranscripts(windowHours) — list query with inline sentences.
//   fetchTranscriptDetail(id)           — fallback for when the list query
//                                         was metadata-only.
//
// Both fail fast on parse error or non-2xx response, per SOP §"Validation".

const ENDPOINT = 'https://api.fireflies.ai/graphql';

function authHeader() {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key) throw new Error('FIREFLIES_API_KEY not set in .env');
  return `Bearer ${key}`;
}

async function gqlRequest(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Fireflies HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(`Fireflies response was not valid JSON: ${err.message}`);
  }

  if (json.errors && json.errors.length) {
    const msg = json.errors.map((e) => e.message).join('; ');
    throw new Error(`Fireflies GraphQL error: ${msg}`);
  }

  return json.data;
}

// Selection set kept in one place so the agent can rely on the same shape
// from both methods. Sentences inline; if Fireflies starts truncating the
// list query, switch the agent to fetchTranscriptDetail per-id without
// touching the field list.
const TRANSCRIPT_FIELDS = `
  id
  title
  date
  duration
  organizer_email
  participants
  summary { overview }
  sentences {
    text
    speaker_name
    start_time
  }
`;

/**
 * Fetch transcripts whose date falls within the last `windowHours` hours.
 * @param {number} [windowHours=48]
 * @returns {Promise<Array<object>>}
 */
async function fetchRecentTranscripts(windowHours = 48) {
  const fromDate = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const query = `
    query RecentTranscripts($fromDate: DateTime) {
      transcripts(fromDate: $fromDate) {
        ${TRANSCRIPT_FIELDS}
      }
    }
  `;
  const data = await gqlRequest(query, { fromDate });
  return Array.isArray(data?.transcripts) ? data.transcripts : [];
}

/**
 * Fetch a single transcript by Fireflies ID. Used when the list query
 * returns metadata only (Fireflies API change) or when an agent needs to
 * re-hydrate full sentences from a stored fireflies_id.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function fetchTranscriptDetail(id) {
  const query = `
    query TranscriptDetail($id: String!) {
      transcript(id: $id) {
        ${TRANSCRIPT_FIELDS}
      }
    }
  `;
  const data = await gqlRequest(query, { id });
  return data?.transcript || null;
}

module.exports = { fetchRecentTranscripts, fetchTranscriptDetail };
