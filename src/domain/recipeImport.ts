import type { Recipe, StoreSection, Warning } from './types';
import { isUnit } from './units';

/**
 * Recipe validation and JSON import.
 *
 * Recipes are user data, so nothing here trusts the shape of what it is given.
 * validateRecipe checks a Recipe-shaped value field by field and returns
 * warnings; parseRecipes turns JSON text into recipes and refuses the whole
 * batch if anything is wrong, so the recipe set is always all-valid or unchanged.
 */

export const STORE_SECTIONS: readonly StoreSection[] = [
  'produce',
  'meat',
  'seafood',
  'dairy',
  'bakery',
  'frozen',
  'canned',
  'dry-goods',
  'spices',
  'other',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validate one recipe-shaped value. Returns [] when it is a usable Recipe.
 * `label` names the recipe in messages when it has no usable id.
 */
export function validateRecipe(value: unknown, label = 'recipe'): Warning[] {
  const warnings: Warning[] = [];
  if (!isRecord(value)) {
    return [{ code: 'recipe-not-object', message: `${label} is not an object.` }];
  }
  const recipeId = isNonEmptyString(value.id) ? value.id : undefined;
  const name = recipeId ?? label;
  const warn = (code: Warning['code'], message: string) =>
    warnings.push({ code, message: `${name}: ${message}`, recipeId });

  if (!recipeId) warn('recipe-missing-id', 'id must be a non-empty string.');
  if (!isNonEmptyString(value.name)) warn('recipe-missing-name', 'name must be a non-empty string.');
  if (!isPositiveNumber(value.baseServings)) {
    warn('recipe-invalid-servings', `baseServings must be a positive number, got ${JSON.stringify(value.baseServings)}.`);
  }
  if (!isNonNegativeNumber(value.activeMinutes)) {
    warn('recipe-invalid-time', 'activeMinutes must be a number >= 0.');
  }
  if (!isNonNegativeNumber(value.totalMinutes)) {
    warn('recipe-invalid-time', 'totalMinutes must be a number >= 0.');
  } else if (isNonNegativeNumber(value.activeMinutes) && value.totalMinutes < value.activeMinutes) {
    warn('recipe-invalid-time', `totalMinutes (${value.totalMinutes}) is less than activeMinutes (${value.activeMinutes}).`);
  }

  if (!Array.isArray(value.ingredients) || value.ingredients.length === 0) {
    warn('recipe-no-ingredients', 'ingredients must be a non-empty array.');
  } else {
    value.ingredients.forEach((ing: unknown, i: number) => {
      const where = `ingredient ${i + 1}`;
      if (!isRecord(ing)) {
        warn('recipe-invalid-ingredient', `${where} is not an object.`);
        return;
      }
      const ingName = isNonEmptyString(ing.name) ? `"${ing.name}"` : where;
      if (!isNonEmptyString(ing.name)) warn('recipe-invalid-ingredient', `${where} needs a name.`);
      if (!isRecord(ing.quantity)) {
        warn('recipe-invalid-quantity', `${ingName} needs quantity { amount, unit }.`);
      } else {
        if (!isPositiveNumber(ing.quantity.amount)) {
          warn('recipe-invalid-quantity', `${ingName} amount must be a positive number.`);
        }
        if (typeof ing.quantity.unit !== 'string' || !isUnit(ing.quantity.unit)) {
          warn('recipe-invalid-unit', `${ingName} has unknown unit ${JSON.stringify(ing.quantity.unit)}.`);
        }
      }
      if (typeof ing.section !== 'string' || !(STORE_SECTIONS as readonly string[]).includes(ing.section)) {
        warn('recipe-invalid-section', `${ingName} has unknown section ${JSON.stringify(ing.section)}.`);
      }
      if (ing.prep !== undefined && typeof ing.prep !== 'string') {
        warn('recipe-invalid-ingredient', `${ingName} prep must be a string when present.`);
      }
    });
  }

  if (value.advancePrep !== undefined) {
    if (!Array.isArray(value.advancePrep)) {
      warn('recipe-invalid-prep-step', 'advancePrep must be an array.');
    } else {
      value.advancePrep.forEach((step: unknown, i: number) => {
        const where = `advance prep step ${i + 1}`;
        if (!isRecord(step)) {
          warn('recipe-invalid-prep-step', `${where} is not an object.`);
          return;
        }
        if (!isNonEmptyString(step.id)) warn('recipe-invalid-prep-step', `${where} needs an id.`);
        if (!isNonEmptyString(step.description)) warn('recipe-invalid-prep-step', `${where} needs a description.`);
        if (!(Number.isInteger(step.leadDays) && (step.leadDays as number) >= 1)) {
          warn('recipe-invalid-prep-step', `${where} leadDays must be a whole number >= 1.`);
        }
        if (!isNonNegativeNumber(step.activeMinutes)) {
          warn('recipe-invalid-prep-step', `${where} activeMinutes must be a number >= 0.`);
        }
      });
    }
  }

  return warnings;
}

export interface RecipeImportResult {
  /** Valid recipes. Empty when `warnings` is non-empty. */
  recipes: Recipe[];
  warnings: Warning[];
}

/**
 * Parse JSON text into recipes. All-or-nothing: any warning means no recipes
 * are returned, so a half-valid paste never replaces a working recipe set.
 * A missing `advancePrep` is filled in as [].
 */
export function parseRecipes(text: string): RecipeImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      recipes: [],
      warnings: [{ code: 'recipe-not-json', message: `Not valid JSON: ${(e as Error).message}` }],
    };
  }
  if (!Array.isArray(parsed)) {
    return { recipes: [], warnings: [{ code: 'recipe-not-array', message: 'Expected a JSON array of recipes.' }] };
  }

  const warnings: Warning[] = [];
  const seen = new Set<string>();
  const recipes: Recipe[] = [];
  parsed.forEach((value: unknown, i: number) => {
    const label = `recipe ${i + 1}`;
    const w = validateRecipe(value, label);
    warnings.push(...w);
    if (w.length > 0) return;
    const r = value as Recipe;
    if (seen.has(r.id)) {
      warnings.push({ code: 'recipe-duplicate-id', recipeId: r.id, message: `${r.id}: id appears more than once.` });
      return;
    }
    seen.add(r.id);
    recipes.push({ ...r, advancePrep: r.advancePrep ?? [] });
  });

  return warnings.length > 0 ? { recipes: [], warnings } : { recipes, warnings: [] };
}

/** Pretty JSON for editing in a text area. */
export function serializeRecipes(recipes: Recipe[]): string {
  return JSON.stringify(recipes, null, 2);
}
