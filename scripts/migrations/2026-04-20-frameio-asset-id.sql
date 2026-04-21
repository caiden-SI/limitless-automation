-- Migration: Frame.io asset ID column on videos.
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Used by handlers/frameio.js to look up the video when a comment.created
-- webhook fires. Frame.io webhooks carry the asset UUID in req.body.asset.id;
-- this column is the lookup key.
--
-- Upstream population is deferred: an editor currently pastes a Frame.io URL
-- into the ClickUp "E - Frame Link" custom field at the `edited` transition.
-- A follow-up will parse that URL (or call the Frame.io API) to populate
-- frameio_asset_id. Until then the handler logs "no matching video" for real
-- comments, which is the intended behavior.

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS frameio_asset_id text;

CREATE INDEX IF NOT EXISTS videos_frameio_asset_id
  ON videos (frameio_asset_id)
  WHERE frameio_asset_id IS NOT NULL;
