-- =============================================================================
-- WC2026 Predictions — Full Schema (current, v9 multi-entry)
-- =============================================================================
-- Run this on a FRESH Neon / PostgreSQL database to create the entire schema
-- in one go. Equivalent to running 01 + 02 + 03 + 04 + 05 + 06 sequentially.
--
-- The FastAPI app also auto-creates these via SQLAlchemy create_all() on
-- startup, so this script is the authoritative reference and a manual-setup
-- alternative. Existing databases should run the numbered migration files
-- (02_…, 03_…, etc.) to upgrade incrementally instead of dropping their data.
--
-- Layout:
--   • round_state_enum
--   • users               (auth + locked tournament winner)
--   • entries             (each user can have many betting cards / forms)
--   • predictions         (one row per entry × match)
--   • results             (admin-entered final scores)
--   • winner_picks        (one tournament winner pick per entry)
--   • game_config         (singleton, round + current_stage state)
--   • live_matches        (in-play scores + is_live visibility flag)
--   • seed admin user     (email "admin", password "Admin")
-- =============================================================================

-- ── Extensions ────────────────────────────────────────────────────────────────
-- gen_random_uuid() is used as entries.id default.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Enum type ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE round_state_enum AS ENUM ('idle', 'open', 'closed');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(100)  NOT NULL,
    email          VARCHAR(200)  NOT NULL,
    password_hash  VARCHAR(200)  NOT NULL,
    phone          VARCHAR(50)   NOT NULL DEFAULT '',
    is_admin       BOOLEAN       NOT NULL DEFAULT FALSE,
    has_paid       BOOLEAN       NOT NULL DEFAULT FALSE,
    -- The tournament winner the user committed to with their first stage-1
    -- submission. Once set, it can't change (per game rules).
    locked_winner  VARCHAR(100),
    -- Per-user, per-tab onboarding flags. Keys: welcome, predictions, tournament,
    -- leaderboard, byuser, settings, results, dashboard. Stored DB-side so the
    -- popups don't re-appear when a user signs in from a new device or browser.
    help_seen      JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_email UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);

-- ── Entries (multi-form per user) ─────────────────────────────────────────────
-- Each row is one "betting card" / "form". A user can have several, each with
-- its own set of predictions and its own winner pick (subject to locked_winner).
CREATE TABLE IF NOT EXISTS entries (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name               VARCHAR(100) NOT NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Legacy single submission timestamp — the earliest stage submission.
    -- Kept for back-compat; the source of truth is stages_submitted below.
    submitted_at       TIMESTAMPTZ,
    -- Per-stage submission state. Keys are stage numbers (1..6), values are
    -- ISO timestamps. Example: {"1": "2026-06-01T10:00:00Z"}.
    stages_submitted   JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_entries_user_id ON entries (user_id);

-- ── Predictions ───────────────────────────────────────────────────────────────
-- One row per (entry, match). score_a / score_b are NULL until the user fills.
CREATE TABLE IF NOT EXISTS predictions (
    id        SERIAL    PRIMARY KEY,
    entry_id  UUID      NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    match_n   INT       NOT NULL,
    score_a   SMALLINT,
    score_b   SMALLINT,
    CONSTRAINT uq_entry_match UNIQUE (entry_id, match_n)
);
CREATE INDEX IF NOT EXISTS ix_predictions_entry_id ON predictions (entry_id);

-- ── Results ───────────────────────────────────────────────────────────────────
-- Admin-entered final scores. match_n is the primary key (0 or 1 row per match).
-- score_a/score_b are the 90-min score (used for points). et_*/pen_* hold the
-- extra-time and penalty-shootout scores for knockout matches; winner ("a"/"b")
-- is derived from pens → ET → 90-min score (NULL for group stage / undecided).
CREATE TABLE IF NOT EXISTS results (
    match_n  INT      PRIMARY KEY,
    score_a  SMALLINT NOT NULL,
    score_b  SMALLINT NOT NULL,
    et_a     SMALLINT,
    et_b     SMALLINT,
    pen_a    SMALLINT,
    pen_b    SMALLINT,
    winner   CHAR(1)
);

-- ── Result audit log ──────────────────────────────────────────────────────────
-- Append-only record of admin edits to match results (who / when / what).
-- Purely for accountability — never read by scoring. match_n is NULL for
-- global actions like "reset all results".
CREATE TABLE IF NOT EXISTS result_audit (
    id          SERIAL       PRIMARY KEY,
    match_n     INT,
    action      VARCHAR(20)  NOT NULL,   -- save | edit | clear | finalize | reset_all
    old_value   VARCHAR(160),
    new_value   VARCHAR(160),
    admin_id    INT          REFERENCES users (id) ON DELETE SET NULL,
    admin_name  VARCHAR(100) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_result_audit_match_n    ON result_audit (match_n);
CREATE INDEX IF NOT EXISTS ix_result_audit_created_at ON result_audit (created_at);

-- ── Winner picks ──────────────────────────────────────────────────────────────
-- One row per entry — the team that entry thinks will win the tournament.
CREATE TABLE IF NOT EXISTS winner_picks (
    entry_id  UUID         PRIMARY KEY REFERENCES entries (id) ON DELETE CASCADE,
    team      VARCHAR(100) NOT NULL
);

-- ── Game config (singleton, id = 1) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_config (
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
-- Bootstrap the singleton so the app never has to INSERT manually.
INSERT INTO game_config (id, round_state) VALUES (1, 'idle')
ON CONFLICT (id) DO NOTHING;

-- ── Live matches ──────────────────────────────────────────────────────────────
-- Admin updates these during a match. Cleared (DELETE) when the admin clicks
-- FINAL (and a row appears in `results`).
--   is_live = TRUE  → admin pressed ▶ LIVE, shown to users as LIVE NOW
--   is_live = FALSE → score saved, ranking already updated, but no LIVE badge
CREATE TABLE IF NOT EXISTS live_matches (
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

-- ── Seed: admin user ─────────────────────────────────────────────────────────
-- Default credentials: email = "admin", password = "U2k2much!"
-- Change the password via the API (or update the hash below) before running.
-- Hash generated with bcrypt rounds=12.
INSERT INTO users (name, email, password_hash, is_admin, has_paid)
VALUES ('Admin', 'admin', '$2b$12$5nHOP8I/asFJZ1od8W7HHe/hV4.qfRMmNelKmwtiegToNi/tL5cVG', TRUE, FALSE)
ON CONFLICT (email) DO NOTHING;
