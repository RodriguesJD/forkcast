# Forkcast

Weekly meal-planning prototype (Vite + React + TypeScript) that validates the domain logic before a
native iOS build. `src/domain/` is pure TypeScript with no framework or browser dependencies and is
the part that will be ported to Swift; `docs/DECISIONS.md` is its spec. See README.md for layout.

## Rules
- Home is the Fedora Asahi box (`aut-macbookpro181.local`): production checkout at `~/forkcast` on `main`, Docker compose runs nginx serving the built site on loopback `:5002`, Tailscale serve publishes it on the tailnet at `:8082`. Shared with clinch-v2 (`:5001`, `:8001`, tailnet `:80`/`:8080`) and the host-wide Watchtower.
- Workflow (docs/deploy.md): every session ends in a pushed branch and a PR; CI (`.github/workflows/ci.yml`: typecheck + Vitest + build on Node 22) must be green before merge. Never commit or push to `main` directly (GitHub does not enforce this on our plan, so you must).
- Deploy is automatic: CI publishes `ghcr.io/rodriguesjd/forkcast:latest` on every merge to `main`; Watchtower on the box recreates `forkcast-web` within ~5 min. After merge, wait ~10 min then verify per docs/deploy.md. `bash ~/forkcast/scripts/deploy.sh` forces it now and syncs the checkout (needed when `docker-compose.yml` changes). Rollback = revert on main.
- Domain logic stays pure: nothing in `src/domain/` may import React, touch `window`, or use `Date`. `src/storage/` is the only module that touches `localStorage`.
- Every domain decision gets an entry in `docs/DECISIONS.md` (Decision / Why / Known limits).

## Commands
```
npm run dev          # http://localhost:5173
npm test             # Vitest, domain + seed-data tests
npm run typecheck
npm run build        # tsc -b && vite build -> dist/
docker build -t forkcast . && docker run --rm -p 5002:80 forkcast   # the production image, locally
```
