-- Migration: Refresh videos_status_check to match CLAUDE.md status list.
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Background: Session 3 (2026-04-03) renamed the ClickUp statuses and the
-- codebase was updated to write the new uppercase equivalents via
-- agents/pipeline.js:dbStatus(). The videos table check constraint was
-- never refreshed, so the DB still rejects:
--   WAITING, UPLOADED TO DROPBOX, SENT TO CLIENT, REVISED, POSTED BY CLIENT
-- and still allows the stale "NEEDS REVISIONS".
--
-- Impact surfaced in Session 9 while testing self-heal mark_waiting:
--   - pipeline.triggerQA fails closed on every QA-failure write
--   - pipeline.handleReviewComment fails on every Frame.io comment event
--   - self-heal.mark_waiting cannot write WAITING
-- None of these paths have been exercised against live data yet, which is
-- why the bug stayed hidden.
--
-- Fix: drop + recreate with the full uppercase status set from CLAUDE.md.

ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_status_check;

ALTER TABLE videos
  ADD CONSTRAINT videos_status_check CHECK (status IN (
    'IDEA',
    'READY FOR SHOOTING',
    'READY FOR EDITING',
    'IN EDITING',
    'EDITED',
    'UPLOADED TO DROPBOX',
    'SENT TO CLIENT',
    'REVISED',
    'POSTED BY CLIENT',
    'DONE',
    'WAITING'
  ));
