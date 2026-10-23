# Forkcast logic decisions

This file records every domain-logic decision and why. It is the spec for the
Swift port. The implementation lives in `src/domain/` and is pure functions
over plain data, with no React, browser, or Date dependencies.

Each entry: **Decision**, **Why**, **Known limits**.

---

## 1. The week is indexed 0..6 from a configurable start day

**Decision.** A plan refers to days by `dayIndex` (0 = first day of the planning
week), never by calendar weekday or date. `WeekSettings.startDay` maps indexes to
weekday names for display only. There are no dates anywhere in the domain.

**Why.** Changing the start day must not reorder or invalidate a plan. Dates
add time zones and calendar math without helping any rule in this app.

**Known limits.** Leftovers and advance prep cannot cross into the previous or
next week. Advance prep that lands before day 0 is reported in
`Schedule.beforeWeek` with a `prep-before-week` warning rather than dropped.

## 2. Slots are breakfast, lunch, dinner; only active slots count

**Decision.** `WeekSettings.activeSlots` lists which slots are planned. Slot
order within a day is fixed: breakfast < lunch < dinner. `slotOrdinal` gives a
linear position (`dayIndex * 3 + slotIndex`) used for all before/after
comparisons.

Entries in an inactive slot (or on a day outside 0..6) are kept in the data but
excluded from shopping and scheduling, and `validatePlan` reports
`inactive-slot`.

**Why.** Deactivating lunch should not destroy the lunches someone planned;
re-enabling restores them. Keeping the data and ignoring it is the simplest
behaviour that is also reversible.

## 3. Cook entries and leftover entries

**Decision.** A plan entry is either
- `cook`: a recipe at a slot with `servings` = the **total portions cooked**, or
- `leftover`: points at a cook entry by id, with `servings` = portions eaten at that slot.

Leftovers must come strictly after their source slot, must point at a `cook`
entry (no chains), and are removed automatically when their source is removed
or replaced.

**Why.** Shopping and cooking are driven only by cook entries, which makes
"leftover slots generate no shopping and no cooking" fall out for free. Chains
would add nothing a direct reference cannot express.

**Known limits.** Nothing tracks whether leftovers are still safe to eat
(e.g. a leftover six days later).

## 4. Servings bookkeeping and the over-allocation warning

**Decision.** A cook entry is assumed to feed `householdSize` at its own slot
plus every leftover slot that points at it. When that sum exceeds the cook
entry's `servings`, `validatePlan` emits `leftover-over-allocated`. Nothing is
auto-adjusted.

**Why.** The shopping list is only right if the cook entry's servings include
the leftover portions. A warning keeps the user in control; silently raising
servings would change the shopping list behind their back.

**Known limits.** The number of portions eaten at the cook slot is assumed to
be the household size. A cook entry has no separate "eaten here" field.

## 5. Servings are positive whole numbers

**Decision.** `validatePlan` reports `invalid-servings` for 0, negative, or
fractional servings. Scaling uses `servings / baseServings`, so the factor
itself can be fractional (6 of a 4-serving recipe is 1.5x).

**Why.** Half a serving is not a real planning unit; a fractional scale factor
is.

## 6. Household size is a default, not a constraint

**Decision.** `householdSize` is used as the default `servings` for new entries
and in the over-allocation check. Changing it never rewrites existing entries.

**Why.** Rewriting would destroy deliberate choices like "cook 8 for leftovers".

## 7. Unit model: three families, one base unit each

**Decision.** Units belong to exactly one family:
- `volume`: tsp, tbsp, floz, cup, ml, l. Base unit ml.
- `mass`: g, kg, oz, lb. Base unit g.
- `count`: each, clove, can, bunch, slice, stalk, head, sprig, pinch. No conversion.

Conversion factors are the NIST US customary values:
1 tsp = 4.92892159375 ml, 1 tbsp = 3 tsp, 1 floz = 2 tbsp, 1 cup = 16 tbsp,
1 oz = 28.349523125 g, 1 lb = 16 oz.

