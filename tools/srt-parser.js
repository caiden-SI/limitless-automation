// SRT parser — deterministic tool for parsing SubRip caption files.
// Returns structured cue objects with index, timecodes, and text.

/**
 * Parse SRT content into an array of cues.
 * @param {string} raw - Raw SRT file content
 * @returns {Array<{ index: number, startTime: string, endTime: string, startMs: number, endMs: number, text: string }>}
 */
function parseSRT(raw) {
  const cues = [];
  // Normalize line endings and split on blank lines
  const blocks = raw.replace(/\r\n/g, '\n').trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    if (isNaN(index)) continue;

    const timeLine = lines[1];
    const match = timeLine.match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
    );
    if (!match) continue;

    const startTime = match[1].replace(',', '.');
    const endTime = match[2].replace(',', '.');
    const text = lines.slice(2).join('\n').trim();

    cues.push({
      index,
      startTime,
      endTime,
      startMs: timeToMs(startTime),
      endMs: timeToMs(endTime),
      text,
    });
  }

  return cues;
}

/**
 * Convert SRT timestamp to milliseconds.
 * @param {string} ts - Timestamp like "00:01:23.456"
 * @returns {number}
 */
function timeToMs(ts) {
  const [h, m, rest] = ts.split(':');
  const [s, ms] = rest.split('.');
  return parseInt(h) * 3600000 + parseInt(m) * 60000 + parseInt(s) * 1000 + parseInt(ms);
}

/**
 * Extract plain text from cues (all captions concatenated).
 * @param {Array} cues - Output from parseSRT
 * @returns {string}
 */
function cuesToPlainText(cues) {
  return cues.map((c) => c.text).join(' ');
}

module.exports = { parseSRT, timeToMs, cuesToPlainText };
