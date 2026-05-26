-- =============================================================================
-- Migration 08 — Add winner column to results and live_matches
-- =============================================================================
-- Knockout-stage matches (stages 2-6) must end with a winner. When a match
-- goes to extra time or penalties the admin records the 90-min score in the
-- existing score columns (used for points calculation) and sets `winner` to
-- "a" or "b" to indicate which team actually advanced.
--
-- Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE results
    ADD COLUMN IF NOT EXISTS winner CHAR(1);

ALTER TABLE live_matches
    ADD COLUMN IF NOT EXISTS winner CHAR(1);
