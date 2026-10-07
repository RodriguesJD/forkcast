import { describe, expect, it } from 'vitest';
import { parseRecipes, serializeRecipes, validateRecipe } from './recipeImport';
import { SEED_RECIPES } from '../data/seedRecipes';
import { recipe, ing } from './testHelpers';
import type { Warning } from './types';

const codes = (w: Warning[]) => w.map((x) => x.code);
const good = recipe({ id: 'ok', name: 'OK', ingredients: [ing('rice', 1, 'cup', { section: 'dry-goods' })] });

describe('validateRecipe', () => {
  it('accepts a valid recipe and every seed recipe', () => {
    expect(validateRecipe(good)).toEqual([]);
    for (const r of SEED_RECIPES) expect(validateRecipe(r), r.id).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(codes(validateRecipe(null))).toEqual(['recipe-not-object']);
    expect(codes(validateRecipe('x'))).toEqual(['recipe-not-object']);
    expect(codes(validateRecipe([]))).toEqual(['recipe-not-object']);
  });

  it('requires id and name', () => {
    expect(codes(validateRecipe({ ...good, id: '' }))).toContain('recipe-missing-id');
    expect(codes(validateRecipe({ ...good, name: '  ' }))).toContain('recipe-missing-name');
  });

  it('checks servings and times', () => {
    expect(codes(validateRecipe({ ...good, baseServings: 0 }))).toContain('recipe-invalid-servings');
    expect(codes(validateRecipe({ ...good, activeMinutes: -1 }))).toContain('recipe-invalid-time');
    expect(codes(validateRecipe({ ...good, totalMinutes: 'long' }))).toContain('recipe-invalid-time');
    expect(codes(validateRecipe({ ...good, activeMinutes: 30, totalMinutes: 20 }))).toEqual(['recipe-invalid-time']);
  });

  it('requires at least one ingredient', () => {
    expect(codes(validateRecipe({ ...good, ingredients: [] }))).toEqual(['recipe-no-ingredients']);
    expect(codes(validateRecipe({ ...good, ingredients: 'rice' }))).toEqual(['recipe-no-ingredients']);
  });

  it('checks each ingredient', () => {
    const bad = {
      ...good,
      ingredients: [
        'rice',
        { name: '', quantity: { amount: 1, unit: 'cup' }, section: 'produce' },
        { name: 'flour', quantity: { amount: 0, unit: 'cups' }, section: 'aisle 9' },
        { name: 'salt', section: 'spices' },
        { name: 'onion', quantity: { amount: 1, unit: 'each' }, section: 'produce', prep: 3 },
      ],
    };
    const w = validateRecipe(bad);
    expect(codes(w)).toEqual([
      'recipe-invalid-ingredient',
      'recipe-invalid-ingredient',
      'recipe-invalid-quantity',
      'recipe-invalid-unit',
      'recipe-invalid-section',
      'recipe-invalid-quantity',
      'recipe-invalid-ingredient',
    ]);
    expect(w[3].message).toContain('"cups"');
  });

  it('checks advance prep steps', () => {
    const w = validateRecipe({
      ...good,
      advancePrep: [
        { id: 'a', description: 'Soak', leadDays: 0, activeMinutes: 5 },
        { id: 'b', description: 'Thaw', leadDays: 1.5, activeMinutes: 2 },
        { id: '', description: '', leadDays: 1, activeMinutes: -1 },
        'thaw',
      ],
    });
    expect(w.every((x) => x.code === 'recipe-invalid-prep-step')).toBe(true);
    expect(w).toHaveLength(6);
    expect(codes(validateRecipe({ ...good, advancePrep: 'none' }))).toEqual(['recipe-invalid-prep-step']);
  });

  it('allows advancePrep to be omitted', () => {
    const { advancePrep: _omit, ...withoutPrep } = good;
    expect(validateRecipe(withoutPrep)).toEqual([]);
  });

  it('tags warnings with the recipe id when it has one', () => {
    expect(validateRecipe({ ...good, baseServings: -1 })[0].recipeId).toBe('ok');
    expect(validateRecipe({ ...good, id: 7 }, 'recipe 3')[0].recipeId).toBeUndefined();
    expect(validateRecipe({ ...good, id: 7 }, 'recipe 3')[0].message).toMatch(/^recipe 3:/);
  });
});

describe('parseRecipes', () => {
  it('round-trips the seed recipes through serialize', () => {
    const result = parseRecipes(serializeRecipes(SEED_RECIPES));
    expect(result.warnings).toEqual([]);
    expect(result.recipes).toEqual(SEED_RECIPES);
  });

  it('reports invalid JSON', () => {
    expect(codes(parseRecipes('{not json').warnings)).toEqual(['recipe-not-json']);
  });

  it('requires an array', () => {
    expect(codes(parseRecipes('{"id":"x"}').warnings)).toEqual(['recipe-not-array']);
  });

  it('is all-or-nothing', () => {
    const text = JSON.stringify([good, { ...good, id: 'bad', baseServings: 0 }]);
    const result = parseRecipes(text);
    expect(result.recipes).toEqual([]);
    expect(codes(result.warnings)).toEqual(['recipe-invalid-servings']);
    expect(result.warnings[0].recipeId).toBe('bad');
  });

  it('rejects duplicate ids', () => {
    const result = parseRecipes(JSON.stringify([good, good]));
    expect(codes(result.warnings)).toEqual(['recipe-duplicate-id']);
  });

  it('fills in a missing advancePrep', () => {
    const { advancePrep: _omit, ...withoutPrep } = good;
    const result = parseRecipes(JSON.stringify([withoutPrep]));
    expect(result.recipes[0].advancePrep).toEqual([]);
  });

  it('accepts an empty array', () => {
    expect(parseRecipes('[]')).toEqual({ recipes: [], warnings: [] });
  });
});
