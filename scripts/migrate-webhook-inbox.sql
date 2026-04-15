-- Migration: Create webhook_inbox table for durable event processing.
-- Run in Supabase SQL Editor.
--
-- Webhooks are inserted here immediately on receipt (before 200 response).
-- Processing happens asynchronously. Failed events are retried, not lost.

CREATE TABLE IF NOT EXISTS webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  failed_at timestamptz,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0
);

-- Index for finding unprocessed events
CREATE INDEX IF NOT EXISTS webhook_inbox_unprocessed
  ON webhook_inbox (received_at)
  WHERE processed_at IS NULL AND (failed_at IS NULL OR retry_count < 3);