Two quantities can be summed when they are in the same volume or mass family
(across metric and US), or when they are the identical count unit.

**Why.** Metric and US volume are both volume, so cups and millilitres merge
honestly. Volume and mass never merge because that needs a per-ingredient
density. `oz` and `floz` are distinct unit names on purpose so a weight ounce
can never be confused with a fluid ounce.

**Known limits.**
- US customary only; no UK/Australian cup or tablespoon.
- Count units merge only when identical: 2 cloves + 1 head garlic stays two lines.
- No "to taste" or unitless ingredients. Use a pantry staple instead.
- Amounts are IEEE doubles. Tests compare with tolerance (`toBeCloseTo`).
  Rounding happens only in the UI (`src/ui/format.ts`), never in the domain.

## 8. Display unit after merging

**Decision.** `chooseDisplayUnit(baseAmount, preferredUnit)`: stay in the
measurement system (metric or US) of `preferredUnit`, then pick the largest
unit on that system's ladder where the amount is at least 1. Ladders:
tsp → tbsp → cup; ml → l; oz → lb; g → kg. `floz` is never chosen for display.
In the shopping list, `preferredUnit` is the unit of the single largest
contribution to that item.

**Why.** "1⅓ tbsp cumin" reads better than "4 tsp"; "486 ml milk" is right when
the bigger recipe was metric. Deterministic and explainable.

**Known limits.** Shoppers may prefer package units (one 28 oz can) that this
cannot know. Count items can come out fractional (2.08 onions) because scaling
is linear; the list does not round up to whole items.

## 9. Ingredient identity is a normalized name

**Decision.** `normalizeIngredientName` lowercases, trims, and collapses
whitespace. Two ingredients are the same iff their normalized names are equal.
This is the single extension point for matching.

**Why.** Requested: naive first, with a clear place to improve. Seed data uses
consistent names so merging works out of the box.

**Known limits.** No plurals ("onions" ≠ "onion"), no synonyms ("scallions" ≠
"green onions"), no hierarchy ("salt" does not cover "kosher salt").

## 10. Shopping list grouping key

**Decision.** Items group by `normalizedName + '|' + family` for volume and
mass, and `normalizedName + '|' + unit` for counts. When one name produces more
than one group, every group for that name gets `unmergedConflict: true` and one
`unit-conflict` warning is emitted.

**Why.** "2 cups flour + 300 g flour" must never be silently merged, and the
user should see both lines and a reason.

The key is stable across re-renders and plan edits, so the UI stores checkbox
state keyed by it. Checkbox state is UI state, not domain state.

## 11. Store sections

**Decision.** Each recipe ingredient carries a `section`. The shopping list
groups by section in a fixed store-walking order (produce, bakery, meat,
seafood, dairy, dry-goods, canned, spices, frozen, other). When the same
ingredient is tagged with different sections in different recipes, the first
one seen (in week order) wins and one `section-conflict` warning is emitted.

**Why.** A separate ingredient catalog would be cleaner but is a second data
structure to maintain. Per-ingredient sections are the simplest correct thing
for the prototype.

**Known limits.** Section order is not configurable.

## 12. Pantry staples are a user list

**Decision.** `WeekSettings.pantryStaples` is a list of names. Any ingredient
whose normalized name matches is excluded from the shopping list and reported
in `ShoppingList.excludedStaples` so the UI can show "assumed in pantry".

**Why.** Only the user knows what they have. A recipe author cannot flag it.

**Known limits.** Exact-name matching only (see 9). Staples are still used
for batch-prep detection because you still have to chop garlic you own.

## 13. Advance prep is scheduled in whole days

**Decision.** `AdvancePrepStep.leadDays` is an integer ≥ 1. The task lands on
`cookDay - leadDays`. Its `activeMinutes` count toward that day's load.
Values below 1 are clamped to 1.

**Why.** "Marinate overnight", "thaw", and "soak" all mean "the day before"
once scheduling is by day. Hours would need meal times to be meaningful.

**Known limits.** No time-of-day ("tonight" vs "this morning"). Prep for a
day-0 meal falls before the week (see 1).

