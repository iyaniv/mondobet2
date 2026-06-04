-- 13_add_submitted_snapshot.sql
-- Adds entries.submitted_snapshot (JSONB) — a snapshot of the last SUBMITTED
-- state of a form, used by the "Reset draft" feature to discard un-submitted
-- edits and restore the last submission.
--
-- Shape: {"at": "<iso>", "winner": "France"|null, "preds": {"1":[2,1], ...}}
--
-- Idempotent; safe to re-run.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS submitted_snapshot JSONB;

-- One-time backfill for forms that are CLEANLY submitted for the current stage
-- (i.e. not mid-edit). A form is "in draft" if it was submitted but the current
-- stage's flag was cleared by a later edit — those are skipped here (no snapshot),
-- so the draft flow only begins at their next submit.
--
-- The snapshot's predictions are built from the form's current prediction rows,
-- which equal the last submission for a clean form. The app also performs this
-- backfill on boot (app/main.py); this SQL is the manual-setup equivalent.
WITH cfg AS (SELECT COALESCE(current_stage, 1) AS stage FROM game_config WHERE id = 1),
clean AS (
    SELECT e.id
    FROM entries e, cfg
    WHERE e.submitted_snapshot IS NULL
      AND e.submitted_at IS NOT NULL
      AND jsonb_exists(e.stages_submitted, cfg.stage::text)
)
UPDATE entries e
SET submitted_snapshot = jsonb_build_object(
        'at', to_jsonb(e.submitted_at),
        'winner', (SELECT to_jsonb(wp.team) FROM winner_picks wp WHERE wp.entry_id = e.id),
        'preds', COALESCE((
            SELECT jsonb_object_agg(p.match_n::text, jsonb_build_array(p.score_a, p.score_b))
            FROM predictions p
            WHERE p.entry_id = e.id AND p.score_a IS NOT NULL AND p.score_b IS NOT NULL
        ), '{}'::jsonb)
    )
FROM clean
WHERE e.id = clean.id;
