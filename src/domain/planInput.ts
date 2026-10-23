import type { MealSlot, PlanEntry, SlotRef, WeekPlan, WeekSettings, Weekday } from './types';
import { MEAL_SLOT_ORDER } from './types';
import { DAYS_PER_WEEK } from './plan';
import { defaultSettings } from './defaults';

/**
 * Structural validation of a `WeekPlan` received over the wire.
 *
 * This checks *shape* only: every field present with the right type. It does
 * not reject plans that `validatePlan` would warn about (unknown recipe,
 * servings of 0 while someone is still typing), because those are legitimate
 * states the UI shows warnings for. Missing settings fields are filled from
 * `defaultSettings()`, which is how settings added later get a value.
 */

export type PlanParseResult = { ok: true; plan: WeekPlan } | { ok: false; errors: string[] };

export const PLAN_LIMITS = {
  maxEntries: DAYS_PER_WEEK * MEAL_SLOT_ORDER.length * 4,
  maxPantryStaples: 500,
  idMaxLength: 200,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMealSlot(value: unknown): value is MealSlot {
  return typeof value === 'string' && (MEAL_SLOT_ORDER as readonly string[]).includes(value);
}

function isWholeInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PLAN_LIMITS.idMaxLength;
}

function parseSettings(raw: unknown, errors: string[]): WeekSettings {
  const base = defaultSettings();
  if (!isRecord(raw)) {
    errors.push('settings must be an object.');
    return base;
  }
  const s: WeekSettings = { ...base };

  if (raw.startDay !== undefined) {
    if (isWholeInRange(raw.startDay, 0, 6)) s.startDay = raw.startDay as Weekday;
    else errors.push('settings.startDay must be 0..6.');
  }
  if (raw.activeSlots !== undefined) {
    if (Array.isArray(raw.activeSlots) && raw.activeSlots.every(isMealSlot)) {
      s.activeSlots = Array.from(new Set(raw.activeSlots as MealSlot[]));
    } else errors.push('settings.activeSlots must be a list of meal slots.');
  }
  if (raw.householdSize !== undefined) {
    if (isWholeInRange(raw.householdSize, 1, 1000)) s.householdSize = raw.householdSize;
    else errors.push('settings.householdSize must be a whole number of at least 1.');
  }
  if (raw.availableMinutesPerDay !== undefined) {
    const a = raw.availableMinutesPerDay;
    if (
      Array.isArray(a) &&
      a.length === DAYS_PER_WEEK &&
      a.every((m) => m === null || (typeof m === 'number' && Number.isFinite(m) && m >= 0))
    ) {
      s.availableMinutesPerDay = a as (number | null)[];
    } else errors.push('settings.availableMinutesPerDay must be 7 numbers or nulls.');
  }
  if (raw.pantryStaples !== undefined) {
    const p = raw.pantryStaples;
    if (Array.isArray(p) && p.length <= PLAN_LIMITS.maxPantryStaples && p.every((x) => typeof x === 'string')) {
      s.pantryStaples = (p as string[]).map((x) => x.trim()).filter((x) => x.length > 0);
    } else errors.push('settings.pantryStaples must be a list of names.');
  }
  if (raw.batchPrepDayIndex !== undefined) {
    if (raw.batchPrepDayIndex === null || isWholeInRange(raw.batchPrepDayIndex, 0, DAYS_PER_WEEK - 1)) {
      s.batchPrepDayIndex = raw.batchPrepDayIndex as number | null;
    } else errors.push('settings.batchPrepDayIndex must be null or 0..6.');
  }
  return s;
}

function parseSlot(raw: unknown): SlotRef | null {
  if (!isRecord(raw)) return null;
  if (!isWholeInRange(raw.dayIndex, -1000, 1000) || !isMealSlot(raw.slot)) return null;
  return { dayIndex: raw.dayIndex, slot: raw.slot };
}

function parseEntry(raw: unknown, i: number, errors: string[]): PlanEntry | null {
  const label = `entries[${i}]`;
  if (!isRecord(raw)) {
    errors.push(`${label} must be an object.`);
    return null;
  }
  const slot = parseSlot(raw.slot);
  if (!isId(raw.id) || slot === null || typeof raw.servings !== 'number' || !Number.isFinite(raw.servings)) {
    errors.push(`${label} needs an id, a slot and numeric servings.`);
    return null;
  }
  if (raw.kind === 'cook' && isId(raw.recipeId)) {
    return { kind: 'cook', id: raw.id, slot, recipeId: raw.recipeId, servings: raw.servings };
  }
  if (raw.kind === 'leftover' && isId(raw.sourceEntryId)) {
    return { kind: 'leftover', id: raw.id, slot, sourceEntryId: raw.sourceEntryId, servings: raw.servings };
  }
  errors.push(`${label} must be a cook entry with recipeId or a leftover entry with sourceEntryId.`);
  return null;
}

export function parsePlanInput(raw: unknown): PlanParseResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['Plan must be an object.'] };
  const settings = parseSettings(raw.settings, errors);
  const entries: PlanEntry[] = [];
  if (!Array.isArray(raw.entries)) {
    errors.push('entries must be a list.');
  } else if (raw.entries.length > PLAN_LIMITS.maxEntries) {
    errors.push(`entries can hold at most ${PLAN_LIMITS.maxEntries} items.`);
  } else {
    const ids = new Set<string>();
    raw.entries.forEach((e: unknown, i: number) => {
      const entry = parseEntry(e, i, errors);
      if (!entry) return;
      if (ids.has(entry.id)) {
        errors.push(`entries[${i}] repeats id "${entry.id}".`);
        return;
      }
      ids.add(entry.id);
      entries.push(entry);
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan: { settings, entries } };
}

/** Shopping-list checkbox state: item key -> checked. Only `true` values are kept. */
export function parseCheckedInput(raw: unknown, maxKeys = 5000): Record<string, boolean> | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length > maxKeys) return null;
  const out: Record<string, boolean> = {};
  for (const key of keys) {
    const v = raw[key];
    if (typeof v !== 'boolean') return null;
    if (v && key.length <= PLAN_LIMITS.idMaxLength) out[key] = true;
  }
  return out;
}
