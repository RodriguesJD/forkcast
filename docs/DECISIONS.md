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

## 18. Persistence is outside the domain

**Decision.** `src/storage/localStorage.ts` is the only module that touches
`window`. It stores the plan under `forkcast.plan.v1` and shopping checkbox
state under `forkcast.checked.v1`, and fills in any settings fields added
since the plan was saved.

**Why.** The domain stays portable; storage format can change independently.

**Known limits.** No migrations beyond defaulting new settings fields.
