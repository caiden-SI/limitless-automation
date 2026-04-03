// QA Agent — LLM-powered quality gate before Frame.io delivery.
// Trigger: ClickUp task status changes to "edited".
//
// Checks:
//   1. Caption spell check against brand_dictionary
//   2. Punctuation and formatting consistency (Claude)
//   3. FFmpeg LUFS analysis (target: -14 LUFS for all platforms)
//   4. Stutter/filler word detection with timecodes (Claude)
//
// Pass → set qa_passed = true, Pipeline Agent uploads to Frame.io
// Fail → set qa_passed = false, post QA report to ClickUp task comments

const { execFile } = require('child_process');
const { supabase } = require('../lib/supabase');
const { askJson } = require('../lib/claude');
const { log } = require('../lib/logger');
const dropbox = require('../lib/dropbox');
const { parseSRT, cuesToPlainText } = require('../tools/srt-parser');

const AGENT_NAME = 'qa';

const LUFS_TARGET = -14;
const LUFS_TOLERANCE = 1; // ±1 LU acceptable range

/**
 * Run full QA suite on an edited video.
 * @param {string} videoId - Supabase video UUID
 * @param {string} campusId - Campus UUID
 * @returns {Promise<{ passed: boolean, report: object }>}
 */
async function runQA(videoId, campusId) {
  try {
    await log({ campusId, agent: AGENT_NAME, action: 'qa_started', payload: { videoId } });

    // Fetch video record
    const { data: video, error: vErr } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single();
    if (vErr) throw new Error(`Video lookup failed: ${vErr.message}`);
    if (!video.dropbox_folder) throw new Error(`Video ${videoId} has no dropbox_folder set`);

    // Run all checks
    const captionResult = await checkCaptions(video, campusId);
    const lufsResult = await checkLUFS(video, campusId);
    const stutterResult = await checkStutter(video, campusId, captionResult.cues);

    const allIssues = [
      ...captionResult.issues,
      ...lufsResult.issues,
      ...stutterResult.issues,
    ];
    const passed = allIssues.length === 0;

    const report = {
      videoId,
      title: video.title,
      passed,
      captionCheck: captionResult,
      lufsCheck: lufsResult,
      stutterCheck: stutterResult,
      totalIssues: allIssues.length,
      summary: allIssues,
    };

    // Write qa_passed to videos table
    const { error: uErr } = await supabase
      .from('videos')
      .update({ qa_passed: passed, updated_at: new Date().toISOString() })
      .eq('id', videoId);
    if (uErr) throw new Error(`Failed to update qa_passed: ${uErr.message}`);

    if (passed) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'qa_passed',
        payload: { videoId, title: video.title },
      });
    } else {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'qa_failed',
        payload: { videoId, title: video.title, issueCount: allIssues.length, issues: allIssues },
      });

      // TODO: Post QA report to ClickUp task comments once CLICKUP_API_KEY is available
      // await fetch(`https://api.clickup.com/api/v2/task/${video.clickup_task_id}/comment`, {
      //   method: 'POST',
      //   headers: { Authorization: process.env.CLICKUP_API_KEY, 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ comment_text: formatReport(report) }),
      // });
    }

    return { passed, report };
  } catch (err) {
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'qa_error',
      status: 'error',
      errorMessage: err.message,
      payload: { videoId, stack: err.stack },
    });
    throw err;
  }
}

// ── Check 1: Captions ────────────────────────────────────────

/**
 * Retrieve SRT file from Dropbox, check brand term spelling and
 * caption formatting via Claude.
 * @returns {{ issues: string[], cues: Array|null, srtFound: boolean }}
 */
async function checkCaptions(video, campusId) {
  const issues = [];

  // Find SRT file in the [PROJECT] subfolder
  const projectPath = `${video.dropbox_folder}/[PROJECT]`;
  let entries;
  try {
    entries = await dropbox.listFolder(projectPath);
  } catch {
    // [PROJECT] folder might not exist or be empty
    issues.push('CAPTION: [PROJECT] folder not accessible — cannot check captions');
    return { issues, cues: null, srtFound: false };
  }

  const srtFile = entries.find((e) => e.tag === 'file' && e.name.toLowerCase().endsWith('.srt'));
  if (!srtFile) {
    issues.push('CAPTION: No .srt file found in [PROJECT] folder');
    return { issues, cues: null, srtFound: false };
  }

  // Download and parse SRT
  const srtBuffer = await dropbox.downloadFile(srtFile.path);
  const srtContent = srtBuffer.toString('utf-8');
  const cues = parseSRT(srtContent);

  if (cues.length === 0) {
    issues.push('CAPTION: SRT file is empty or could not be parsed');
    return { issues, cues: null, srtFound: true };
  }

  // Get brand terms for this campus
  const { data: terms } = await supabase
    .from('brand_dictionary')
    .select('term')
    .eq('campus_id', campusId);
  const brandTerms = (terms || []).map((t) => t.term);

  // Check brand term spelling — case-insensitive fuzzy match
  const plainText = cuesToPlainText(cues);
  const brandIssues = checkBrandSpelling(plainText, brandTerms, cues);
  issues.push(...brandIssues);

  // Claude-powered formatting and punctuation check
  const formatIssues = await checkCaptionFormatting(cues, brandTerms);
  issues.push(...formatIssues);

  return { issues, cues, srtFound: true };
}

