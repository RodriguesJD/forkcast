import {
  MEAL_SLOT_ORDER,
  type CookEntry,
  type MealSlot,
  type PlanEntry,
  type RecipeIndex,
  type SlotRef,
  type Warning,
  type WeekPlan,
  type WeekSettings,
  type Weekday,
} from './types';

export const WEEKDAY_NAMES: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const DAYS_PER_WEEK = 7;

/** Calendar weekday for a plan day. */
export function weekdayFor(settings: WeekSettings, dayIndex: number): Weekday {
  return (((settings.startDay + dayIndex) % 7) + 7) % 7 as Weekday;
}

export function weekdayName(settings: WeekSettings, dayIndex: number): string {
  return WEEKDAY_NAMES[weekdayFor(settings, dayIndex)];
}

/** Linear position of a slot in the week: day 0 breakfast = 0, day 0 lunch = 1, ... */
export function slotOrdinal(slot: SlotRef): number {
  return slot.dayIndex * MEAL_SLOT_ORDER.length + MEAL_SLOT_ORDER.indexOf(slot.slot);
}

export function compareSlots(a: SlotRef, b: SlotRef): number {
  return slotOrdinal(a) - slotOrdinal(b);
}

export function sameSlot(a: SlotRef, b: SlotRef): boolean {
  return a.dayIndex === b.dayIndex && a.slot === b.slot;
}

export function isDayInWeek(dayIndex: number): boolean {
  return Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex < DAYS_PER_WEEK;
}

export function isSlotActive(settings: WeekSettings, slot: SlotRef): boolean {
  return isDayInWeek(slot.dayIndex) && settings.activeSlots.includes(slot.slot);
}

/** Every active slot in the week, in order. */
export function slotSequence(settings: WeekSettings): SlotRef[] {
  const slots: SlotRef[] = [];
  for (let dayIndex = 0; dayIndex < DAYS_PER_WEEK; dayIndex++) {
    for (const slot of MEAL_SLOT_ORDER) {
      if (settings.activeSlots.includes(slot)) slots.push({ dayIndex, slot });
    }
  }
  return slots;
}

/** Active meal slots in canonical breakfast/lunch/dinner order. */
export function activeSlotsInOrder(settings: WeekSettings): MealSlot[] {
  return MEAL_SLOT_ORDER.filter((s) => settings.activeSlots.includes(s));
}

export function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

export function entryAt(plan: WeekPlan, slot: SlotRef): PlanEntry | undefined {
  return plan.entries.find((e) => sameSlot(e.slot, slot));
}

/**
 * Cook entries that shopping and scheduling act on: in an active slot, with a
 * known recipe and valid servings. Everything else is reported by validatePlan
 * and otherwise ignored, so a bad entry never silently corrupts the outputs.
 */
export function effectiveCookEntries(plan: WeekPlan, recipes: RecipeIndex): CookEntry[] {
  return plan.entries
    .filter((e): e is CookEntry => e.kind === 'cook')
    .filter(
      (e) =>
        isSlotActive(plan.settings, e.slot) &&
        recipes[e.recipeId] !== undefined &&
        isPositiveInteger(e.servings),
    )
    .sort((a, b) => compareSlots(a.slot, b.slot));
}

function describeSlot(settings: WeekSettings, slot: SlotRef): string {
  return `${weekdayName(settings, slot.dayIndex)} ${slot.slot}`;
}

/**
 * Structural checks on a plan. Returns warnings; never throws.
 *
 * Servings rule: a cook entry feeds `householdSize` at its own slot plus every
 * leftover slot that points at it. If those portions exceed the cooked servings,
 * the shopping list will be short, so warn.
 */
