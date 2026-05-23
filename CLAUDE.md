# CLAUDE.md

Notes for any Claude session working on this repo. Read first; updated when our process changes.

## Project shape

- **Frontend:** React + Vite. Single `src/App.jsx` file, inline styles, no CSS-in-JS lib.
  - `npm run dev`  → production-mode dev server (uses `src/api.js`, talks to a real backend on `/api/*`).
  - `npm run demo` → demo-mode dev server (a Vite plugin rewrites `./api` imports to `./api.demo`, which is a fully in-memory mock with seeded users and matches). All app state lives in `localStorage`.
  - `npm run build` is what Vercel runs → production build.
- **Backend:** FastAPI + SQLAlchemy (async) on Neon Postgres. Entry point is `app/main.py`; routers under `app/routers/`. Vercel runs it via `api/index.py`.
- **Database scripts:** in `db/` — see `db/README.md` for the file layout.

## Standing rules

### 1. DB schema changes are a 4-file commit

Whenever a column or table changes, the same commit must touch all four:

1. `app/models.py` — the SQLAlchemy declaration.
2. `db/01_initial_schema.sql` — the idempotent fresh-install script.
3. `db/full_setup.sql` — the destructive "burn it down + start over" script.
4. `db/0N_<short_description>.sql` — a NEW numbered migration so existing databases can upgrade incrementally. Use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` so the file stays safe to re-run. Back-fill data where reasonable.

If only one or two of those change, the files drift apart and the next fresh install (or `vercel build → DB init`) breaks silently. Don't ship a DB change without all four edits.

### 2. Stay in sync with `main`

The user often pushes the same project from multiple places. Before committing, do a `git pull --rebase origin main` so we don't fight remote work. If a push is rejected, rebase + retry. Don't force-push.

### 3. Demo seed parity

If a meaningful new field is added to the backend data shape, the demo seed in `src/api.demo.js` should reflect it too so demo mode and production mode keep behaving the same. The two `buildInitialState()` / `buildFreshState()` factories are the single sources of demo data — update them, then bump `STORAGE_KEY` (currently `mb_demo_v5` / `mb_demo_v5_fresh`) so existing local-storage data doesn't poison the new shape.

### 4. Don't trust `submitted_at` alone

The historical "is this form submitted" boolean is `entry.submitted_at`. Since we added per-stage submission, the **source of truth is `entry.stages_submitted[stage_n]`**, and `submitted_at` is only the earliest stage timestamp kept for back-compat. New code should always go through `stages_submitted`.

### 5. Live vs Final, both feed the leaderboard

A score saved via `liveApi.set(matchN, …)` counts toward `total` immediately. The `is_live` flag is purely a UI signal — it controls whether the match shows in the LIVE NOW banner. Don't gate scoring on `is_live`.

### 6. Build before pushing UI changes

`src/App.jsx` is one big file; a stale variable rename has bit us before (white-screen on admin). Run `npx vite build --mode demo` before committing a UI change — it catches references to removed locals that JSX otherwise hides until runtime.

## Run / verify

- **Local demo:** `npm run demo` (Vite picks 5173, falls back to 5174 if busy).
- **Console helpers (demo only):**
  - `window._resetDemo()` — wipe every `mb_demo_*` localStorage key + auth, reload.
  - `window._switchDemo("fresh"|"current")` — switch between the pre-tournament and mid-tournament demos.
- **Production smoke test:** `npx vite build` and look at the `dist/assets/index-*.js` hash; on the live site `curl -sS https://mondobet.vercel.app/ | grep -o 'index-[A-Za-z0-9_-]*\.js'` should match (otherwise Vercel hasn't deployed the latest `main` yet).
