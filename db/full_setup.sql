-- =============================================================================
-- WC2026 Predictions — FULL FRESH-DB SETUP  (destructive + create + seed)
-- =============================================================================
-- One file to paste into the Neon SQL Editor (or `psql -f full_setup.sql`) and
-- end up with a complete, current-schema database, ready for the app.
--
-- Equivalent to: db/00_reset_public.sql  +  db/01_initial_schema.sql,
-- combined for convenience.
--
-- What you get when this finishes:
--   • Empty users/entries/predictions/results/winner_picks/live_matches
--   • game_config singleton at (id=1, round_state='idle', current_stage=1)
--   • One admin user:  email = "admin"  ·  password = "Admin"
--
-- ⚠️  THIS IS DESTRUCTIVE  ⚠️
-- All existing rows in the application tables WILL be deleted. Tables &
-- types are dropped CASCADE then recreated from scratch. Extension schemas
-- (pgcrypto, etc.) and the `public` schema itself are left alone.
--
-- Take a Neon branch snapshot first if you might want the old data back.
-- =============================================================================

BEGIN;

-- ── 1. Drop everything (FK dependency order, with CASCADE for safety) ────────
DROP TABLE IF EXISTS predictions   CASCADE;
DROP TABLE IF EXISTS winner_picks  CASCADE;
DROP TABLE IF EXISTS entries       CASCADE;
DROP TABLE IF EXISTS results       CASCADE;
DROP TABLE IF EXISTS live_matches  CASCADE;
DROP TABLE IF EXISTS game_config   CASCADE;
DROP TABLE IF EXISTS users         CASCADE;
DROP TYPE  IF EXISTS round_state_enum;

-- ── 2. Extensions ────────────────────────────────────────────────────────────
-- gen_random_uuid() is used as the default for entries.id
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 3. Enum type ─────────────────────────────────────────────────────────────
CREATE TYPE round_state_enum AS ENUM ('idle', 'open', 'closed');

-- ── 4. Users ─────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(100)  NOT NULL,
    email          VARCHAR(200)  NOT NULL,
    password_hash  VARCHAR(200)  NOT NULL,
    phone          VARCHAR(50)   NOT NULL DEFAULT '',
    is_admin       BOOLEAN       NOT NULL DEFAULT FALSE,
    has_paid       BOOLEAN       NOT NULL DEFAULT FALSE,
    -- Tournament winner the user committed to with their first stage-1 submit.
    -- Once set, it can't change (per game rules).
    locked_winner  VARCHAR(100),
    -- Per-user, per-tab onboarding flags. Keys: welcome, predictions, tournament,
    -- leaderboard, byuser, settings, results, dashboard. Stored DB-side so the
    -- popups don't re-appear when a user signs in from a new device or browser.
    help_seen      JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_email UNIQUE (email)
);
CREATE INDEX ix_users_email ON users (email);

-- ── 5. Entries (multi-form per user) ─────────────────────────────────────────
-- Each row is one "betting card" / "form". A user can have several, each with
-- its own set of predictions and its own winner pick (subject to locked_winner).
CREATE TABLE entries (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name               VARCHAR(100) NOT NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Legacy single submission timestamp — earliest stage submission.
    -- Kept for back-compat; source of truth is stages_submitted below.
    submitted_at       TIMESTAMPTZ,
    -- Per-stage submission state — keys are stage numbers (1..6), values are
    -- ISO timestamps. Example: {"1": "2026-06-01T10:00:00Z"}.
    stages_submitted   JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- Snapshot of the last SUBMITTED state, for "Reset draft":
    -- {"at": iso, "winner": "France"|null, "preds": {"1":[2,1], ...}}.
    submitted_snapshot JSONB
);
CREATE INDEX ix_entries_user_id ON entries (user_id);

-- ── 6. Predictions ───────────────────────────────────────────────────────────
-- One row per (entry, match). score_a / score_b are NULL until the user fills.
CREATE TABLE predictions (
    id        SERIAL    PRIMARY KEY,
    entry_id  UUID      NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    match_n   INT       NOT NULL,
    score_a   SMALLINT,
    score_b   SMALLINT,
    CONSTRAINT uq_entry_match UNIQUE (entry_id, match_n)
);
CREATE INDEX ix_predictions_entry_id ON predictions (entry_id);

