-- Migration: add daily_rank_snapshots table for daily leaderboard rank-change arrows.
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS daily_rank_snapshots (
    id             SERIAL       PRIMARY KEY,
    snapshot_date  DATE         NOT NULL,
    entry_id       VARCHAR(36)  NOT NULL,
    rank           INTEGER      NOT NULL,
    CONSTRAINT uq_daily_rank_snapshot UNIQUE (snapshot_date, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_rank_date ON daily_rank_snapshots (snapshot_date);
