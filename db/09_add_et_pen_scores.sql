-- =============================================================================
-- Migration 09 — Add extra-time and penalty-shootout scores
-- =============================================================================
-- Knockout matches (stages 2-6) that are level after 90 minutes go to extra
-- time, and to a penalty shootout if still level. The admin records:
--   • score_a / score_b → 90-min score (used for points — unchanged)
--   • et_a    / et_b    → cumulative score after extra time
--   • pen_a   / pen_b   → penalty shootout score
-- The `winner` column (added in migration 08) is now DERIVED from these:
--   penalties → extra time → 90-min score.
--
-- Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE results
    ADD COLUMN IF NOT EXISTS et_a  SMALLINT,
    ADD COLUMN IF NOT EXISTS et_b  SMALLINT,
    ADD COLUMN IF NOT EXISTS pen_a SMALLINT,
    ADD COLUMN IF NOT EXISTS pen_b SMALLINT;

ALTER TABLE live_matches
    ADD COLUMN IF NOT EXISTS et_a  SMALLINT,
    ADD COLUMN IF NOT EXISTS et_b  SMALLINT,
    ADD COLUMN IF NOT EXISTS pen_a SMALLINT,
    ADD COLUMN IF NOT EXISTS pen_b SMALLINT;
