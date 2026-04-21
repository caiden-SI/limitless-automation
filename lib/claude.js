// Claude API client — all agents call claude-sonnet-4-20250514 through this module.
// Wraps the Anthropic SDK with consistent error handling and logging.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-20250514';

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('Missing ANTHROPIC_API_KEY in environment');
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Send a prompt to Claude and return the text response.
 * @param {object} options
 * @param {string} options.system - System prompt defining agent role
 * @param {string} options.prompt - User message / task content
 * @param {number} [options.maxTokens=2048] - Max response tokens
 * @returns {Promise<string>} Claude's text response
 */
async function ask({ system, prompt, maxTokens = 2048 }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract text from response content blocks
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return text;
}

/**
 * Extract a balanced JSON structure starting at `start`, where text[start]
 * is either '{' or '['. Returns the substring of the matched structure, or
 * null if brackets never balance. Correctly skips brackets inside string
 * literals and their escape sequences.
 *
 * @param {string} text
 * @param {number} start - index of the opening '{' or '['
 * @returns {string|null}
 */
function extractBalanced(text, start) {
  let depth = 1;
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse a Claude response that may include markdown fences, leading prose
 * ("Here's the result: {...}"), or trailing prose ("{...} This concludes the
 * analysis."). Strips fences, then walks the text looking for the first
 * balanced JSON structure that actually parses as JSON. Tries each {/[
 * opener in order so a leading "[see below]" prose fragment doesn't trap us.
 *
 * Throws if no parseable JSON structure is found.
 *
 * Exported for direct testing via scripts/test-claude-askjson.js.
 *
 * @param {string} text - raw Claude response
 * @returns {object|Array} parsed JSON
 */
function parseClaudeJson(text) {
  // Strip markdown code fences: ```json, ```JSON, bare ```
  const defenced = text.replace(/```(?:json)?\s?/gi, '').replace(/```/g, '').trim();

  for (let start = 0; start < defenced.length; start++) {
    const c = defenced[start];
    if (c !== '{' && c !== '[') continue;

    const candidate = extractBalanced(defenced, start);
    if (!candidate) continue;

    try {
      return JSON.parse(candidate);
    } catch {
      // This opener didn't yield a parseable structure — try the next one.
      // Handles pathological cases like "[see below] {...}" where the first
      // bracket is inside prose, not JSON.
    }
  }

  throw new Error('No parseable JSON structure found in response');
}

/**
 * Send a prompt expecting a JSON response. Parses and returns the object.
 * Tolerates Claude's common response shapes: raw JSON, fenced JSON,
 * leading preamble ("Here's the result:..."), and trailing explanation.
 * @param {object} options - Same as ask()
 * @returns {Promise<object>} Parsed JSON from Claude's response
 */
async function askJson({ system, prompt, maxTokens = 2048 }) {
  const text = await ask({ system, prompt, maxTokens });

  try {
    return parseClaudeJson(text);
  } catch (err) {
    throw new Error(`Failed to parse Claude JSON response: ${err.message}\nRaw: ${text.slice(0, 500)}`);
  }
}

/**
 * Send a multi-turn conversation to Claude and return the text response.
 * Used by the onboarding agent where full conversation history is required.
 * @param {object} options
 * @param {string} options.system - System prompt
 * @param {Array<{role: string, content: string}>} options.messages - Full conversation history
 * @param {number} [options.maxTokens=2048] - Max response tokens
 * @returns {Promise<string>} Claude's text response
 */
async function askConversation({ system, messages, maxTokens = 2048 }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return text;
}

module.exports = { ask, askJson, askConversation, parseClaudeJson, extractBalanced, MODEL };
