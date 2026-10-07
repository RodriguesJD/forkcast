import type { Ingredient, Recipe } from './types';
import { scaleQuantity } from './units';

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