-- ── 7. Results ───────────────────────────────────────────────────────────────
-- Admin-entered final scores. match_n is the primary key (0 or 1 row per match).
-- score_a/score_b = 90-min score (points). et_*/pen_* = extra-time / penalty
-- scores for knockout matches; winner ("a"/"b") derived from pens → ET → 90 min.
CREATE TABLE results (
    match_n  INT      PRIMARY KEY,
    score_a  SMALLINT NOT NULL,
    score_b  SMALLINT NOT NULL,
    et_a     SMALLINT,
    et_b     SMALLINT,
    pen_a    SMALLINT,
    pen_b    SMALLINT,
    winner   CHAR(1)
);

-- ── 8. Winner picks ──────────────────────────────────────────────────────────
-- One row per entry — the team that entry thinks will win the tournament.
CREATE TABLE winner_picks (
    entry_id  UUID         PRIMARY KEY REFERENCES entries (id) ON DELETE CASCADE,
    team      VARCHAR(100) NOT NULL
);

-- ── 9. Game config (singleton, id = 1) ───────────────────────────────────────
CREATE TABLE game_config (
    id                 INT              PRIMARY KEY DEFAULT 1,
    round_state        round_state_enum NOT NULL    DEFAULT 'idle',
    tournament_winner  VARCHAR(100),
    data_source        VARCHAR(20)      NOT NULL    DEFAULT 'manual',
    -- Highest stage open for user predictions (1..6).
    current_stage      INTEGER          NOT NULL    DEFAULT 1,
    -- Standings snapshot at the start of the current stage, for per-stage
    -- leaderboard movement: {"stage": N, "ranks": {entry_id: rank}}.
    stage_baseline     JSONB
);
INSERT INTO game_config (id, round_state) VALUES (1, 'idle');

-- ── 10. Live matches ─────────────────────────────────────────────────────────
-- Admin updates these during a match. Cleared (DELETE) when the admin clicks
-- FINAL (a row appears in `results`).
--   is_live = TRUE  → admin pressed ▶ LIVE, shown to users as LIVE NOW
--   is_live = FALSE → score saved, ranking already updated, but no LIVE badge
CREATE TABLE live_matches (
    match_n     INT         PRIMARY KEY,
    score_a     SMALLINT    NOT NULL DEFAULT 0,
    score_b     SMALLINT    NOT NULL DEFAULT 0,
    minute      SMALLINT    NOT NULL DEFAULT 0,
    is_live     BOOLEAN     NOT NULL DEFAULT FALSE,
    et_a        SMALLINT,
    et_b        SMALLINT,
    pen_a       SMALLINT,
    pen_b       SMALLINT,
    winner      CHAR(1),    -- "a" or "b" for knockout matches (ET/penalties)
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 11. Seed: admin user ─────────────────────────────────────────────────────
-- Default credentials:  email = "admin"  ·  password = "U2k2much!"
-- Change the password via the API (or update the hash below) before going live.
-- Hash generated with bcrypt rounds=12.
INSERT INTO users (name, email, password_hash, is_admin, has_paid)
VALUES ('Admin', 'admin', '$2b$12$5nHOP8I/asFJZ1od8W7HHe/hV4.qfRMmNelKmwtiegToNi/tL5cVG', TRUE, FALSE);

COMMIT;

-- ── 12. Verify (read-only) ───────────────────────────────────────────────────
-- Quick sanity check — should return one row each.
SELECT 'users'        AS table_name, COUNT(*) AS rows FROM users
UNION ALL SELECT 'entries',          COUNT(*) FROM entries
UNION ALL SELECT 'predictions',      COUNT(*) FROM predictions
UNION ALL SELECT 'results',          COUNT(*) FROM results
UNION ALL SELECT 'winner_picks',     COUNT(*) FROM winner_picks
UNION ALL SELECT 'game_config',      COUNT(*) FROM game_config
UNION ALL SELECT 'live_matches',     COUNT(*) FROM live_matches;
-- Expected:
--   users         1   (the admin row)
--   entries       0
--   predictions   0
--   results       0
--   winner_picks  0
--   game_config   1   (the singleton)
--   live_matches  0