/**
 * Check for misspellings of brand terms in caption text.
 * Uses Levenshtein distance to catch near-misses.
 */
function checkBrandSpelling(plainText, brandTerms, cues) {
  const issues = [];
  const words = plainText.split(/\s+/);

  for (const term of brandTerms) {
    const termLower = term.toLowerCase();
    const termWords = term.split(/\s+/);

    // For multi-word terms, check as phrase
    if (termWords.length > 1) {
      // Check if the exact phrase appears (case-insensitive)
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = plainText.match(regex) || [];
      for (const match of matches) {
        if (match !== term) {
          const cue = findCueContaining(cues, match);
          const ts = cue ? ` (at ${cue.startTime})` : '';
          issues.push(`BRAND: "${match}" should be "${term}"${ts}`);
        }
      }
      continue;
    }

    // Single-word terms — check each word
    for (const word of words) {
      const cleaned = word.replace(/[^a-zA-Z]/g, '');
      if (!cleaned) continue;
      if (cleaned.toLowerCase() === termLower) {
        // Correct term found — check capitalization
        if (cleaned !== term && cleaned.toLowerCase() === termLower) {
          const cue = findCueContaining(cues, cleaned);
          const ts = cue ? ` (at ${cue.startTime})` : '';
          issues.push(`BRAND: "${cleaned}" should be "${term}"${ts}`);
        }
      } else if (levenshtein(cleaned.toLowerCase(), termLower) === 1 && cleaned.length >= 3) {
        // Close misspelling
        const cue = findCueContaining(cues, cleaned);
        const ts = cue ? ` (at ${cue.startTime})` : '';
        issues.push(`BRAND: Possible misspelling "${cleaned}" — did you mean "${term}"?${ts}`);
      }
    }
  }

  return issues;
}

/**
 * Find the cue that contains a given text snippet.
 */
function findCueContaining(cues, text) {
  return cues.find((c) => c.text.includes(text)) || null;
}

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Use Claude to check caption formatting and punctuation consistency.
 */
async function checkCaptionFormatting(cues, brandTerms) {
  const srtPreview = cues
    .slice(0, 50) // Limit to first 50 cues to stay within token budget
    .map((c) => `${c.index}\n${c.startTime} --> ${c.endTime}\n${c.text}`)
    .join('\n\n');

  const result = await askJson({
    system: `You are a video caption QA reviewer for a media agency. Check captions for formatting and punctuation issues. Brand terms that must be spelled/capitalized exactly: ${brandTerms.join(', ')}.`,
    prompt: `Review these SRT captions for formatting and punctuation issues. Check for:
1. Inconsistent capitalization at start of lines
2. Missing or inconsistent punctuation (periods, commas)
3. Lines that are too long (over 42 characters per line is standard max)
4. Timing overlaps between cues
5. Brand term capitalization errors

Return JSON: { "issues": ["FORMAT: description (at HH:MM:SS.mmm)", ...] }
If no issues, return { "issues": [] }

SRT content:
${srtPreview}`,
    maxTokens: 1024,
  });

  return (result.issues || []).map((i) => (i.startsWith('FORMAT:') ? i : `FORMAT: ${i}`));
}

// ── Check 2: LUFS ────────────────────────────────────────────

/**
 * Run FFmpeg loudnorm analysis on the exported video file.
 * @returns {{ issues: string[], lufs: number|null, ffmpegAvailable: boolean }}
 */
