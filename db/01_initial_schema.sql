-- =============================================================================
-- WC2026 Predictions — Initial Schema (consolidated, current)
-- Run this on a fresh Neon / PostgreSQL database.
-- The FastAPI app also auto-creates these via SQLAlchemy create_all on startup,
-- so this script is the authoritative reference and a manual-setup alternative.
--
-- Includes all columns added by later migrations (03_add_data_source,
-- 04_add_phone, 05_add_current_stage). The numbered migration files
-- remain in this folder for existing databases to upgrade incrementally.
-- =============================================================================

-- ── Enum type ─────────────────────────────────────────────────────────────────
CREATE TYPE round_state_enum AS ENUM ('idle', 'open', 'closed');

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL,
    email         VARCHAR(200)  NOT NULL,
    password_hash VARCHAR(200)  NOT NULL,
    phone         VARCHAR(50)   NOT NULL DEFAULT '',
    is_admin      BOOLEAN       NOT NULL DEFAULT FALSE,
    has_paid      BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_email UNIQUE (email)
);
CREATE INDEX ix_users_email ON users (email);

-- ── Predictions ───────────────────────────────────────────────────────────────
-- One row per (user, match).  score_a / score_b are NULL until the user saves.
CREATE TABLE predictions (
    id       SERIAL PRIMARY KEY,
    user_id  INT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    match_n  INT       NOT NULL,
    score_a  SMALLINT,
    score_b  SMALLINT,
    CONSTRAINT uq_user_match UNIQUE (user_id, match_n)
);
CREATE INDEX ix_predictions_user_id ON predictions (user_id);

-- ── Results ───────────────────────────────────────────────────────────────────
-- Admin-entered final scores.  match_n is the primary key (0 or 1 row per match).
CREATE TABLE results (
    match_n INT      PRIMARY KEY,
    score_a SMALLINT NOT NULL,
    score_b SMALLINT NOT NULL
);

-- ── Winner picks ──────────────────────────────────────────────────────────────
-- One optional row per user — the team they think will win the tournament.
CREATE TABLE winner_picks (
    user_id INT          PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    team    VARCHAR(100) NOT NULL
);

-- ── Game config (singleton, id = 1) ──────────────────────────────────────────
CREATE TABLE game_config (
    id                INT              PRIMARY KEY DEFAULT 1,
    round_state       round_state_enum NOT NULL    DEFAULT 'idle',
    tournament_winner VARCHAR(100),
    data_source       VARCHAR(20)      NOT NULL    DEFAULT 'manual',
    current_stage     INTEGER          NOT NULL    DEFAULT 1
);
-- Bootstrap the singleton so the app never has to INSERT manually.
INSERT INTO game_config (id, round_state) VALUES (1, 'idle');

-- ── Seed: admin user ─────────────────────────────────────────────────────────
-- Default credentials: email = "admin", password = "Admin"
-- Change the password via the API or update the hash here before running.
-- Hash generated with bcrypt rounds=12.
INSERT INTO users (name, email, password_hash, is_admin, has_paid)
VALUES ('Admin', 'admin', '$2b$12$nFtMypk9K0Yj/S0fhYoa7OLggWbnoYvKg1QYK/QgzdzEwvuimSRtW', TRUE, FALSE);

-- ── Live matches ──────────────────────────────────────────────────────────────
-- Admin updates these during a match; cleared (DELETE) when admin clicks FINAL.
CREATE TABLE live_matches (
    match_n    INT         PRIMARY KEY,
    score_a    SMALLINT    NOT NULL DEFAULT 0,
    score_b    SMALLINT    NOT NULL DEFAULT 0,
    minute     SMALLINT    NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
