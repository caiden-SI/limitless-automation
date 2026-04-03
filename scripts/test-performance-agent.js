#!/usr/bin/env node
/**
 * Integration test — Performance Analysis Agent.
 *
 * Seeds synthetic performance data + videos, runs the agent,
 * verifies signals are written to performance_signals, then cleans up.
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const perf = require('../agents/performance');

const CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';

// Synthetic videos with varied performance
const TEST_VIDEOS = [
  { title: '__perf_test_viral_hook', script: 'Did you know that 90% of teens hate school? But what if I told you there was a place where kids build real companies instead of sitting in class? At Alpha School, students run startups, manage real money, and graduate with actual business experience.', views: { tiktok: 500000, instagram: 120000 } },
  { title: '__perf_test_day_in_life', script: 'Here\'s what a typical day looks like at Alpha School. I wake up at 6, hit the gym, then do 2 hours of accelerated academics. By 10am I\'m working on my startup. Today we\'re shooting content for our new product launch.', views: { tiktok: 300000, instagram: 90000 } },
  { title: '__perf_test_student_story', script: 'My name is Jake and I started my first company at 13. It was a disaster. I lost $500. But Alpha School taught me how to fail forward. Now at 15, my company does $5K a month in revenue.', views: { tiktok: 250000, instagram: 80000 } },
  { title: '__perf_test_tutorial', script: 'Step one: find a problem. Step two: talk to people who have that problem. Step three: build the simplest possible solution. That\'s it. That\'s how I built my first product in two weeks at Alpha School.', views: { tiktok: 180000, instagram: 60000 } },
  { title: '__perf_test_challenge', script: 'I challenged myself to make $1000 in 7 days using only skills I learned at Alpha School. Day 1: I identified three potential clients. Day 2: I pitched all three. Here\'s what happened.', views: { tiktok: 220000, instagram: 70000 } },
  { title: '__perf_test_boring_update', script: 'Quick update on what we\'ve been doing this week. We had some meetings. Working on some stuff. Things are going pretty well I think. More updates coming soon.', views: { tiktok: 8000, instagram: 2000 } },
  { title: '__perf_test_too_long', script: 'So I want to talk about something today. Actually before that let me give some context. So basically last year we started this thing and um it was kind of interesting but also not really because there were so many factors involved.', views: { tiktok: 5000, instagram: 1500 } },
  { title: '__perf_test_no_hook', script: 'Education is important. We all know that. Schools should teach more practical skills. Students should learn about business. Alpha School does this. It is good.', views: { tiktok: 12000, instagram: 3000 } },
];

async function run() {
  console.log('=== Performance Analysis Agent — Integration Test ===\n');
  const createdVideoIds = [];
  const createdPerfIds = [];
  let signalId = null;

  try {
    // Step 1: Seed test videos
    console.log('1. Seeding test videos...');
    for (const tv of TEST_VIDEOS) {
      const { data, error } = await supabase
        .from('videos')
        .insert({ campus_id: CAMPUS_ID, title: tv.title, script: tv.script, status: 'done' })
        .select('id')
        .single();
      if (error) throw new Error(`Video insert failed: ${error.message}`);
      tv.id = data.id;
      createdVideoIds.push(data.id);
    }
    console.log(`   [OK] ${createdVideoIds.length} test videos created`);

    // Step 2: Seed performance data (last 2 weeks)
    console.log('\n2. Seeding performance data...');
    const now = new Date();
    const week1 = new Date(now); week1.setDate(now.getDate() - 14);
    const week2 = new Date(now); week2.setDate(now.getDate() - 7);
    const weeks = [week1.toISOString().split('T')[0], week2.toISOString().split('T')[0]];

    for (const tv of TEST_VIDEOS) {
      for (const weekOf of weeks) {
        for (const [platform, views] of Object.entries(tv.views)) {
          // Add some variance between weeks
          const variance = Math.round(views * (0.8 + Math.random() * 0.4));
          const { data, error } = await supabase
            .from('performance')
            .insert({
              campus_id: CAMPUS_ID,
              video_id: tv.id,
              platform,
              view_count: variance,
              week_of: weekOf,
            })
            .select('id')
            .single();
          if (error) throw new Error(`Performance insert failed: ${error.message}`);
          createdPerfIds.push(data.id);
        }
      }
    }
    console.log(`   [OK] ${createdPerfIds.length} performance records created (${TEST_VIDEOS.length} videos × 2 platforms × 2 weeks)`);

    // Step 3: Seed some research_library benchmarks
    console.log('\n3. Seeding research_library benchmarks...');
    const benchmarks = [
      { hook_type: 'stat', format: 'talking-head', topic_tags: ['teen entrepreneurship'], platform: 'tiktok', view_count: 400000 },
      { hook_type: 'question', format: 'talking-head', topic_tags: ['education reform'], platform: 'tiktok', view_count: 350000 },
      { hook_type: 'story', format: 'day-in-life', topic_tags: ['student life'], platform: 'instagram', view_count: 200000 },
    ];
    const benchmarkUrls = [];
    for (const b of benchmarks) {
      const url = `https://test.perf.benchmark/${Date.now()}_${Math.random()}`;
      benchmarkUrls.push(url);
      await supabase.from('research_library').insert({
        campus_id: CAMPUS_ID,
        source_url: url,
        transcript: 'benchmark content',
        ...b,
        scraped_at: new Date().toISOString(),
      });
    }
    console.log(`   [OK] ${benchmarks.length} benchmarks seeded`);

    // Step 4: Run the Performance Agent
    console.log('\n4. Running Performance Analysis Agent...');
    const result = await perf.run(CAMPUS_ID);

    if (!result) {
      console.log('   [FAIL] Agent returned null (no data?)');
    } else {
      signalId = result.signalId;
      console.log(`   [OK] Signal written: ${result.signalId}`);
      console.log(`   Summary: ${result.summary}`);
    }

    // Step 5: Verify performance_signals entry
    console.log('\n5. Verifying performance_signals in Supabase...');
    const { data: signal } = await supabase
      .from('performance_signals')
      .select('*')
      .eq('id', signalId)
      .single();

    if (!signal) {
      console.log('   [FAIL] Signal not found');
    } else {
      console.log(`   week_of: ${signal.week_of}`);

      const hooks = signal.top_hooks || [];
      const formats = signal.top_formats || [];
      const topics = signal.top_topics || [];

      console.log(`   top_hooks (${hooks.length}): ${hooks.map((h) => h.type || h).join(', ')}`);
      console.log(`   top_formats (${formats.length}): ${formats.map((f) => f.type || f).join(', ')}`);
      console.log(`   top_topics (${topics.length}): ${topics.map((t) => t.topic || t).join(', ')}`);
      console.log(`   summary: ${signal.summary}`);

      const hasHooks = hooks.length > 0;
      const hasFormats = formats.length > 0;
      const hasTopics = topics.length > 0;
      const hasSummary = signal.summary && signal.summary.length > 20;
      const hasRawOutput = signal.raw_output && typeof signal.raw_output === 'object';

      console.log(`\n   top_hooks present:  ${hasHooks ? '[PASS]' : '[FAIL]'}`);
      console.log(`   top_formats present: ${hasFormats ? '[PASS]' : '[FAIL]'}`);
      console.log(`   top_topics present:  ${hasTopics ? '[PASS]' : '[FAIL]'}`);
      console.log(`   summary present:     ${hasSummary ? '[PASS]' : '[FAIL]'}`);
      console.log(`   raw_output stored:   ${hasRawOutput ? '[PASS]' : '[FAIL]'}`);

      // Check for underperforming patterns and recommendations
      const raw = signal.raw_output;
      const hasUnder = Array.isArray(raw.underperforming_patterns) && raw.underperforming_patterns.length > 0;
      const hasRecs = Array.isArray(raw.recommendations) && raw.recommendations.length > 0;
      console.log(`   underperforming_patterns: ${hasUnder ? '[PASS]' : '[WARN]'} (${(raw.underperforming_patterns || []).length})`);
      console.log(`   recommendations: ${hasRecs ? '[PASS]' : '[WARN]'} (${(raw.recommendations || []).length})`);

      if (hasRecs) {
        console.log('\n   Recommendations:');
        for (const r of raw.recommendations) console.log(`     - ${r}`);
      }
    }

    console.log('\n=== ALL CHECKS PASSED ===');
  } catch (err) {
    console.error(`\n[ERROR] ${err.message}`);
    console.error(err.stack);
  } finally {
    // Cleanup
    console.log('\n--- Cleanup ---');
    if (signalId) {
      await supabase.from('performance_signals').delete().eq('id', signalId);
      console.log('   Deleted performance signal');
    }
    if (createdPerfIds.length > 0) {
      await supabase.from('performance').delete().in('id', createdPerfIds);
      console.log(`   Deleted ${createdPerfIds.length} performance records`);
    }
    if (createdVideoIds.length > 0) {
      await supabase.from('videos').delete().in('id', createdVideoIds);
      console.log(`   Deleted ${createdVideoIds.length} test videos`);
    }
    // Clean benchmark entries
    await supabase.from('research_library').delete().like('source_url', 'https://test.perf.benchmark/%');
    console.log('   Deleted benchmark entries');
  }
}

run();
