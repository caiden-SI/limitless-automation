#!/usr/bin/env node
// Reset a test student's onboarding so the flow can be re-run end to end.
// Usage: node scripts/reset-onboarding.js [name-substring]
//   default name-substring: "alex"
//
// Mirrors the SQL:
//   DELETE FROM onboarding_sessions WHERE student_id =
//     (SELECT id FROM students WHERE name ILIKE '%alex%');
//   UPDATE students SET onboarding_completed_at = NULL,
//     claude_project_context = NULL,
//     content_format_preference = 'script',
//     handle_tiktok = NULL, handle_instagram = NULL, handle_youtube = NULL
//     WHERE name ILIKE '%alex%';

require('dotenv').config();
const { supabase } = require('../lib/supabase');

async function run() {
  const needle = (process.argv[2] || 'alex').toLowerCase();

  const { data: students, error: sErr } = await supabase
    .from('students')
    .select('id, name, campus_id, onboarding_completed_at')
    .ilike('name', `%${needle}%`);

  if (sErr) {
    console.error('Student lookup failed:', sErr.message);
    process.exit(1);
  }
  if (!students || students.length === 0) {
    console.error(`No student found matching "${needle}"`);
    process.exit(1);
  }

  for (const s of students) {
    console.log(`\nResetting: ${s.name} (${s.id})`);

    const { error: dErr, count } = await supabase
      .from('onboarding_sessions')
      .delete({ count: 'exact' })
      .eq('student_id', s.id);
    if (dErr) {
      console.error(`  Session delete failed: ${dErr.message}`);
    } else {
      console.log(`  Sessions deleted: ${count ?? 0}`);
    }

    const { error: uErr } = await supabase
      .from('students')
      .update({
        onboarding_completed_at: null,
        claude_project_context: null,
        content_format_preference: 'script',
        handle_tiktok: null,
        handle_instagram: null,
        handle_youtube: null,
      })
      .eq('id', s.id);
    if (uErr) {
      console.error(`  Student update failed: ${uErr.message}`);
    } else {
      console.log(`  Student onboarding fields cleared`);
      console.log(`  /onboard URL: http://localhost:5173/onboard?student=${s.id}&campus=${s.campus_id}`);
    }
  }
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
