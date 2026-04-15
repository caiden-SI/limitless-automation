-- Migration: Create onboarding_sessions table for server-side conversation state.
-- Run in Supabase SQL Editor.
--
-- All conversation state lives here — the client never owns state.
-- Each student+campus pair has at most one active session.

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id),
  campus_id uuid NOT NULL REFERENCES campuses(id),
  current_section integer NOT NULL DEFAULT 1,
  current_question_index integer NOT NULL DEFAULT 0,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  influencer_transcripts jsonb NOT NULL DEFAULT '[]'::jsonb,
  industry_report text,
  conversation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  probed_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, campus_id)
);

CREATE INDEX IF NOT EXISTS onboarding_sessions_student
  ON onboarding_sessions (student_id, campus_id);
