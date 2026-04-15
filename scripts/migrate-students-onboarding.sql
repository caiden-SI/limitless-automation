-- Migration: Add onboarding columns to students table
-- Run in Supabase SQL Editor before building the Student Onboarding Agent.

-- Context document (full markdown output from onboarding conversation)
ALTER TABLE students ADD COLUMN IF NOT EXISTS claude_project_context text;

-- Timestamp when the student completed the onboarding flow
ALTER TABLE students ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Social media handles (extracted during conversation)
ALTER TABLE students ADD COLUMN IF NOT EXISTS handle_tiktok text;
ALTER TABLE students ADD COLUMN IF NOT EXISTS handle_instagram text;
ALTER TABLE students ADD COLUMN IF NOT EXISTS handle_youtube text;
