-- =============================================================================
-- WC2026 Predictions — Migration v8 → v9
-- Adds multi-entry (multi-form) support per user.
--
-- What changes:
--   1. New table `entries` — one row per form a user creates.
--   2. `users.locked_winner` — locked on first submit, shared across all entries.
--   3. `predictions` re-keyed from (user_id, match_n) → (entry_id, match_n).
--   4. `winner_picks` re-keyed from user_id PK → entry_id PK.
--   5. Existing data is migrated: each existing user gets one "primary" entry
--      whose id is used to re-key their existing predictions and winner pick.
--
-- Safe to run on a fresh database that already has the v8 schema with no data.
-- Safe to run on a live database — all steps are inside a single transaction.
-- =============================================================================

BEGIN;

-- ── 1. Add entries table ──────────────────────────────────────────────────────
CREATE TABLE entries (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ            -- NULL = draft
);
CREATE INDEX ix_entries_user_id ON entries (user_id);

-- ── 2. Add locked_winner to users ─────────────────────────────────────────────
ALTER TABLE users ADD COLUMN locked_winner VARCHAR(100);

-- ── 3. Migrate existing users → one primary entry each ───────────────────────
-- Only non-admin users get entries (admins don't make predictions).
-- submitted_at = user.created_at if they have any predictions, else NULL (draft).
INSERT INTO entries (id, user_id, name, created_at, submitted_at)
SELECT
    gen_random_uuid(),
    u.id,
    u.name,
    u.created_at,
    CASE
        WHEN EXISTS (SELECT 1 FROM predictions p WHERE p.user_id = u.id)
        THEN u.created_at   -- treat existing predictions as submitted
        ELSE NULL
    END
FROM users u
WHERE u.is_admin = FALSE;

-- ── 4. Re-key predictions: add entry_id, migrate values, drop user_id ─────────
ALTER TABLE predictions ADD COLUMN entry_id UUID REFERENCES entries (id) ON DELETE CASCADE;

-- Map each prediction to the user's primary entry (the one just created above).
UPDATE predictions p
SET entry_id = e.id
FROM entries e
WHERE e.user_id = p.user_id;

-- Make entry_id NOT NULL now that it's populated.
ALTER TABLE predictions ALTER COLUMN entry_id SET NOT NULL;

-- Replace the (user_id, match_n) unique constraint with (entry_id, match_n).
ALTER TABLE predictions DROP CONSTRAINT uq_user_match;
ALTER TABLE predictions ADD CONSTRAINT uq_entry_match UNIQUE (entry_id, match_n);

-- Drop the old user_id FK index and column — access is now via entries.user_id.
DROP INDEX ix_predictions_user_id;
ALTER TABLE predictions DROP COLUMN user_id;

-- ── 5. Re-key winner_picks: add entry_id, migrate values, drop user_id PK ─────
ALTER TABLE winner_picks ADD COLUMN entry_id UUID REFERENCES entries (id) ON DELETE CASCADE;

UPDATE winner_picks wp
SET entry_id = e.id
FROM entries e
WHERE e.user_id = wp.user_id;

-- Populate locked_winner on the user from their existing winner pick.
UPDATE users u
SET locked_winner = wp.team
FROM winner_picks wp
WHERE wp.user_id = u.id;

-- Swap primary key from user_id to entry_id.
ALTER TABLE winner_picks ALTER COLUMN entry_id SET NOT NULL;
ALTER TABLE winner_picks DROP CONSTRAINT winner_picks_pkey;
ALTER TABLE winner_picks ADD PRIMARY KEY (entry_id);
ALTER TABLE winner_picks DROP COLUMN user_id;

COMMIT;