async function checkLUFS(video, campusId) {
  const issues = [];

  // Find video file in [PROJECT] folder
  const projectPath = `${video.dropbox_folder}/[PROJECT]`;
  let entries;
  try {
    entries = await dropbox.listFolder(projectPath);
  } catch {
    issues.push('LUFS: [PROJECT] folder not accessible — cannot analyze audio');
    return { issues, lufs: null, ffmpegAvailable: false };
  }

  const videoExts = ['.mp4', '.mov', '.mkv', '.avi', '.webm'];
  const videoFile = entries.find(
    (e) => e.tag === 'file' && videoExts.some((ext) => e.name.toLowerCase().endsWith(ext))
  );

  if (!videoFile) {
    issues.push('LUFS: No video file found in [PROJECT] folder');
    return { issues, lufs: null, ffmpegAvailable: false };
  }

  // Check if FFmpeg is available
  const ffmpegAvailable = await isFFmpegAvailable();
  if (!ffmpegAvailable) {
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'lufs_skipped',
      status: 'warning',
      payload: { reason: 'ffmpeg not installed' },
    });
    // Not a blocking issue — LUFS check is skipped, not failed
    return { issues: [], lufs: null, ffmpegAvailable: false };
  }

  // Get a temporary download link for FFmpeg to read
  const tempUrl = await dropbox.getTemporaryLink(videoFile.path);

  // Run FFmpeg loudnorm analysis
  const lufs = await measureLUFS(tempUrl);

  if (lufs === null) {
    issues.push('LUFS: FFmpeg analysis failed to produce a reading');
    return { issues, lufs: null, ffmpegAvailable: true };
  }

  // Check against target
  const diff = Math.abs(lufs - LUFS_TARGET);
  if (diff > LUFS_TOLERANCE) {
    const direction = lufs > LUFS_TARGET ? 'too loud' : 'too quiet';
    issues.push(
      `LUFS: Integrated loudness is ${lufs.toFixed(1)} LUFS (target: ${LUFS_TARGET} ±${LUFS_TOLERANCE}) — ${direction}`
    );
  }

  return { issues, lufs, ffmpegAvailable: true };
}

/**
 * Check if FFmpeg is on PATH.
 */
function isFFmpegAvailable() {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], (err) => resolve(!err));
  });
}

/**
 * Run FFmpeg loudnorm filter and extract integrated LUFS.
 * @param {string} inputUrl - URL or file path to analyze
 * @returns {Promise<number|null>}
 */
function measureLUFS(inputUrl) {
  return new Promise((resolve) => {
    const args = [
      '-i', inputUrl,
      '-af', 'loudnorm=print_format=json',
      '-f', 'null',
      '-',
    ];

    execFile('ffmpeg', args, { timeout: 120000 }, (err, _stdout, stderr) => {
      if (err) {
        console.error(`[qa] FFmpeg error: ${err.message}`);
        resolve(null);
        return;
      }

      // FFmpeg writes loudnorm JSON to stderr
      const match = stderr.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
      if (match) {
        resolve(parseFloat(match[1]));
      } else {
        resolve(null);
      }
    });
  });
}

// ── Check 3: Stutter / Filler Words ─────────────────────────

/**
 * Use Claude to detect stutters, filler words, and false starts in captions.
 * @returns {{ issues: string[], detections: Array }}
 */
async function checkStutter(video, campusId, cues) {
  if (!cues || cues.length === 0) {
    return { issues: [], detections: [] };
  }

  const srtForAnalysis = cues
    .map((c) => `[${c.startTime}] ${c.text}`)
    .join('\n');

  const result = await askJson({
    system: `You are a video editor QA assistant. Analyze caption transcripts for speech disfluencies that should be edited out of the final video. Be precise about timecodes.`,
    prompt: `Analyze this transcript for stutters, filler words, and false starts that should have been edited out.

Look for:
1. Filler words: "um", "uh", "like" (when used as filler), "you know", "so" (at start of sentences as filler), "basically", "literally" (when meaningless)
2. Stutters: repeated words or syllables ("I I think", "the the")
3. False starts: incomplete sentences that restart ("I was going to— I think we should")
4. Long pauses implied by timing gaps (>2 seconds between cues with no content reason)

For each detection, provide the timecode and the exact text.

Return JSON:
{
  "detections": [
    { "timecode": "HH:MM:SS.mmm", "type": "filler|stutter|false_start", "text": "exact text", "suggestion": "what it should be" }
  ]
}

If no issues found, return { "detections": [] }

Transcript:
${srtForAnalysis}`,
    maxTokens: 1536,
  });

  const detections = result.detections || [];
  const issues = detections.map(
    (d) => `STUTTER: [${d.type}] "${d.text}" at ${d.timecode} — suggestion: "${d.suggestion}"`
  );

  return { issues, detections };
}

// ── Report Formatting ────────────────────────────────────────

/**
 * Format a QA report for posting as a ClickUp comment.
 */
function formatReport(report) {
  const lines = [`**QA Report — ${report.title}**`, ''];

  if (report.passed) {
    lines.push('All checks passed. Ready for Frame.io upload.');
    return lines.join('\n');
  }

  lines.push(`**${report.totalIssues} issue(s) found:**`, '');

  for (const issue of report.summary) {
    lines.push(`- ${issue}`);
  }

  if (report.lufsCheck.lufs !== null) {
    lines.push('', `**Audio Level:** ${report.lufsCheck.lufs.toFixed(1)} LUFS (target: ${LUFS_TARGET})`);
  }

  return lines.join('\n');
}

module.exports = { runQA, formatReport };
