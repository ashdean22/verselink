-- ============================================================
-- Migration 008: devotional_subscribers
-- Verified, user-supplied opt-in for the daily voice devotional.
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor).
-- ============================================================

CREATE TABLE IF NOT EXISTS devotional_subscribers (
  id                bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  phone             text        NOT NULL UNIQUE,          -- E.164, e.g. +15551234567
  verified          boolean     NOT NULL DEFAULT false,   -- flips true only after the code is confirmed
  verification_code text,                                 -- 6-digit code read aloud on the Vapi call (server-only)
  code_expires_at   timestamptz,                          -- code is valid for ~10 minutes
  active            boolean     NOT NULL DEFAULT true,     -- unsubscribe sets this false
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The cron query filters on (verified, active); a small index keeps it cheap.
CREATE INDEX IF NOT EXISTS devotional_subscribers_active_idx
  ON devotional_subscribers (verified, active);

-- ============================================================
-- Row Level Security
-- ------------------------------------------------------------
-- RLS ON. The app's subscribe / verify / unsubscribe routes and the cron all
-- use the service-role key, which BYPASSES RLS — so these policies exist purely
-- as defense-in-depth in case the public anon key is ever used (or leaks).
--
--   * Public may INSERT their own number, but ONLY as an UNVERIFIED row.
--     The WITH CHECK (verified = false) clause means a leaked anon key still
--     can't self-grant verified status and bypass the phone confirmation.
--   * NO public SELECT/UPDATE/DELETE policy → anon cannot read verification
--     codes, read other people's numbers, or flip themselves to verified.
--   * The cron reads the subscriber list with the service-role key.
-- ============================================================
ALTER TABLE devotional_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public can self-subscribe unverified"
  ON devotional_subscribers
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (verified = false);
