-- 005_calls_log.sql
-- Tracks outbound Vapi calls so we can enforce the 5-calls/day hard cap.
-- Simple append-only log — no updates, no deletes.

CREATE TABLE IF NOT EXISTS calls_log (
  id         bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now()
);
