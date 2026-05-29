-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 10 — add users.help_seen (per-user onboarding-popup state).
--
-- We moved first-time help popups from localStorage to the DB so a user only
-- ever sees them once — even if they sign in from a different device or wipe
-- their browser. The column is a JSONB map of {tab_key: true} flags.
-- Keys we currently store: welcome, predictions, tournament, leaderboard,
-- byuser, settings, results, dashboard.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS help_seen JSONB NOT NULL DEFAULT '{}'::jsonb;
