/**
 * Forkcast domain types.
 *
 * Plain data only: no classes, no Date, no browser or React types.
 * This file is the contract for the eventual Swift port.
 */

// ---------- units ----------

export type VolumeUnit = 'tsp' | 'tbsp' | 'cup' | 'floz' | 'ml' | 'l';
export type MassUnit = 'g' | 'kg' | 'oz' | 'lb';
export type CountUnit =
  | 'each'
  | 'clove'
  | 'can'
  | 'bunch'
  | 'slice'
  | 'stalk'
  | 'head'
  | 'sprig'
  | 'pinch';
export type Unit = VolumeUnit | MassUnit | CountUnit;
export type UnitFamily = 'volume' | 'mass' | 'count';

export interface Quantity {
  amount: number;
  unit: Unit;
}

// ---------- recipes ----------

export type StoreSection =
  | 'produce'
  | 'meat'
  | 'seafood'
  | 'dairy'
  | 'bakery'
  | 'frozen'
  | 'canned'
  | 'dry-goods'
  | 'spices'
  | 'other';

/** Walking order through a typical grocery store; also the canonical list of sections. */
export const STORE_SECTION_ORDER: readonly StoreSection[] = [
  'produce',
  'bakery',
  'meat',
  'seafood',
  'dairy',
  'dry-goods',
  'canned',
  'spices',
  'frozen',
  'other',
];

export function isStoreSection(value: string): value is StoreSection {
  return (STORE_SECTION_ORDER as readonly string[]).includes(value);
}

export interface Ingredient {
  /** Human-readable name, e.g. "yellow onion". Matching uses normalizeIngredientName. */
  name: string;
  /** Quantity for `Recipe.baseServings`. */
  quantity: Quantity;
  section: StoreSection;
  /** Optional prep verb, e.g. "diced". Same name + same prep across recipes drives batch-prep suggestions. */
  prep?: string;
}

export interface AdvancePrepStep {
  id: string;
  description: string;
  /** Whole days before the cook day. 1 = the day before. Must be >= 1. */
  leadDays: number;
  /** Hands-on minutes; counted toward the prep day's load. */
  activeMinutes: number;
}

export interface Recipe {
  id: string;
  name: string;
  baseServings: number;
  ingredients: Ingredient[];
  /** Hands-on minutes on the cook day. */
  activeMinutes: number;
  /** Wall-clock minutes from start to table on the cook day. */
  totalMinutes: number;
  advancePrep: AdvancePrepStep[];
}

export type RecipeIndex = Record<string, Recipe>;

// ---------- the week ----------

/** 0 = Sunday ... 6 = Saturday. Display only. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export const MEAL_SLOT_ORDER: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

export interface SlotRef {
  /** 0..6, relative to `WeekSettings.startDay`. */
  dayIndex: number;
  slot: MealSlot;
}

export interface WeekSettings {
  startDay: Weekday;
  activeSlots: MealSlot[];
  /** Default servings for new entries. Changing it never rewrites existing entries. */
  householdSize: number;
  /** Length 7, indexed by dayIndex. Hands-on cooking minutes available that day; null = no limit. */
  availableMinutesPerDay: (number | null)[];
  /** Ingredient names the user already has. Matched with normalizeIngredientName. */
  pantryStaples: string[];
  /** Day to suggest batch prep on, or null to disable suggestions. */
  batchPrepDayIndex: number | null;
}

export interface CookEntry {
  kind: 'cook';
  id: string;
  slot: SlotRef;
  recipeId: string;
  /** TOTAL portions cooked, including portions eaten later as leftovers. */
  servings: number;
}

export interface LeftoverEntry {
  kind: 'leftover';
  id: string;
  slot: SlotRef;
  sourceEntryId: string;
  /** Portions eaten at this slot. */
  servings: number;
}

export type PlanEntry = CookEntry | LeftoverEntry;

export interface WeekPlan {
  settings: WeekSettings;
  entries: PlanEntry[];
}

// ---------- warnings ----------

