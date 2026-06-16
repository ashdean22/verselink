-- ============================================================
-- Migration 009: simplify devotional_subscribers
-- Removes the phone-verification flow added in 008. The daily devotional now
-- calls any ACTIVE subscriber directly — no spoken-code confirmation.
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor).
--
-- ⚠️  This ALTERS the existing devotional_subscribers table from 008.
--     DROP COLUMN permanently removes the verification data. This is safe while
--     the table is new (no real subscribers collected yet). Review before running.
-- ============================================================

-- The 008 policy and index referenced the `verified` column we're removing.
DROP POLICY IF EXISTS "public can self-subscribe unverified" ON devotional_subscribers;
DROP INDEX  IF EXISTS devotional_subscribers_active_idx;

ALTER TABLE devotional_subscribers DROP COLUMN IF EXISTS verification_code;
ALTER TABLE devotional_subscribers DROP COLUMN IF EXISTS code_expires_at;
ALTER TABLE devotional_subscribers DROP COLUMN IF EXISTS verified;

-- Final shape: id, phone (E.164, unique), active (default true), created_at.
CREATE INDEX IF NOT EXISTS devotional_subscribers_active_idx
  ON devotional_subscribers (active);

-- ============================================================
-- RLS stays ON (from 008). Defense-in-depth: the app's subscribe / unsubscribe
-- routes and the cron all use the service-role key, which BYPASSES RLS.
--   * Public may INSERT their own number (browser opt-in via the anon key).
--   * NO public SELECT/UPDATE/DELETE policy → anon can't read or alter the list.
-- ============================================================
CREATE POLICY "public can self-subscribe"
  ON devotional_subscribers
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
