# Forkcast

Weekly meal-planning app (Vite + React + TypeScript client, Hono + SQLite server in `server/`) that
validates the domain logic before a native iOS build. `src/domain/` is pure TypeScript with no
framework or browser dependencies and is the part that will be ported to Swift; `docs/DECISIONS.md`
is its spec. One real user (Christy) relies on it daily. See README.md for layout.

## Rules
- Home is the Fedora Asahi box (`aut-macbookpro181.local`): production checkout at `~/forkcast` on `main`, Docker compose runs the Node server on `:5002` on every host interface with the SQLite database in the `forkcast-data` volume (never `compose down -v`) (the LAN reaches it at `http://aut-macbookpro181.local:5002` without Tailscale), and Tailscale serve also publishes it on the tailnet at `:8082`. LAN-open on purpose, internet never (no router port-forward). Shared with clinch-v2 (`:5001`, `:8001`, tailnet `:80`/`:8080`) and the host-wide Watchtower.
- Workflow (docs/deploy.md): every session ends in a pushed branch and a PR; CI (`.github/workflows/ci.yml`: typecheck + Vitest + build on Node 22) must be green before merge. Never commit or push to `main` directly (GitHub does not enforce this on our plan, so you must).
- Deploy is automatic: CI publishes `ghcr.io/rodriguesjd/forkcast:latest` on every merge to `main`; Watchtower on the box recreates `forkcast-web` within ~5 min. After merge, wait ~10 min then verify per docs/deploy.md. `bash ~/forkcast/scripts/deploy.sh` forces it now and syncs the checkout (required when `docker-compose.yml` changes). Rollback = revert on main. Schema changes must keep old databases working (`CREATE TABLE IF NOT EXISTS` + additive migrations in `server/db.ts`).
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
