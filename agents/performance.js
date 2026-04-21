// Performance Analysis Agent — LLM-powered pattern recognition.
// Trigger: Scheduled every Monday at 7 AM.
//
// Steps:
//   1. Query performance table for last 4 weeks of view data
//   2. Query transcripts for top/bottom performing videos
//   3. Query research_library for external benchmarks
//   4. Send to Claude for pattern analysis
//   5. Write structured signals to performance_signals
//
// NOTE: Pattern recognition becomes meaningful at ~50+ videos.
// Early outputs will have limited signal — this is expected.

const { supabase } = require('../lib/supabase');
const { askJson } = require('../lib/claude');
const { log } = require('../lib/logger');
const selfHeal = require('../lib/self-heal');

const AGENT_NAME = 'performance';

const ANALYSIS_SYSTEM = `You are a video performance analyst for a student content agency (Alpha School).
You analyze view count data, video transcripts, and external benchmarks to find actionable patterns.

Your job is to identify what hooks, formats, topics, and pacing correlate with high vs low performance,
and produce a concise weekly brief the content team can act on immediately.

Return JSON only with this exact shape:
{
  "top_hooks": [{ "type": "string", "example": "string", "avg_views": number }],
  "top_formats": [{ "type": "string", "avg_views": number }],
  "top_topics": [{ "topic": "string", "avg_views": number }],
  "underperforming_patterns": ["string"],
  "recommendations": ["string"],
  "summary": "A 2-3 sentence plain English summary for Scott and the editing team."
}`;

/**
 * Run weekly performance analysis for a campus.
 * @param {string} campusId - Campus UUID
 * @returns {Promise<{ signalId: string, summary: string } | null>}
 */
async function run(campusId) {
  try {
    await log({ campusId, agent: AGENT_NAME, action: 'performance_run_started' });

    // 1. Get the date window — last 4 weeks
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const weekOf = getMondayDate(); // Current week identifier

    // 2. Query performance data for last 4 weeks
    const { data: perfData, error: pErr } = await supabase
      .from('performance')
      .select('video_id, platform, view_count, week_of')
      .eq('campus_id', campusId)
      .gte('created_at', fourWeeksAgo.toISOString())
      .order('view_count', { ascending: false });

    if (pErr) throw new Error(`Performance query failed: ${pErr.message}`);

    if (!perfData || perfData.length === 0) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'performance_run_skipped',
        status: 'warning',
        payload: { reason: 'no performance data in last 4 weeks' },
      });
      return null;
    }

    // 3. Aggregate views per video (sum across platforms/weeks)
    const videoViews = aggregateByVideo(perfData);
    const sorted = [...videoViews.entries()].sort((a, b) => b[1] - a[1]);
    const topN = Math.min(10, Math.ceil(sorted.length / 4));
    const topVideoIds = sorted.slice(0, topN).map(([id]) => id);
    const bottomVideoIds = sorted.slice(-topN).map(([id]) => id);
    const allRelevantIds = [...new Set([...topVideoIds, ...bottomVideoIds])];

    // 4. Fetch video details + transcripts for top/bottom
    const { data: videos } = await supabase
      .from('videos')
      .select('id, title, student_name, status, script')
      .in('id', allRelevantIds);

    const videoMap = new Map((videos || []).map((v) => [v.id, v]));

    // Build context for top performers
    const topContext = sorted.slice(0, topN).map(([id, views]) => {
      const v = videoMap.get(id);
      return {
        title: v?.title || 'Unknown',
        student: v?.student_name || null,
        views,
        transcript: v?.script ? v.script.slice(0, 500) : '(no transcript)',
      };
    });

    // Build context for bottom performers
    const bottomContext = sorted.slice(-topN).map(([id, views]) => {
      const v = videoMap.get(id);
      return {
        title: v?.title || 'Unknown',
        student: v?.student_name || null,
        views,
        transcript: v?.script ? v.script.slice(0, 500) : '(no transcript)',
      };
    });

    // 5. Pull recent research_library entries for benchmarks
    const { data: benchmarks } = await supabase
      .from('research_library')
      .select('hook_type, format, topic_tags, platform, view_count')
      .eq('campus_id', campusId)
      .order('scraped_at', { ascending: false })
      .limit(30);

    // 6. Build prompt and call Claude
    const prompt = buildAnalysisPrompt(perfData, topContext, bottomContext, benchmarks || [], sorted.length);
    const analysis = await askJson({
      system: ANALYSIS_SYSTEM,
      prompt,
      maxTokens: 2048,
    });

    // 7. Write to performance_signals
    const { data: signal, error: sErr } = await supabase
      .from('performance_signals')
      .insert({
        campus_id: campusId,
        week_of: weekOf,
        top_hooks: analysis.top_hooks || [],
        top_formats: analysis.top_formats || [],
        top_topics: analysis.top_topics || [],
        summary: analysis.summary || '',
        raw_output: analysis,
      })
      .select('id, summary')
      .single();

    if (sErr) throw new Error(`Failed to write performance_signals: ${sErr.message}`);

    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'performance_run_complete',
      payload: {
        signalId: signal.id,
        weekOf,
        videosAnalyzed: sorted.length,
        topHooks: (analysis.top_hooks || []).length,
        topFormats: (analysis.top_formats || []).length,
        topTopics: (analysis.top_topics || []).length,
      },
    });

    return { signalId: signal.id, summary: signal.summary };
  } catch (err) {
    // Cron-invoked; swallow after self-heal so runAll continues to next campus.
    // self-heal logs the original error itself (step 1 of the contract).
    // retryFn lets Claude's retry action re-invoke run() for transient 5xx.
    await selfHeal.handle(err, {
      agent: AGENT_NAME,
      action: 'run',
      campusId,
      retryFn: () => run(campusId),
    });
    return null;
  }
}

