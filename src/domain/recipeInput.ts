import type { AdvancePrepStep, Ingredient, Recipe, StoreSection, Unit } from './types';
import { isUnit } from './units';
import { STORE_SECTION_ORDER } from './shopping';

/**
 * Validation of a recipe as entered by a person (or received over the wire).
 *
 * Both the recipe form and the server call `parseRecipeInput` on untrusted
 * input, so the rules live here, once, in pure code. The result is either a
 * clean `RecipeInput` (a `Recipe` without an id; ids are assigned by storage)
 * or a list of human-readable errors, each naming the field it concerns.
 */

export type RecipeInput = Omit<Recipe, 'id'>;

export type RecipeParseResult = { ok: true; recipe: RecipeInput } | { ok: false; errors: string[] };

export const RECIPE_LIMITS = {
  nameMaxLength: 120,
  maxIngredients: 100,
  maxAdvancePrepSteps: 20,
  /** One week, in minutes. Nothing in a weekly planner takes longer. */
  maxMinutes: 7 * 24 * 60,
  maxServings: 100,
  maxAmount: 1_000_000,
  maxLeadDays: 6,
  textMaxLength: 200,
} as const;

export function isStoreSection(value: string): value is StoreSection {
  return (STORE_SECTION_ORDER as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().replace(/\s+/g, ' ');
}

function wholeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Validate and normalise a recipe. Unknown fields are dropped; text is trimmed
 * with inner whitespace collapsed; `prep` that is empty is removed; advance-prep
 * step ids are kept when present and generated (`step-1`, `step-2`, …) when not.
 */
export function parseRecipeInput(raw: unknown): RecipeParseResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['Recipe must be an object.'] };

  const name = cleanText(raw.name);
  if (name === null || name.length === 0) errors.push('Name is required.');
  else if (name.length > RECIPE_LIMITS.nameMaxLength) {
    errors.push(`Name must be at most ${RECIPE_LIMITS.nameMaxLength} characters.`);
  }

  const baseServings = wholeNumber(raw.baseServings);
  if (baseServings === null || baseServings < 1 || baseServings > RECIPE_LIMITS.maxServings) {
    errors.push(`Servings must be a whole number from 1 to ${RECIPE_LIMITS.maxServings}.`);
  }

  const activeMinutes = wholeNumber(raw.activeMinutes);
  if (activeMinutes === null || activeMinutes < 0 || activeMinutes > RECIPE_LIMITS.maxMinutes) {
    errors.push('Hands-on minutes must be a whole number of 0 or more.');
  }
  const totalMinutes = wholeNumber(raw.totalMinutes);
  if (totalMinutes === null || totalMinutes < 0 || totalMinutes > RECIPE_LIMITS.maxMinutes) {
    errors.push('Total minutes must be a whole number of 0 or more.');
  } else if (activeMinutes !== null && totalMinutes < activeMinutes) {
    errors.push('Total minutes cannot be less than hands-on minutes.');
  }

  const ingredients: Ingredient[] = [];
  if (!Array.isArray(raw.ingredients) || raw.ingredients.length === 0) {
    errors.push('Add at least one ingredient.');
  } else if (raw.ingredients.length > RECIPE_LIMITS.maxIngredients) {
    errors.push(`A recipe can have at most ${RECIPE_LIMITS.maxIngredients} ingredients.`);
  } else {
    raw.ingredients.forEach((item: unknown, i: number) => {
      const label = `Ingredient ${i + 1}`;
      if (!isRecord(item)) {
        errors.push(`${label} is not valid.`);
        return;
      }
      const ingName = cleanText(item.name);
      if (ingName === null || ingName.length === 0) errors.push(`${label}: name is required.`);
      else if (ingName.length > RECIPE_LIMITS.textMaxLength) errors.push(`${label}: name is too long.`);

      let unit: Unit | null = null;
      let amount: number | null = null;
      if (!isRecord(item.quantity)) {
        errors.push(`${label}: amount and unit are required.`);
      } else {
        amount = finiteNumber(item.quantity.amount);
        if (amount === null || amount <= 0 || amount > RECIPE_LIMITS.maxAmount) {
          errors.push(`${label}: amount must be a number greater than 0.`);
        }
        if (typeof item.quantity.unit === 'string' && isUnit(item.quantity.unit)) unit = item.quantity.unit;
        else errors.push(`${label}: pick a unit.`);
      }

      let section: StoreSection | null = null;
      if (typeof item.section === 'string' && isStoreSection(item.section)) section = item.section;
      else errors.push(`${label}: pick a store section.`);

      let prep: string | undefined;
      if (item.prep !== undefined && item.prep !== null) {
        const p = cleanText(item.prep);
        if (p === null) errors.push(`${label}: prep must be text.`);
        else if (p.length > RECIPE_LIMITS.textMaxLength) errors.push(`${label}: prep is too long.`);
        else if (p.length > 0) prep = p;
      }

      if (ingName && amount !== null && unit && section) {
        ingredients.push({
          name: ingName,
          quantity: { amount, unit },
          section,
          ...(prep !== undefined ? { prep } : {}),
        });
      }
    });
  }

  const advancePrep: AdvancePrepStep[] = [];
  const rawSteps = raw.advancePrep === undefined || raw.advancePrep === null ? [] : raw.advancePrep;
  if (!Array.isArray(rawSteps)) {
    errors.push('Advance prep must be a list of steps.');
  } else if (rawSteps.length > RECIPE_LIMITS.maxAdvancePrepSteps) {
    errors.push(`A recipe can have at most ${RECIPE_LIMITS.maxAdvancePrepSteps} advance prep steps.`);
  } else {
    const seenIds = new Set<string>();
    rawSteps.forEach((item: unknown, i: number) => {
      const label = `Advance prep step ${i + 1}`;
      if (!isRecord(item)) {
        errors.push(`${label} is not valid.`);
        return;
      }
      const description = cleanText(item.description);
      if (description === null || description.length === 0) errors.push(`${label}: description is required.`);
      else if (description.length > RECIPE_LIMITS.textMaxLength) errors.push(`${label}: description is too long.`);

      const leadDays = wholeNumber(item.leadDays);
      if (leadDays === null || leadDays < 1 || leadDays > RECIPE_LIMITS.maxLeadDays) {
        errors.push(`${label}: days before must be a whole number from 1 to ${RECIPE_LIMITS.maxLeadDays}.`);
      }
      const stepMinutes = wholeNumber(item.activeMinutes);
      if (stepMinutes === null || stepMinutes < 0 || stepMinutes > RECIPE_LIMITS.maxMinutes) {
        errors.push(`${label}: hands-on minutes must be a whole number of 0 or more.`);
      }

      let id = typeof item.id === 'string' ? item.id.trim() : '';
      if (id.length === 0) id = `step-${i + 1}`;
      if (id.length > RECIPE_LIMITS.textMaxLength) errors.push(`${label}: id is too long.`);
      if (seenIds.has(id)) errors.push(`${label}: duplicate step id "${id}".`);
      seenIds.add(id);

      if (description && leadDays !== null && stepMinutes !== null) {
        advancePrep.push({ id, description, leadDays, activeMinutes: stepMinutes });
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    recipe: {
      name: name as string,
      baseServings: baseServings as number,
      activeMinutes: activeMinutes as number,
      totalMinutes: totalMinutes as number,
      ingredients,
      advancePrep,
    },
  };
}
