import { isStoreSection, type Ingredient, type Recipe, type RecipeProblem } from './types';
import { isUnit, scaleQuantity } from './units';

/**
 * Ingredient name matching.
 *
 * Deliberately naive: lowercase, trim, collapse whitespace. "Yellow Onion" and
 * "yellow onion" match; "onion" and "yellow onion" do not. This is the single
 * place to add synonyms, plural stripping, or a catalog lookup later.
 */
export function normalizeIngredientName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Scale factor for cooking `servings` of `recipe`. */
export function scaleFactor(recipe: Recipe, servings: number): number {
  return servings / recipe.baseServings;
}

/**
 * Ingredients scaled linearly to `servings`. No rounding; display handles that.
 * Throws on non-positive servings or baseServings because the result would be meaningless.
 */
export function scaleIngredients(recipe: Recipe, servings: number): Ingredient[] {
  if (!(servings > 0)) throw new Error(`servings must be > 0, got ${servings}`);
  if (!(recipe.baseServings > 0)) {
    throw new Error(`recipe ${recipe.id} has invalid baseServings ${recipe.baseServings}`);
  }
  const factor = scaleFactor(recipe, servings);
  return recipe.ingredients.map((ing) => ({
    ...ing,
    quantity: scaleQuantity(ing.quantity, factor),
  }));
}

/**
 * Everything a recipe must satisfy before it is saved. Returns problems; never
 * throws. The UI shows these next to the form; the Swift port gets the same rules.
 *
 * Rules: non-empty name; base servings a positive integer; active minutes a
 * non-negative integer; total minutes an integer at least as large as active
 * minutes and at least 1; at least one ingredient; every ingredient has a name,
 * a finite positive amount, a known unit and a known section; every advance
 * prep step has a description, an integer leadDays >= 1, a non-negative integer
 * activeMinutes, and an id unique within the recipe.
 */
export function validateRecipe(recipe: Recipe): RecipeProblem[] {
  const problems: RecipeProblem[] = [];
  const nonNegInt = (n: number) => Number.isInteger(n) && n >= 0;

  if (recipe.name.trim() === '') {
    problems.push({ code: 'empty-name', message: 'Give the recipe a name.' });
  }
  if (!(Number.isInteger(recipe.baseServings) && recipe.baseServings > 0)) {
    problems.push({ code: 'invalid-base-servings', message: 'Servings must be a whole number of 1 or more.' });
  }
  if (!nonNegInt(recipe.activeMinutes)) {
    problems.push({ code: 'invalid-active-minutes', message: 'Hands-on minutes must be a whole number of 0 or more.' });
  }
  if (!(Number.isInteger(recipe.totalMinutes) && recipe.totalMinutes >= 1)) {
    problems.push({ code: 'invalid-total-minutes', message: 'Total minutes must be a whole number of 1 or more.' });
  } else if (nonNegInt(recipe.activeMinutes) && recipe.totalMinutes < recipe.activeMinutes) {
    problems.push({
      code: 'invalid-total-minutes',
      message: 'Total minutes cannot be less than hands-on minutes.',
    });
  }

  if (recipe.ingredients.length === 0) {
    problems.push({ code: 'no-ingredients', message: 'Add at least one ingredient.' });
  }
  recipe.ingredients.forEach((ing, ingredientIndex) => {
    const label = ing.name.trim() === '' ? `Ingredient ${ingredientIndex + 1}` : ing.name.trim();
    if (ing.name.trim() === '') {
      problems.push({ code: 'ingredient-empty-name', ingredientIndex, message: `${label} needs a name.` });
    }
    if (!(Number.isFinite(ing.quantity.amount) && ing.quantity.amount > 0)) {
      problems.push({ code: 'ingredient-invalid-amount', ingredientIndex, message: `${label}: amount must be more than 0.` });
    }
    if (!isUnit(ing.quantity.unit)) {
      problems.push({ code: 'ingredient-invalid-unit', ingredientIndex, message: `${label}: unknown unit.` });
    }
    if (!isStoreSection(ing.section)) {
      problems.push({ code: 'ingredient-invalid-section', ingredientIndex, message: `${label}: unknown store section.` });
    }
  });

  const seenStepIds = new Set<string>();
  recipe.advancePrep.forEach((step, stepIndex) => {
    const label = step.description.trim() === '' ? `Prep step ${stepIndex + 1}` : step.description.trim();
    if (step.description.trim() === '') {
      problems.push({ code: 'prep-empty-description', stepIndex, message: `${label} needs a description.` });
    }
    if (!(Number.isInteger(step.leadDays) && step.leadDays >= 1)) {
      problems.push({ code: 'prep-invalid-lead-days', stepIndex, message: `${label}: days ahead must be a whole number of 1 or more.` });
    }
    if (!nonNegInt(step.activeMinutes)) {
      problems.push({ code: 'prep-invalid-minutes', stepIndex, message: `${label}: hands-on minutes must be a whole number of 0 or more.` });
    }
    if (seenStepIds.has(step.id)) {
      problems.push({ code: 'prep-duplicate-id', stepIndex, message: `${label}: duplicate step id "${step.id}".` });
    }
    seenStepIds.add(step.id);
  });

  return problems;
}
