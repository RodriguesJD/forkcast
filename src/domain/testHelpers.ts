import type {
  CookEntry,
  Ingredient,
  LeftoverEntry,
  MealSlot,
  Recipe,
  RecipeIndex,
  WeekPlan,
  WeekSettings,
} from './types';

export function settings(overrides: Partial<WeekSettings> = {}): WeekSettings {
  return {
    startDay: 0,
    activeSlots: ['dinner'],
    householdSize: 2,
    availableMinutesPerDay: [120, 45, 45, 45, 45, 45, 120],
    pantryStaples: [],
    batchPrepDayIndex: null,
    ...overrides,
  };
}

let counter = 0;
export function resetIds(): void {
  counter = 0;
}

export function recipe(overrides: Partial<Recipe> & { id: string }): Recipe {
  return {
    name: overrides.id,
    baseServings: 4,
    activeMinutes: 20,
    totalMinutes: 30,
    advancePrep: [],
    ingredients: [],
    ...overrides,
  };
}

export function ing(
  name: string,
  amount: number,
  unit: Ingredient['quantity']['unit'],
  extra: Partial<Omit<Ingredient, 'name' | 'quantity'>> = {},
): Ingredient {
  return { name, quantity: { amount, unit }, section: 'other', ...extra };
}

export function cook(
  recipeId: string,
  dayIndex: number,
  servings = 4, // matches recipe() default baseServings, so quantities are unscaled
  slot: MealSlot = 'dinner',
  id?: string,
): CookEntry {
  return { kind: 'cook', id: id ?? `c${++counter}`, slot: { dayIndex, slot }, recipeId, servings };
}

export function leftover(
  sourceEntryId: string,
  dayIndex: number,
  servings = 2,
  slot: MealSlot = 'dinner',
  id?: string,
): LeftoverEntry {
  return { kind: 'leftover', id: id ?? `l${++counter}`, slot: { dayIndex, slot }, sourceEntryId, servings };
}

export function plan(entries: WeekPlan['entries'], s: WeekSettings = settings()): WeekPlan {
  return { settings: s, entries };
}

export function index(...recipes: Recipe[]): RecipeIndex {
  return Object.fromEntries(recipes.map((r) => [r.id, r]));
}