export type WarningCode =
  // plan validation
  | 'unknown-recipe'
  | 'invalid-servings'
  | 'duplicate-slot'
  | 'inactive-slot'
  | 'leftover-missing-source'
  | 'leftover-source-not-cook'
  | 'leftover-before-source'
  | 'leftover-over-allocated'
  // shopping
  | 'unit-conflict'
  | 'section-conflict'
  // schedule
  | 'day-overloaded'
  | 'recipe-too-long'
  | 'prep-before-week';

export interface Warning {
  code: WarningCode;
  message: string;
  entryId?: string;
  dayIndex?: number;
}

// ---------- shopping ----------

export interface ShoppingSource {
  entryId: string;
  recipeId: string;
  recipeName: string;
  quantity: Quantity;
}

export interface ShoppingItem {
  /** Stable identity: normalized name + unit family (or exact unit for counts). UI keys checkbox state on this. */
  key: string;
  name: string;
  quantity: Quantity;
  section: StoreSection;
  sources: ShoppingSource[];
  /** True when the same ingredient name also appears under an incompatible unit. */
  unmergedConflict: boolean;
}

export interface ShoppingSection {
  section: StoreSection;
  items: ShoppingItem[];
}

export interface ShoppingList {
  sections: ShoppingSection[];
  /** Normalized names that were excluded because they are pantry staples. */
  excludedStaples: string[];
  warnings: Warning[];
}

// ---------- schedule ----------

export interface CookTask {
  kind: 'cook';
  entryId: string;
  recipeId: string;
  recipeName: string;
  slot: MealSlot;
  servings: number;
  activeMinutes: number;
  totalMinutes: number;
}

export interface AdvancePrepTask {
  kind: 'advance-prep';
  forEntryId: string;
  recipeName: string;
  stepId: string;
  description: string;
  activeMinutes: number;
  /** Day the cook happens, for display ("for Wednesday dinner"). */
  forDayIndex: number;
  forSlot: MealSlot;
}

export interface BatchPrepTask {
  kind: 'batch-prep';
  description: string;
  coversEntryIds: string[];
  activeMinutes: number;
  optional: true;
}

export type ScheduleTask = CookTask | AdvancePrepTask | BatchPrepTask;

export interface DaySchedule {
  dayIndex: number;
  tasks: ScheduleTask[];
  /** Sum of active minutes of cook + advance-prep tasks. Batch prep is excluded. */
  loadMinutes: number;
  /** null = no limit configured for this day. */
  availableMinutes: number | null;
  overloaded: boolean;
}

export interface Schedule {
  /** Advance prep whose day falls before dayIndex 0. */
  beforeWeek: AdvancePrepTask[];
  days: DaySchedule[];
  warnings: Warning[];
}

// ---------- recipe library ----------

/**
 * Recipes the user has authored or edited, kept apart from the shipped seed
 * recipes. A library recipe whose id matches a seed recipe replaces it; removing
 * that library recipe restores the seed version. See resolveRecipes.
 */
export interface RecipeLibrary {
  recipes: Recipe[];
  /** Recipe ids not offered when planning new meals. Existing plan entries still resolve. */
  archivedIds: string[];
}

export type RecipeOrigin = 'seed' | 'edited-seed' | 'custom';

export type RecipeProblemCode =
  | 'empty-name'
  | 'invalid-base-servings'
  | 'invalid-active-minutes'
  | 'invalid-total-minutes'
  | 'no-ingredients'
  | 'ingredient-empty-name'
  | 'ingredient-invalid-amount'
  | 'ingredient-invalid-unit'
  | 'ingredient-invalid-section'
  | 'prep-empty-description'
  | 'prep-invalid-lead-days'
  | 'prep-invalid-minutes'
  | 'prep-duplicate-id';

/** A reason a recipe cannot be saved. Indexes point at the offending ingredient or prep step. */
export interface RecipeProblem {
  code: RecipeProblemCode;
  message: string;
  ingredientIndex?: number;
  stepIndex?: number;
}
