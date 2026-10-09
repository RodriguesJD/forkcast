# Forkcast

Weekly meal-planning prototype: **plan** meals, generate a **shopping list**,
and get a **cooking schedule** with advance prep and batch-prep suggestions.

Recipes come from a built-in seed set plus whatever you add or edit in the recipes tab. The layout
is mobile-first: the shopping list is meant to be used on a phone in the store.

This web app exists to validate the domain logic before a native iOS build.
All logic lives in `src/domain/` as pure TypeScript with no framework or
browser dependencies, intended to be ported to Swift. Design decisions and
known limits are recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest, domain + seed-data tests
npm run typecheck
npm run build
```

## Where it runs

Production is the Fedora Asahi box `aut-macbookpro181.local`, the same host as clinch-v2. The checkout at
`~/forkcast` tracks `main`; `docker compose` runs nginx serving the built site on port 5002, reachable on the home
Wi-Fi as `http://aut-macbookpro181.local:5002` with nothing installed, and `tailscale serve` also publishes it as
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
src/domain/     pure domain logic + tests (types, units, recipes, library, plan, shopping, schedule)
src/data/       seed recipes
src/storage/    localStorage adapter (only module that touches window): plan, recipe library, checkboxes
src/ui/         plain React views: week grid, shopping list, schedule, recipe list + editor, settings
docs/           DECISIONS.md: the logic spec; deploy.md: how main reaches the box
scripts/        deploy.sh (on the box) + deploy_fedora.sh (over ssh)
Dockerfile      node build stage -> nginx serving dist/; docker-compose.yml runs it on the box
```
