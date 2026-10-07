# Forkcast

Weekly meal-planning prototype: **plan** meals, generate a **shopping list**,
and get a **cooking schedule** with advance prep and batch-prep suggestions.

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

## Layout

```
src/domain/     pure domain logic + tests (types, units, recipes, plan, shopping, schedule)
src/data/       seed recipes
src/storage/    localStorage adapter (only module that touches window)
src/ui/         plain React views: week grid, shopping list, schedule, settings
docs/           DECISIONS.md: the logic spec
```
