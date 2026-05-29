-- =============================================================================
-- Migration 11 — result_audit table
-- =============================================================================
-- Adds an append-only log of admin edits to match results (who / when / what),
-- surfaced on the admin Dashboard. Purely additive — nothing reads it for
-- scoring, so it's safe to apply at any time. Idempotent / re-runnable.
--
-- Apply to an existing database:
--   psql "$DATABASE_URL" -f db/11_add_result_audit.sql
-- (New installs get this automatically via 01_initial_schema.sql / full_setup.sql,
--  and live deploys via the ORM create_all in app.main._bootstrap.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS result_audit (
    id          SERIAL       PRIMARY KEY,
    match_n     INT,                       -- NULL for global actions (reset all)
    action      VARCHAR(20)  NOT NULL,     -- save | edit | clear | finalize | reset_all
    old_value   VARCHAR(160),
    new_value   VARCHAR(160),
    admin_id    INT          REFERENCES users (id) ON DELETE SET NULL,
    admin_name  VARCHAR(100) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_result_audit_match_n    ON result_audit (match_n);
CREATE INDEX IF NOT EXISTS ix_result_audit_created_at ON result_audit (created_at);
