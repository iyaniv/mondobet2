-- =============================================================================
-- WC2026 Predictions — Add current_stage field to game_config
-- Run in Neon SQL Editor (safe / idempotent)
-- =============================================================================

ALTER TABLE game_config ADD COLUMN IF NOT EXISTS current_stage INTEGER NOT NULL DEFAULT 1;
