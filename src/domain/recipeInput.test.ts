import { describe, expect, it } from 'vitest';
import { parseRecipeInput, RECIPE_LIMITS } from './recipeInput';

const valid = {
  name: '  Lemon   Pasta ',
  baseServings: 4,
  activeMinutes: 15,
  totalMinutes: 25,
  ingredients: [
    { name: 'spaghetti', quantity: { amount: 1, unit: 'lb' }, section: 'dry-goods', prep: '' },
    { name: ' Lemon ', quantity: { amount: 2, unit: 'each' }, section: 'produce', prep: ' zested ' },
  ],
  advancePrep: [{ description: 'Zest lemons', leadDays: 1, activeMinutes: 5 }],
};

describe('parseRecipeInput', () => {
  it('accepts a valid recipe and normalises text', () => {
    const r = parseRecipeInput(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.name).toBe('Lemon Pasta');
    expect(r.recipe.ingredients[0]).toEqual({ name: 'spaghetti', quantity: { amount: 1, unit: 'lb' }, section: 'dry-goods' });
    expect(r.recipe.ingredients[1]).toEqual({ name: 'Lemon', quantity: { amount: 2, unit: 'each' }, section: 'produce', prep: 'zested' });
    expect(r.recipe.advancePrep).toEqual([{ id: 'step-1', description: 'Zest lemons', leadDays: 1, activeMinutes: 5 }]);
  });

  it('keeps provided step ids and rejects duplicates', () => {
    const ok = parseRecipeInput({ ...valid, advancePrep: [{ ...valid.advancePrep[0], id: 'zest' }] });
    expect(ok.ok && ok.recipe.advancePrep[0].id).toBe('zest');
    const dup = parseRecipeInput({ ...valid, advancePrep: [{ ...valid.advancePrep[0], id: 'a' }, { ...valid.advancePrep[0], id: 'a' }] });
    expect(dup.ok).toBe(false);
    expect(!dup.ok && dup.errors.join()).toContain('duplicate');
  });

  it('drops unknown fields and never keeps a client-supplied id', () => {
    const r = parseRecipeInput({ ...valid, id: 'evil', extra: 1 });
    expect(r.ok && Object.keys(r.recipe).sort()).toEqual(['activeMinutes', 'advancePrep', 'baseServings', 'ingredients', 'name', 'totalMinutes']);
  });

  it('treats missing advancePrep as empty', () => {
    const { advancePrep: _omit, ...noPrep } = valid;
    const r = parseRecipeInput(noPrep);
    expect(r.ok && r.recipe.advancePrep).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(parseRecipeInput(null).ok).toBe(false);
    expect(parseRecipeInput('x').ok).toBe(false);
    expect(parseRecipeInput([]).ok).toBe(false);
  });

  it('collects every error at once with field labels', () => {
    const r = parseRecipeInput({
      name: '',
      baseServings: 0,
      activeMinutes: 30,
      totalMinutes: 10,
      ingredients: [{ name: '', quantity: { amount: 0, unit: 'bogus' }, section: 'nope' }],
      advancePrep: [{ description: '', leadDays: 0, activeMinutes: -1 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      'Name is required.',
      `Servings must be a whole number from 1 to ${RECIPE_LIMITS.maxServings}.`,
      'Total minutes cannot be less than hands-on minutes.',
      'Ingredient 1: name is required.',
      'Ingredient 1: amount must be a number greater than 0.',
      'Ingredient 1: pick a unit.',
      'Ingredient 1: pick a store section.',
      'Advance prep step 1: description is required.',
      `Advance prep step 1: days before must be a whole number from 1 to ${RECIPE_LIMITS.maxLeadDays}.`,
      'Advance prep step 1: hands-on minutes must be a whole number of 0 or more.',
    ]);
  });

  it('requires at least one ingredient and whole-number servings', () => {
    expect(parseRecipeInput({ ...valid, ingredients: [] }).ok).toBe(false);
    expect(parseRecipeInput({ ...valid, baseServings: 2.5 }).ok).toBe(false);
    expect(parseRecipeInput({ ...valid, baseServings: '4' }).ok).toBe(false);
  });

  it('rejects strings where numbers are expected and non-finite amounts', () => {
    const r = parseRecipeInput({ ...valid, ingredients: [{ ...valid.ingredients[0], quantity: { amount: Infinity, unit: 'lb' } }] });
    expect(r.ok).toBe(false);
  });

  it('enforces length limits', () => {
    expect(parseRecipeInput({ ...valid, name: 'x'.repeat(RECIPE_LIMITS.nameMaxLength + 1) }).ok).toBe(false);
    expect(parseRecipeInput({ ...valid, ingredients: Array(RECIPE_LIMITS.maxIngredients + 1).fill(valid.ingredients[0]) }).ok).toBe(false);
  });
});
