-- =============================================================================
-- WC2026 Predictions — Migration v8 → v9 (safe / idempotent version)
--
-- Use this script if the `entries` table already exists in the database.
-- All ALTER TABLE / CREATE statements use IF NOT EXISTS / IF EXISTS guards
-- so the script is safe to re-run without errors.
--
-- Run in the Neon SQL Editor (or any psql client):
--   Paste the entire file and execute.
-- =============================================================================

BEGIN;

-- 1. entries table (no-op if already exists)
CREATE TABLE IF NOT EXISTS entries (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_entries_user_id ON entries (user_id);

-- 2. locked_winner on users (no-op if already exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_winner VARCHAR(100);

-- 3. Create one entry per user who doesn't have one yet
INSERT INTO entries (id, user_id, name, created_at, submitted_at)
SELECT
    gen_random_uuid(),
    u.id,
    u.name,
    u.created_at,
    CASE
        WHEN EXISTS (SELECT 1 FROM predictions p WHERE p.user_id = u.id)
        THEN u.created_at
        ELSE NULL
    END
FROM users u
WHERE u.is_admin = FALSE
  AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.user_id = u.id);

-- 4. Re-key predictions: add entry_id, populate, drop user_id
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS entry_id UUID REFERENCES entries (id) ON DELETE CASCADE;

UPDATE predictions p
SET entry_id = e.id
FROM entries e
WHERE e.user_id = p.user_id
  AND p.entry_id IS NULL;

ALTER TABLE predictions ALTER COLUMN entry_id SET NOT NULL;

ALTER TABLE predictions DROP CONSTRAINT IF EXISTS uq_user_match;
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS uq_entry_match;
ALTER TABLE predictions ADD CONSTRAINT uq_entry_match UNIQUE (entry_id, match_n);

DROP INDEX IF EXISTS ix_predictions_user_id;
ALTER TABLE predictions DROP COLUMN IF EXISTS user_id;

-- 5. Re-key winner_picks: add entry_id, populate, drop user_id
ALTER TABLE winner_picks ADD COLUMN IF NOT EXISTS entry_id UUID REFERENCES entries (id) ON DELETE CASCADE;

UPDATE winner_picks wp
SET entry_id = e.id
FROM entries e
WHERE e.user_id = wp.user_id
  AND wp.entry_id IS NULL;

UPDATE users u
SET locked_winner = wp.team
FROM winner_picks wp
WHERE wp.user_id = u.id
  AND u.locked_winner IS NULL;

ALTER TABLE winner_picks ALTER COLUMN entry_id SET NOT NULL;
ALTER TABLE winner_picks DROP CONSTRAINT IF EXISTS winner_picks_pkey;
ALTER TABLE winner_picks ADD PRIMARY KEY (entry_id);
ALTER TABLE winner_picks DROP COLUMN IF EXISTS user_id;

COMMIT;
