-- Add data_source column to game_config
-- Run in Neon SQL Editor

ALTER TABLE game_config
    ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) NOT NULL DEFAULT 'manual';