## 14. Day load counts active minutes only

**Decision.** `DaySchedule.loadMinutes` is the sum of `activeMinutes` of cook
tasks and advance-prep tasks on that day. Passive time (simmering, oven,
marinating) is free. A day is `overloaded` when load exceeds
`availableMinutesPerDay[dayIndex]`; `null` means no limit. Separately, a
`recipe-too-long` warning fires when a recipe's `totalMinutes` exceeds the
day's available minutes, because you cannot start a 3-hour braise at 6pm even
if it only needs 20 hands-on minutes.

**Why.** Hands-on time is what a per-day budget actually constrains. Total
time is a different constraint, so it gets its own warning rather than
inflating the load.

## 15. Batch-prep suggestions

**Decision.** An ingredient has an optional `prep` verb ("diced", "minced").
`suggestBatchPrep` groups scaled ingredients by `normalizedName + prep` across
effective cook entries whose cook day is on or after `batchPrepDayIndex`. A
group used by at least 2 distinct entries becomes one optional `batch-prep`
task on the batch day, listing the combined quantity (when units merge) and
the recipes covered. Batch tasks never count toward load. `batchPrepDayIndex`
null disables the feature.

**Why.** Keying on name + prep is the smallest data that makes "diced onion in
three recipes" detectable while keeping "sliced onion" separate.

**Known limits.**
- Time estimate is a flat `BATCH_PREP_MINUTES_PER_ITEM` (10) per task.
- Accepting a suggestion does not reduce the cook days' loads; suggestions are advisory.
- No perishability rule (pre-chopping for a meal five days out is still suggested).
- Meals cooked before the batch day are not covered.

## 16. Bad entries never corrupt outputs

**Decision.** `effectiveCookEntries` is the single filter that shopping and
scheduling use: cook entries in an active slot, with a known recipe and valid
servings, sorted by slot. Everything else is reported by `validatePlan` and
otherwise ignored. Domain functions return warnings; they only throw on
programmer errors (e.g. scaling to 0 servings directly).

**Why.** A deleted recipe or a typo in servings should produce a warning, not
an exception or a wrong shopping list.

## 17. Warnings are data

**Decision.** Every issue is a `{ code, message, entryId?, dayIndex? }`. Codes
are a closed union (`WarningCode`). Messages are English and ready to show.

**Why.** The UI can attach warnings to cells and days by id without parsing
text, and the Swift port gets an enum for free.

## 18. Persistence is server-side, per account, and nothing lives in the browser

**Decision.** All state belongs to an account and is stored in one SQLite
database on the server (`server/db.ts`): recipes, the week plan (settings and
entries) and the shopping-list checkbox map. The browser keeps only the session
cookie; nothing is written to localStorage. The client loads everything after
sign-in (`GET /api/state`, `GET /api/recipes`) and writes changes back through
the API. Recipe ingredients and advance-prep steps are JSON columns because
the `Recipe` type must round-trip unchanged and nothing queries inside them.

**Why.** The person using this wants the same plan on the phone at the store
and on the laptop at the table, and to trust that it is still there tomorrow.
That needs one copy on one machine, not one per browser.

**Known limits.**
- Last write wins. Two devices editing the plan at the same moment do not
  merge; the later save replaces the earlier. Fine for one household.
- No migrations beyond `CREATE TABLE IF NOT EXISTS` and defaulting new
  settings fields on load (`parsePlanInput`). A `schema_version` table exists
  for when that changes.
- Nothing works offline; the app is served by the same process as the API.

## 19. Recipe input is validated by one pure function

