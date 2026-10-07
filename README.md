# Forkcast

Weekly meal-planning prototype: **plan** meals, generate a **shopping list**,
and get a **cooking schedule** with advance prep and batch-prep suggestions.

This web app exists to validate the domain logic before a native iOS build.
All logic lives in `src/domain/` as pure TypeScript with no framework or
browser dependencies, intended to be ported to Swift. Design decisions and
known limits are recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Trying it

Click **Load sample week** in the header. It fills the grid with a mock week
over the built-in recipes that exercises every rule at once: leftovers,
advance prep, batch-prep suggestions, a unit conflict on the shopping list,
recipes that run longer than the day allows, and one overloaded day.

## Using your own recipes

The **recipes** tab shows the current recipe set as JSON. Edit or paste your
own, click **Apply**, and the whole list is validated before anything changes.
The shape and the allowed units and sections are listed on that tab. Recipes
are saved in the browser; **Restore built-in recipes** brings back the seed set.

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
src/domain/     pure domain logic + tests (types, units, recipes, plan, shopping, schedule, recipeImport)
src/data/       seed recipes
src/storage/    localStorage adapter (only module that touches window)
src/ui/         plain React views: week grid, shopping list, schedule, settings
docs/           DECISIONS.md: the logic spec
```
