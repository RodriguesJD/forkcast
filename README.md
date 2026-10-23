# Forkcast

Weekly meal-planning prototype: **plan** meals, generate a **shopping list**,
and get a **cooking schedule** with advance prep and batch-prep suggestions.

This web app exists to validate the domain logic before a native iOS build.
All logic lives in `src/domain/` as pure TypeScript with no framework or
browser dependencies, intended to be ported to Swift. Design decisions and
known limits are recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md).

Everything a person enters (account, recipes, the week plan, shopping-list ticks) is stored
in a SQLite database by a small Node server (`server/`), so the same state shows on every
device after signing in. Nothing is kept in the browser but the session cookie.

## Run

```sh
npm install
npm run dev:server # API on http://localhost:3000, database in ./data/ (one terminal)
npm run dev        # client on http://localhost:5173, proxies /api to 3000 (another terminal)
npm test           # Vitest: domain, seed data, save queue, server API
npm run typecheck
npm run build      # dist/ (client) + dist-server/index.js (server bundle)
npm start          # serve the built app on http://localhost:3000, as the image does
```

## Where it runs

Production is the Fedora Asahi box `aut-macbookpro181.local`, the same host as clinch-v2. The checkout at
`~/forkcast` tracks `main`; `docker compose` runs the server on port 5002 with the database in the `forkcast_forkcast-data`
volume, reachable on the home Wi-Fi as `http://aut-macbookpro181.local:5002` with nothing installed, and `tailscale serve` also publishes it as
`http://aut-macbookpro181.<tailnet>.ts.net:8082` for any device on the tailnet.

Changes reach the box through a PR: a session pushes a branch, CI (typecheck + Vitest + build) must be green,
the PR is merged, CI publishes `ghcr.io/rodriguesjd/forkcast:latest` (arm64), and Watchtower on the box rolls it
out within a few minutes. The full loop, one-time host setup and verification are in
[`docs/deploy.md`](docs/deploy.md).

```sh
bash ~/forkcast/scripts/deploy.sh                  # on the box, optional: pull now instead of waiting for Watchtower
zsh scripts/deploy_fedora.sh                       # same thing over ssh from another machine
zsh scripts/deploy_fedora.sh aut@aut-macbookpro181  # off the LAN (Tailscale MagicDNS name)
```

## Layout

```
src/domain/     pure domain logic + tests (types, units, recipes, plan, shopping, schedule, input validation)
src/data/       sample recipes (copied into each new account; also test data)
src/api/        the browser's HTTP client and the retrying save queue
src/ui/         plain React views: sign-in, week grid (day cards on a phone, columns on a wide screen), recipes + form, shopping list, schedule, settings
server/         Hono + node:sqlite: accounts, sessions, recipes, plan, backups (the only code that touches the DB)
docs/           DECISIONS.md: the logic spec; deploy.md: how main reaches the box, backups, restore
scripts/        deploy.sh (on the box), deploy_fedora.sh (over ssh), backup.sh (copy a snapshot out)
Dockerfile      build stage -> node:22-alpine running dist-server/index.js; docker-compose.yml adds the data volume
```