**Decision.** `parseRecipeInput(raw)` (`src/domain/recipeInput.ts`) turns
untrusted input into a `RecipeInput` or a list of field-labelled errors. The
recipe form runs it before submitting and the server runs it again on every
create or update. Rules: name required (≤120 chars); servings a whole number
1–100; hands-on and total minutes whole numbers ≥0 with total ≥ hands-on; at
least one ingredient (≤100), each with a name, an amount >0, a known unit and
a known store section, optional prep; advance-prep steps (≤20) with a
description, lead days 1–6 and minutes ≥0; step ids kept when given, else
generated, and unique. Text is trimmed and inner whitespace collapsed. Ids for
recipes are assigned by the server, never taken from the client.
`parsePlanInput` and `parseCheckedInput` (`src/domain/planInput.ts`) do the
same shape-checking for the plan and the checkbox map, filling missing
settings from `defaultSettings()` and rejecting nothing that `validatePlan`
would merely warn about.

**Why.** One definition of "valid recipe" shared by UI and server, and the
Swift port gets the same rules from the same spec.

**Known limits.** No duplicate-name check; no unit sanity per ingredient
(a "cup" of chicken thighs is accepted).

## 20. Accounts and sessions

**Decision.** Sign-up is open (the site is reachable only on the home LAN and
the tailnet). Username 2–40 chars of letters, digits, `.`, `_`, `-`, unique
case-insensitively; password ≥8 chars. Passwords are stored as scrypt
(N=2^15, r=8, p=1, 16-byte salt, 64-byte key). A session is 32 random bytes
in an `HttpOnly; SameSite=Lax` cookie, stored server-side as its SHA-256, valid
180 days and renewed on use when under 90 remain. The cookie is not `Secure`
because the site is plain http on the LAN and on tailscale's http port. Login
is throttled per client address: 10 failures in 15 minutes locks that address
for 15 minutes. Writes must be JSON (`Content-Type: application/json`), which
a cross-site form cannot send without a CORS preflight the server never
answers. A new account is seeded with a copy of the sample recipes so the app
is usable immediately; those copies are ordinary recipes, editable and
deletable.

**Why.** Boring, standard choices: nothing to get wrong, nothing to maintain.

**Known limits.** No password reset (reset by editing the database on the
box; see docs/deploy.md). No account deletion from the UI.

## 21. Saves are optimistic, debounced and retried until they land

**Decision.** Plan and checkbox edits update the screen immediately and go
through a write-behind queue (`src/api/sync.ts`): a 400 ms debounce coalesces
a burst of edits into one `PUT`, a failed save is retried with exponential
backoff (1 s, 2 s, … capped at 30 s) always sending the newest value, and an
edit made while a save is in flight is saved right after. The header shows
Saved / Saving… / Not saved yet – retrying / Not saved. Only a 4xx stops the
queue (our bug, or the session ended, which the UI reports). Leaving the page
with a save pending prompts first. Recipe create/edit/delete are plain
request–response: the form shows the server's errors and keeps the input.

**Why.** Home Wi-Fi drops; the box reboots. Edits must not disappear, and the
person must be able to tell at a glance whether they are safe.

**Known limits.** The pending value lives in memory: closing the tab during a
long outage loses it (after the prompt).

## 22. The database backs itself up

**Decision.** The server writes a consistent snapshot (`VACUUM INTO`) to
`<data dir>/backups/forkcast-<UTC timestamp>.sqlite` at startup when the
newest snapshot is older than 24 h, and checks hourly thereafter, keeping the
newest 14. `scripts/backup.sh` copies the newest one out of the Docker
volume.

**Why.** Backups that need remembering do not happen. A snapshot is a complete
database file that restores by being copied back.

**Known limits.** Snapshots live in the same volume as the database until the
script copies them elsewhere; losing the box loses both.

## 23. Mobile-first layout with one breakpoint

**Decision.** Styles are written for a phone first and one media query at
720px adds the wide layout. The week grid is the same markup both ways: seven
day cards that stack on a phone and become seven subgrid columns on a wide
screen, so breakfast/lunch/dinner rows line up across days. Form controls are
at least 16px on phones (iOS Safari zooms into anything smaller) with 40px tap
targets, 32px on wide screens. The shopping list gets 24px checkboxes, sticky
section headers and the recipe sources on their own line on phones. A cook
entry whose recipe was deleted shows as "(deleted recipe)" in its picker, so
the entry stays visible with its `unknown-recipe` warning and can be cleared.

