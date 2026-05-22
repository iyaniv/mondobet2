-- =============================================================================
-- WC2026 Predictions — Add phone field to users
-- Run in Neon SQL Editor (safe / idempotent)
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) NOT NULL DEFAULT '';
