# Forkcast

Weekly meal-planning app (Vite + React + TypeScript client, Hono + SQLite server in `server/`) that
validates the domain logic before a native iOS build. `src/domain/` is pure TypeScript with no
framework or browser dependencies and is the part that will be ported to Swift; `docs/DECISIONS.md`
is its spec. One real user (Christy) relies on it daily. See README.md for layout.

## Rules
- Home is the Fedora Asahi box (`aut-macbookpro181.local`): production checkout at `~/forkcast` on `main`, Docker compose runs the Node server on `:5002` on every host interface with the SQLite database in the `forkcast_forkcast-data` volume (never `compose down -v`) (the LAN reaches it at `http://aut-macbookpro181.local:5002` without Tailscale), and Tailscale serve also publishes it on the tailnet at `:8082`. LAN-open on purpose, internet never (no router port-forward). Shared with clinch-v2 (`:5001`, `:8001`, tailnet `:80`/`:8080`) and the host-wide Watchtower.
- Workflow (docs/deploy.md): every session ends in a pushed branch and a PR; CI (`.github/workflows/ci.yml`: typecheck + Vitest + build on Node 22) must be green before merge. Never commit or push to `main` directly (GitHub does not enforce this on our plan, so you must).
- Deploy is automatic: CI publishes `ghcr.io/rodriguesjd/forkcast:latest` on every merge to `main`; Watchtower on the box recreates `forkcast-web` within ~5 min. After merge, wait ~10 min then verify per docs/deploy.md. `bash ~/forkcast/scripts/deploy.sh` forces it now and syncs the checkout (required when `docker-compose.yml` changes). Rollback = revert on main.
- **The database is live production data and no change may ruin it.** `/data/forkcast.sqlite` in the `forkcast_forkcast-data` volume holds Christy's account, recipes, plan and shopping ticks; there is no other copy except the nightly snapshots beside it. Every change must keep it intact and readable:
  - Schema changes are additive only: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN` with a default, new indexes. Never drop, rename or retype a table or column, and never rewrite existing rows in a migration. Bump `SCHEMA_VERSION` and run the migration inside one transaction so a failure leaves the file as it was.
  - The new server must open a database written by every earlier version. The first schema change must add a test that opens a copy of a v1 database (build it with the old `migrate` SQL in the test) and reads its rows back through the new code; keep that pattern for every version after.
  - Rollback must also be safe: a reverted server must still open a database the newer version touched, which additive changes guarantee.
  - Never change the volume name, the `/data` mount path or `FORKCAST_DATA_DIR` in `docker-compose.yml` or the Dockerfile: compose would silently start from an empty volume. Never run `docker compose down -v`, `docker volume rm`, or delete anything under `/data`. Restore only by the recipe in docs/deploy.md, after taking a fresh snapshot.
  - Do not run ad-hoc SQL against the production database; the one sanctioned exception is the password-reset snippet in docs/deploy.md.
  - A PR that touches `server/db.ts`, `docker-compose.yml`, the Dockerfile or deploy scripts says in its description how existing data survives the change and the rollback.
- Domain logic stays pure: nothing in `src/domain/` may import React, Node, touch `window`, or use `Date`. `server/db.ts` is the only code that touches SQLite. Nothing in `src/` may use localStorage: all state is per account on the server (DECISIONS 18).
- Input validation lives in the domain (`parseRecipeInput`, `parsePlanInput`) and is run by both the form and the server; never validate in only one place.
- Every domain decision gets an entry in `docs/DECISIONS.md` (Decision / Why / Known limits).

## Commands
```
npm run dev:server   # API on :3000, database in ./data/
npm run dev          # client on :5173, proxies /api to :3000
npm test             # Vitest: domain, seed data, save queue, server API (in-memory SQLite)
npm run typecheck
npm run build        # tsc -b && vite build && esbuild -> dist/ + dist-server/index.js
npm start            # serve the build on :3000 like the image does
docker build -t forkcast . && docker run --rm -p 5002:3000 -v forkcast-dev:/data forkcast   # the production image, locally
```
