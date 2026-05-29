# Database scripts

PostgreSQL schema for the WC2026 Predictions app. Designed for Neon but works on any vanilla Postgres.

## Files

| File | When to use |
|---|---|
| **`full_setup.sql`** | **Burn-down + start-over.** Drops everything, creates the full current schema, seeds the `game_config` singleton + the `admin/Admin` user. One paste in the Neon SQL Editor → ready-to-use DB. |
| **`01_initial_schema.sql`** | Fresh-install equivalent of `full_setup.sql` **without** the destructive `DROP`s — idempotent (every statement is `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`). Same authoritative current schema. |
| **`00_reset_public.sql`** | The destructive half of `full_setup.sql` on its own — drops every application table + `round_state_enum`. Follow with `01_initial_schema.sql` to recreate. |
| **`02_migrate_v8_to_v9_safe.sql`** | Incremental migration from the original single-entry-per-user schema to the multi-entry (`entries` table) model. |
| **`03_add_data_source.sql`** | Adds `game_config.data_source`. |
| **`04_add_phone.sql`** | Adds `users.phone`. |
| **`05_add_current_stage.sql`** | Adds `game_config.current_stage`. |
| **`06_add_per_stage_and_is_live.sql`** | Adds `entries.stages_submitted` (JSONB) + `live_matches.is_live` (BOOLEAN), and back-fills `stages_submitted` from `submitted_at`. |
| **`07_update_admin_password.sql`** | Rotates the seeded admin password from `Admin` → `U2k2much!`. Idempotent. |
| **`08_add_winner_to_results.sql`** | Adds `results.winner` + `live_matches.winner` (knockout-stage winner code). |
| **`09_add_et_pen_scores.sql`** | Adds `et_a/et_b/pen_a/pen_b` SMALLINTs to `results` and `live_matches`. |
| **`10_add_help_seen.sql`** | Adds `users.help_seen` (JSONB) — per-user onboarding-popup flags. |
| **`11_add_result_audit.sql`** | Adds the `result_audit` table — append-only log of admin result edits (who/when/what), shown on the Dashboard. |
| **`12_add_stage_baseline.sql`** | Adds `game_config.stage_baseline` (JSONB) — standings snapshot at the start of the current stage, for per-stage leaderboard rank movement. |

## Schema overview

```
round_state_enum  ::=  'idle' | 'open' | 'closed'

users              (id, email, password_hash, phone, is_admin, has_paid,
                    locked_winner, created_at)
  └── entries      (id [UUID], user_id, name, created_at, submitted_at,
                    stages_submitted [JSONB])
        ├── predictions  (id, entry_id, match_n, score_a, score_b)
        │                — UNIQUE(entry_id, match_n)
        └── winner_picks (entry_id, team)

results            (match_n, score_a, score_b)
live_matches       (match_n, score_a, score_b, minute, is_live, updated_at)
game_config        (id=1 singleton: round_state, tournament_winner,
                    data_source, current_stage)
```

## Which path to take

- **New empty Neon project →** paste `full_setup.sql`. Done.
- **Existing DB with old data, just need to add the new columns/tables →** paste the relevant numbered migration(s). They're idempotent and safe to re-run.
- **Existing DB in unknown state, want to start clean →** paste `full_setup.sql` (destroys data!).

The FastAPI app also calls SQLAlchemy `create_all()` on startup, so a brand-new DB will be auto-created from the ORM. The SQL scripts are the authoritative reference and a manual-setup alternative — use them for control over indexes, seeds, and the singleton row.

## Standing rule for schema changes

When the ORM (`app/models.py`) changes, the SQL must change too — same commit:

1. **Update `app/models.py`** — the ORM column / table.
2. **Update `01_initial_schema.sql`** AND **`full_setup.sql`** — the full schema must always reflect the current ORM. Both files are paste-and-run fresh-install scripts; they cannot lag.
3. **Add a new numbered migration** — `db/0N_<short_description>.sql` — for upgrading existing databases incrementally. Make it idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, etc.) and back-fill any non-default data where it matters.
4. **Update this README** if a new file is added.

A change that touches only one of (ORM, `01_initial_schema.sql`, `full_setup.sql`) is a bug — the three files drift apart and the next fresh install breaks.
