-- =============================================================================
-- Migration 12 — game_config.stage_baseline
-- =============================================================================
-- Adds a JSONB snapshot of the leaderboard standings at the start of the
-- current stage, so the leaderboard can show per-stage rank movement
-- (+N up / -N down). Shape: {"stage": N, "ranks": {entry_id: rank}}.
-- Populated server-side whenever the admin advances the stage. Idempotent.
--
-- Apply to an existing database:
--   psql "$DATABASE_URL" -f db/12_add_stage_baseline.sql
-- (New installs get it via 01_initial_schema.sql / full_setup.sql; live deploys
--  via the ALTER in app.main._bootstrap.)
-- =============================================================================

ALTER TABLE game_config ADD COLUMN IF NOT EXISTS stage_baseline JSONB;
