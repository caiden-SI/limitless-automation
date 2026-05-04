-- Migration: students.is_brand_account
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Background: most rows in `students` represent a single human creator.
-- A small number represent a brand or campus account ("Alpha High" — the
-- school's own social presence) that has its own handles, posts videos
-- through the same pipeline, but never goes through onboarding. The
-- backfill (Session 21) landed these as `student_id = null`, which left
-- 58 Alpha High videos unattributed in dashboard rollups.
--
-- A boolean discriminator lets the dashboard / agents distinguish brand
-- accounts from real students without having to special-case names. False
-- by default — every existing row is a person; only Alpha High flips true.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS is_brand_account boolean NOT NULL DEFAULT false;

-- A partial index on the brand rows so per-campus brand lookups stay
-- cheap as the table grows. Tiny today (1 row); harmless if it stays
-- tiny, useful if a future campus seeds its own brand account.
CREATE INDEX IF NOT EXISTS students_is_brand_account_idx
  ON students (campus_id)
  WHERE is_brand_account = true;
