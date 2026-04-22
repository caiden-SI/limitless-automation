-- Migration: Brand Voice Validation prerequisites.
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Adds:
--   1. students.content_format_preference — per-student content format, used by
--      the validator to select the right Layer 1 rule bucket (script vs
--      on-screen text vs caption-only vs mixed). Populated by Onboarding Section
--      5 going forward; defaults to 'script' for existing students.
--   2. video_quality_scores — one row per validated concept. Layer 1 + Layer 2
--      results persisted for calibration (retune thresholds after ≥20 rows).
--      Separate from videos.qa_passed, which covers editing-quality gates.
--
-- processed_calendar_events.error_payload jsonb already exists
-- (scripts/migrations/2026-04-20-scripting-agent.sql:27). The idempotent ALTER
-- below is defensive: if a future reader runs this against an older DB it
-- adds the column so the escalation path in agents/scripting.js works.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS content_format_preference text
    CHECK (content_format_preference IN ('script', 'on_screen_text', 'caption_only', 'mixed'))
    DEFAULT 'script';

CREATE TABLE IF NOT EXISTS video_quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  campus_id uuid NOT NULL REFERENCES campuses(id),
  validator_version text NOT NULL,
  layer1_passed boolean NOT NULL,
  layer1_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  layer2_passed boolean,
  layer2_scores jsonb,
  layer2_notes jsonb,
  overall_passed boolean NOT NULL,
  mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vqs_video_id
  ON video_quality_scores (video_id);

CREATE INDEX IF NOT EXISTS idx_vqs_campus_overall
  ON video_quality_scores (campus_id, overall_passed);

-- Defensive: only runs if the column is missing on an older DB.
ALTER TABLE processed_calendar_events
  ADD COLUMN IF NOT EXISTS error_payload jsonb;