/**
 * Aggregate view counts per video_id (sum across platforms and weeks).
 * @returns {Map<string, number>}
 */
function aggregateByVideo(perfData) {
  const map = new Map();
  for (const row of perfData) {
    const current = map.get(row.video_id) || 0;
    map.set(row.video_id, current + (row.view_count || 0));
  }
  return map;
}

/**
 * Build the analysis prompt with all context.
 */
function buildAnalysisPrompt(perfData, topContext, bottomContext, benchmarks, totalVideos) {
  const platformBreakdown = {};
  for (const row of perfData) {
    if (!platformBreakdown[row.platform]) platformBreakdown[row.platform] = { count: 0, totalViews: 0 };
    platformBreakdown[row.platform].count++;
    platformBreakdown[row.platform].totalViews += row.view_count || 0;
  }

  let prompt = `## Performance Data — Last 4 Weeks\n\n`;
  prompt += `Total videos tracked: ${totalVideos}\n`;
  prompt += `Platform breakdown:\n`;
  for (const [platform, data] of Object.entries(platformBreakdown)) {
    prompt += `- ${platform}: ${data.count} entries, ${data.totalViews.toLocaleString()} total views (avg ${Math.round(data.totalViews / data.count).toLocaleString()}/video)\n`;
  }

  prompt += `\n## Top Performing Videos (${topContext.length})\n\n`;
  for (const v of topContext) {
    prompt += `**${v.title}** (${v.views.toLocaleString()} views${v.student ? `, student: ${v.student}` : ''})\n`;
    prompt += `Transcript excerpt: ${v.transcript}\n\n`;
  }

  prompt += `## Bottom Performing Videos (${bottomContext.length})\n\n`;
  for (const v of bottomContext) {
    prompt += `**${v.title}** (${v.views.toLocaleString()} views${v.student ? `, student: ${v.student}` : ''})\n`;
    prompt += `Transcript excerpt: ${v.transcript}\n\n`;
  }

  if (benchmarks.length > 0) {
    prompt += `## External Benchmarks (from research_library — ${benchmarks.length} recent entries)\n\n`;
    const hookCounts = {};
    const formatCounts = {};
    for (const b of benchmarks) {
      if (b.hook_type) hookCounts[b.hook_type] = (hookCounts[b.hook_type] || 0) + 1;
      if (b.format) formatCounts[b.format] = (formatCounts[b.format] || 0) + 1;
    }
    prompt += `Hook types trending externally: ${Object.entries(hookCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ')}\n`;
    prompt += `Formats trending externally: ${Object.entries(formatCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ')}\n`;
  }

  prompt += `\nAnalyze these patterns and return structured performance signals.`;
  if (totalVideos < 50) {
    prompt += ` Note: sample size is small (${totalVideos} videos) — hedge confidence accordingly.`;
  }

  return prompt;
}

/**
 * Get the Monday of the current week as YYYY-MM-DD.
 */
function getMondayDate() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Sunday = go back 6, else go to Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

/**
 * Run for all active campuses. Called by the cron scheduler.
 */
async function runAll() {
  const { data: campuses, error } = await supabase
    .from('campuses')
    .select('id, name')
    .eq('active', true);

  if (error) {
    await log({ agent: AGENT_NAME, action: 'run_all_error', status: 'error', errorMessage: error.message });
    return;
  }

  for (const campus of campuses) {
    try {
      await run(campus.id);
    } catch (err) {
      // Error already logged inside run()
    }
  }
}

module.exports = { run, runAll, aggregateByVideo, getMondayDate };
