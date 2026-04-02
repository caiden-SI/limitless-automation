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
 * Send a prompt expecting a JSON response. Parses and returns the object.
 * @param {object} options - Same as ask()
 * @returns {Promise<object>} Parsed JSON from Claude's response
 */
async function askJson({ system, prompt, maxTokens = 2048 }) {
  const text = await ask({ system, prompt, maxTokens });

  // Strip markdown code fences if present
  const cleaned = text.replace(/```json\s?/g, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse Claude JSON response: ${err.message}\nRaw: ${text.slice(0, 500)}`);
  }
}

module.exports = { ask, askJson, MODEL };