export function validatePlan(plan: WeekPlan, recipes: RecipeIndex): Warning[] {
  const warnings: Warning[] = [];
  const { settings } = plan;
  const byId = new Map<string, PlanEntry>();

  for (const entry of plan.entries) {
    byId.set(entry.id, entry);
    const where = describeSlot(settings, entry.slot);

    if (!isSlotActive(settings, entry.slot)) {
      warnings.push({
        code: 'inactive-slot',
        entryId: entry.id,
        dayIndex: entry.slot.dayIndex,
        message: `${where} is not an active slot; this entry is ignored.`,
      });
    }
    if (!isPositiveInteger(entry.servings)) {
      warnings.push({
        code: 'invalid-servings',
        entryId: entry.id,
        dayIndex: entry.slot.dayIndex,
        message: `${where} has servings ${entry.servings}; must be a positive whole number.`,
      });
    }
    if (entry.kind === 'cook' && recipes[entry.recipeId] === undefined) {
      warnings.push({
        code: 'unknown-recipe',
        entryId: entry.id,
        dayIndex: entry.slot.dayIndex,
        message: `${where} references unknown recipe "${entry.recipeId}".`,
      });
    }
  }

  // duplicate slots
  const seen = new Map<string, PlanEntry>();
  for (const entry of plan.entries) {
    const key = `${entry.slot.dayIndex}|${entry.slot.slot}`;
    const prior = seen.get(key);
    if (prior) {
      warnings.push({
        code: 'duplicate-slot',
        entryId: entry.id,
        dayIndex: entry.slot.dayIndex,
        message: `${describeSlot(settings, entry.slot)} has more than one entry.`,
      });
    } else {
      seen.set(key, entry);
    }
  }

  // leftovers
  const leftoverPortions = new Map<string, number>();
  for (const entry of plan.entries) {
    if (entry.kind !== 'leftover') continue;
    const where = describeSlot(settings, entry.slot);
    const source = byId.get(entry.sourceEntryId);
    if (!source) {
      warnings.push({
        code: 'leftover-missing-source',
        entryId: entry.id,
        dayIndex: entry.slot.dayIndex,
        message: `${where} leftover points at a meal that no longer exists.`,
      });
      continue;
    }
    if (source.kind !== 'cook') {
      warnings.push({
        code: 'leftover-source-not-cook',
        entryId: entry.id,
        dayIndex: entry.slot.dayIndex,
        message: `${where} leftover points at another leftover; point it at the cooked meal instead.`,
      });
      continue;
    }
    if (compareSlots(entry.slot, source.slot) <= 0) {
      warnings.push({
        code: 'leftover-before-source',
        entryId: entry.id,
        dayIndex: entry.slot.dayIndex,
        message: `${where} leftover comes before (or at) the meal it comes from, ${describeSlot(settings, source.slot)}.`,
      });
    }
    if (isPositiveInteger(entry.servings)) {
      leftoverPortions.set(source.id, (leftoverPortions.get(source.id) ?? 0) + entry.servings);
    }
  }

  for (const entry of plan.entries) {
    if (entry.kind !== 'cook' || !isPositiveInteger(entry.servings)) continue;
    const needed = settings.householdSize + (leftoverPortions.get(entry.id) ?? 0);
    if (needed > entry.servings) {
      warnings.push({
        code: 'leftover-over-allocated',
        entryId: entry.id,
        dayIndex: entry.slot.dayIndex,
        message: `${describeSlot(settings, entry.slot)} cooks ${entry.servings} servings but ${needed} are planned to be eaten (household of ${settings.householdSize} plus leftovers).`,
      });
    }
  }

  return warnings;
}

// ---------- pure plan edits ----------

/** Replace the entry at `entry.slot` (if any) with `entry`. Leftovers pointing at a replaced cook entry are removed. */
export function setEntry(plan: WeekPlan, entry: PlanEntry): WeekPlan {
  const displaced = entryAt(plan, entry.slot);
  let entries = plan.entries;
  if (displaced && displaced.id !== entry.id) {
    entries = removeEntry({ ...plan, entries }, displaced.id).entries;
  }
  const idx = entries.findIndex((e) => e.id === entry.id);
  const next = idx >= 0 ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry];
  return { ...plan, entries: next };
}

/** Remove an entry and any leftovers that depend on it. */
export function removeEntry(plan: WeekPlan, entryId: string): WeekPlan {
  return {
    ...plan,
    entries: plan.entries.filter(
      (e) => e.id !== entryId && !(e.kind === 'leftover' && e.sourceEntryId === entryId),
    ),
  };
}

export function clearSlot(plan: WeekPlan, slot: SlotRef): WeekPlan {
  const existing = entryAt(plan, slot);
  return existing ? removeEntry(plan, existing.id) : plan;
}
