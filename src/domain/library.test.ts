import { describe, expect, it } from 'vitest';
import {
  emptyLibrary,
  isArchived,
  plannableRecipes,
  recipeOrigin,
  recipeUsage,
  removeRecipe,
  resolveRecipes,
  setArchived,
  upsertRecipe,
} from './library';
import { cook, index, plan, recipe } from './testHelpers';

const seed = index(recipe({ id: 'chili', name: 'Chili' }), recipe({ id: 'tacos', name: 'Tacos' }));

describe('resolveRecipes', () => {
  it('returns the seed recipes when the library is empty', () => {
    expect(resolveRecipes(seed, emptyLibrary())).toEqual(seed);
  });

  it('adds custom recipes and lets a library recipe shadow a seed recipe with the same id', () => {
    const mine = recipe({ id: 'soup', name: 'Soup' });
    const edited = recipe({ id: 'chili', name: 'Chili, my way', baseServings: 8 });
    const lib = upsertRecipe(upsertRecipe(emptyLibrary(), mine), edited);
    const resolved = resolveRecipes(seed, lib);
    expect(Object.keys(resolved).sort()).toEqual(['chili', 'soup', 'tacos']);
    expect(resolved.chili).toBe(edited);
    expect(resolved.tacos).toBe(seed.tacos);
  });

  it('does not mutate the seed index', () => {
    const lib = upsertRecipe(emptyLibrary(), recipe({ id: 'chili', name: 'changed' }));
    resolveRecipes(seed, lib);
    expect(seed.chili.name).toBe('Chili');
  });
});

describe('recipeOrigin', () => {
  it('distinguishes seed, edited seed, custom and unknown', () => {
    const lib = upsertRecipe(upsertRecipe(emptyLibrary(), recipe({ id: 'chili' })), recipe({ id: 'soup' }));
    expect(recipeOrigin(seed, lib, 'tacos')).toBe('seed');
    expect(recipeOrigin(seed, lib, 'chili')).toBe('edited-seed');
    expect(recipeOrigin(seed, lib, 'soup')).toBe('custom');
    expect(recipeOrigin(seed, lib, 'nope')).toBeUndefined();
  });
});

describe('upsertRecipe / removeRecipe', () => {
  it('replaces an existing library recipe in place instead of duplicating it', () => {
    let lib = upsertRecipe(emptyLibrary(), recipe({ id: 'soup', name: 'v1' }));
    lib = upsertRecipe(lib, recipe({ id: 'stew', name: 'stew' }));
    lib = upsertRecipe(lib, recipe({ id: 'soup', name: 'v2' }));
    expect(lib.recipes.map((r) => `${r.id}:${r.name}`)).toEqual(['soup:v2', 'stew:stew']);
  });

  it('removing an edited seed recipe reverts to the seed version and un-archives it', () => {
    let lib = upsertRecipe(emptyLibrary(), recipe({ id: 'chili', name: 'edited' }));
    lib = setArchived(lib, 'chili', true);
    lib = removeRecipe(lib, 'chili');
    expect(resolveRecipes(seed, lib).chili).toBe(seed.chili);
    expect(isArchived(lib, 'chili')).toBe(false);
    expect(recipeOrigin(seed, lib, 'chili')).toBe('seed');
  });

  it('removing a custom recipe deletes it', () => {
    const lib = removeRecipe(upsertRecipe(emptyLibrary(), recipe({ id: 'soup' })), 'soup');
    expect(resolveRecipes(seed, lib).soup).toBeUndefined();
  });

  it('removing an unknown id is a no-op', () => {
    const lib = upsertRecipe(emptyLibrary(), recipe({ id: 'soup' }));
    expect(removeRecipe(lib, 'nope')).toEqual(lib);
  });
});

describe('archiving', () => {
  it('hides a recipe from the picker but keeps it resolvable', () => {
    const lib = setArchived(emptyLibrary(), 'chili', true);
    expect(plannableRecipes(resolveRecipes(seed, lib), lib).map((r) => r.id)).toEqual(['tacos']);
    expect(resolveRecipes(seed, lib).chili).toBeDefined();
  });

  it('is idempotent and reversible', () => {
    let lib = setArchived(setArchived(emptyLibrary(), 'chili', true), 'chili', true);
    expect(lib.archivedIds).toEqual(['chili']);
    lib = setArchived(lib, 'chili', false);
    expect(lib.archivedIds).toEqual([]);
  });

  it('plannableRecipes sorts by name', () => {
    const lib = upsertRecipe(emptyLibrary(), recipe({ id: 'z', name: 'Apple pie' }));
    expect(plannableRecipes(resolveRecipes(seed, lib), lib).map((r) => r.name)).toEqual(['Apple pie', 'Chili', 'Tacos']);
  });
});

describe('recipeUsage', () => {
  it('counts cook entries for the recipe, including inactive slots', () => {
    const p = plan([cook('chili', 0), cook('chili', 3, 4, 'lunch'), cook('tacos', 2)]);
    expect(recipeUsage(p, 'chili')).toBe(2);
    expect(recipeUsage(p, 'tacos')).toBe(1);
    expect(recipeUsage(p, 'soup')).toBe(0);
  });
});
