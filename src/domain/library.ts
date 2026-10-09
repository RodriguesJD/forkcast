import type { Recipe, RecipeIndex, RecipeLibrary, RecipeOrigin, WeekPlan } from './types';

/**
 * The recipe library: what the user has written or changed, layered over the
 * shipped seed recipes.
 *
 * One id space. A library recipe with a seed recipe's id shadows the seed
 * recipe, so a plan entry that pointed at the seed recipe now uses the edited
 * one. Removing the library recipe un-shadows it. Archiving hides a recipe from
 * the picker without touching entries that already use it.
 */

export function emptyLibrary(): RecipeLibrary {
  return { recipes: [], archivedIds: [] };
}

/** Seed recipes with library recipes layered on top (same id wins for the library). */
export function resolveRecipes(seed: RecipeIndex, library: RecipeLibrary): RecipeIndex {
  const index: RecipeIndex = { ...seed };
  for (const recipe of library.recipes) index[recipe.id] = recipe;
  return index;
}

/** Where a resolved recipe comes from, or undefined if the id is unknown. */
export function recipeOrigin(seed: RecipeIndex, library: RecipeLibrary, id: string): RecipeOrigin | undefined {
  const inLibrary = library.recipes.some((r) => r.id === id);
  const inSeed = seed[id] !== undefined;
  if (inLibrary && inSeed) return 'edited-seed';
  if (inLibrary) return 'custom';
  if (inSeed) return 'seed';
  return undefined;
}

export function isArchived(library: RecipeLibrary, id: string): boolean {
  return library.archivedIds.includes(id);
}

/** Add a recipe, or replace the library recipe with the same id. */
export function upsertRecipe(library: RecipeLibrary, recipe: Recipe): RecipeLibrary {
  const exists = library.recipes.some((r) => r.id === recipe.id);
  const recipes = exists ? library.recipes.map((r) => (r.id === recipe.id ? recipe : r)) : [...library.recipes, recipe];
  return { ...library, recipes };
}

/**
 * Remove a recipe from the library. For a custom recipe this deletes it; for an
 * edited seed recipe this reverts to the seed version. The archived flag is
 * cleared too, so a reverted seed recipe reappears in the picker.
 */
export function removeRecipe(library: RecipeLibrary, id: string): RecipeLibrary {
  return {
    recipes: library.recipes.filter((r) => r.id !== id),
    archivedIds: library.archivedIds.filter((a) => a !== id),
  };
}

export function setArchived(library: RecipeLibrary, id: string, archived: boolean): RecipeLibrary {
  const without = library.archivedIds.filter((a) => a !== id);
  return { ...library, archivedIds: archived ? [...without, id] : without };
}

/** Recipes offered when planning a new meal: everything resolved, minus archived, sorted by name. */
export function plannableRecipes(index: RecipeIndex, library: RecipeLibrary): Recipe[] {
  return Object.values(index)
    .filter((r) => !isArchived(library, r.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Number of cook entries in the plan that use this recipe (in any slot, active or not). */
export function recipeUsage(plan: WeekPlan, recipeId: string): number {
  return plan.entries.filter((e) => e.kind === 'cook' && e.recipeId === recipeId).length;
}