**Why.** The shopping list is used in the store and meals get picked on the
couch; the phone is the primary screen and the laptop is the bonus. A select
that silently showed "—" for a deleted recipe left an entry that could neither
be seen nor removed.

**Known limits.** No dark mode. CSS subgrid needs Safari 16+/Chrome 117+;
older browsers show the columns without the row alignment.

## 24. Recipes carry their steps and their source

**Decision.** `Recipe.instructions` is an ordered list of step texts and
`Recipe.sourceUrl` an optional http(s) address, both optional in the type
(the shipped sample recipes have neither). `parseRecipeInput` trims steps,
drops empty ones (≤100 steps, ≤2000 chars each) and accepts only http(s)
sources. The read view (`RecipeView`) shows ingredients scaled to a chosen
serving count via `scaleIngredients`, then the steps; it is reachable from the
Recipes tab and from any planned meal.

**Why.** A planner that cannot show how to cook the dish gets abandoned at
6pm. Steps are free text on purpose: structured steps (timers, temperatures)
would make entry and import harder for no planning benefit.

**Known limits.** Steps are not linked to ingredients; no photos; no notes
field separate from the steps.

## 25. The shopping list is generated, and the user's edits are an overlay

**Decision.** `ShoppingEdits` holds hand-added items (`extras`, each with a
quantity and a section, keyed `extra:<id>` in the list) and the keys of
generated items hidden this week (`removed`). `applyShoppingEdits` layers them
over the list `buildShoppingList` produces; the generated list itself is never
edited. Hidden items stay listed under "hidden this week" and can be put
back. "Clear the week" resets the plan, the ticks and the edits together.

**Why.** The list must keep following the plan: change a meal and the list
changes. Editing generated lines directly would either be lost on the next
rebuild or stop the rebuild from happening. An overlay keeps both.

**Known limits.** A generated item's quantity cannot be adjusted (hide it and
add your own line instead). Edits are per week, not a standing list.

## 26. Importing a recipe always ends in the form

**Decision.** Imports (a web address, pasted text, a photo) produce a
`RecipeDraft`, not a recipe: fields may be missing. The draft opens in the
recipe form, prefilled, with the original line shown under each ingredient,
and nothing is saved until the person presses Add. Web pages are read from
their schema.org `Recipe` JSON-LD first (`extractJsonLdRecipe`, pure); only
pages without it, pasted text, and photos go to Claude (`server/claude.ts`,
`claude-opus-5-5` with a structured output schema), when the server has an
`ANTHROPIC_API_KEY`. Without a key, text falls back to the rule-based parser
and photo import is reported as off. The server fetches only public hosts
(`isFetchableUrl`: no LAN, loopback or `.local`), caps pages at 3 MB and
photos at ~5 MB, and the browser shrinks photos to 1600 px before upload.

**Why.** Imports are never perfect; the review step is the safety net and
keeps the data rules (Decision 19) in one place. Structured data first keeps
most imports free and offline-capable.

**Known limits.** Multi-recipe pages take the first recipe. Sites that block
non-browser clients fail with a clear message (paste the text instead).

## 27. Ingredient lines are parsed by rule, forgivingly

**Decision.** `parseIngredientLine` reads "1 ½ cups all-purpose flour,
sifted" into amount, unit (via a synonym table onto the unit model of
Decision 7), name (up to the first comma) and prep (after it). Unicode and
mixed fractions, ranges ("2–3": the low end), "(14 oz)" notes, "to taste"
(1 pinch) and bare items ("1 lime": 1 each) are handled. `guessSection`
assigns a store section from keyword lists, with produce winning for
"fresh …" and spices for "black pepper". Anything unreadable becomes
amount 1 "each" with the whole line as the name, never dropped.

**Why.** Recipe sites publish ingredients as prose; this is the no-API path
and the one the Swift port will need. Forgiving beats strict because the
person sees the original line and the result side by side.

**Known limits.** English only; no metric/US conversion; section guesses
are heuristics and the review step exists to fix them.
