-- =============================================================================
-- WC2026 Predictions — DESTRUCTIVE RESET of the public schema
-- =============================================================================
-- Drops every table + the round_state_enum, then re-runs 01_initial_schema.sql.
-- After this you have a fresh DB with:
--   • Empty users / entries / predictions / results / winner_picks / live_matches
--   • game_config singleton at (id=1, round_state='idle', current_stage=1)
--   • One admin user seeded:  email "admin" · password "Admin"
--
-- This DROPs in dependency order so the FK constraints don't fight. It only
-- touches our application tables — extension schemas (pgcrypto, etc.) and the
-- public schema itself are left intact.
--
-- ⚠️  ALL DATA IN THESE TABLES WILL BE PERMANENTLY DELETED.
--    Take a Neon branch snapshot first if you might want it back.
--
-- Usage (Neon SQL Editor):
--   1. Paste THIS file and run.       (wipes everything below)
--   2. Paste 01_initial_schema.sql and run.   (recreates schema + admin row)
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS predictions   CASCADE;
DROP TABLE IF EXISTS winner_picks  CASCADE;
DROP TABLE IF EXISTS entries       CASCADE;
DROP TABLE IF EXISTS results       CASCADE;
DROP TABLE IF EXISTS live_matches  CASCADE;
DROP TABLE IF EXISTS game_config   CASCADE;
DROP TABLE IF EXISTS users         CASCADE;

-- Drop the enum so 01_initial_schema can recreate it cleanly.
DROP TYPE IF EXISTS round_state_enum;

COMMIT;
