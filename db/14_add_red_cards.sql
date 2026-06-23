-- =============================================================================
-- Migration 14 — Add red-card counts to live matches
-- =============================================================================
-- A live-only UI signal (not scored). The admin records, per side:
--   • red_a → red cards shown to the home team
--   • red_b → red cards shown to the away team
-- These live on `live_matches` only — they're a transient match signal that
-- disappears once the match is finalized into `results`.
--
-- Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE live_matches
    ADD COLUMN IF NOT EXISTS red_a SMALLINT,
    ADD COLUMN IF NOT EXISTS red_b SMALLINT;
