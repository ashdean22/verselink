-- 006_calls_log_phone.sql
-- Add phone_number to calls_log to support per-number rate limiting.
-- Also add an index so the per-number daily count query is fast.

ALTER TABLE calls_log ADD COLUMN IF NOT EXISTS phone_number text;

CREATE INDEX IF NOT EXISTS idx_calls_log_phone_date
  ON calls_log(phone_number, created_at);
