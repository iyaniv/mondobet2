-- =============================================================================
-- WC2026 Predictions — Per-stage submissions + LIVE visibility flag
-- Safe / idempotent.
--
-- Adds:
--   • entries.stages_submitted (JSONB)  — map of stage_n → ISO timestamp.
--                                          Source of truth for per-stage
--                                          submission state. submitted_at
--                                          stays as the earliest entry for
--                                          back-compat.
--   • live_matches.is_live (BOOLEAN)    — TRUE only when admin pressed ▶ LIVE.
--                                          Saved-but-not-LIVE scores still
--                                          count for ranking; the flag just
--                                          controls the LIVE NOW badge.
--
-- Run in the Neon SQL Editor.
-- =============================================================================

ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS stages_submitted JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Back-fill: any entry that already has a submitted_at gets stages_submitted={1: submitted_at}
-- so existing submissions look like "they finished stage 1" instead of an empty map.
UPDATE entries
SET stages_submitted = jsonb_build_object('1', to_char(submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
WHERE submitted_at IS NOT NULL
  AND stages_submitted = '{}'::jsonb;

ALTER TABLE live_matches
    ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT FALSE;
