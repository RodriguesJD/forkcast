import { describe, expect, it } from 'vitest';
import { normalizeIngredientName, scaleFactor, scaleIngredients, validateRecipe } from './recipes';
import { ing, recipe } from './testHelpers';

describe('normalizeIngredientName', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeIngredientName('  Yellow   Onion ')).toBe('yellow onion');
  });

  it('does not strip plurals or synonyms (documented limit)', () => {
    expect(normalizeIngredientName('onions')).not.toBe(normalizeIngredientName('onion'));
    expect(normalizeIngredientName('scallions')).not.toBe(normalizeIngredientName('green onions'));
  });
});

describe('scaleIngredients', () => {
  const r = recipe({
    id: 'r',
    baseServings: 4,
    ingredients: [ing('rice', 2, 'cup', { prep: 'rinsed' }), ing('eggs', 3, 'each')],
  });

  it('scales up by a non-integer factor', () => {
    expect(scaleFactor(r, 6)).toBe(1.5);
    const scaled = scaleIngredients(r, 6);
    expect(scaled[0].quantity).toEqual({ amount: 3, unit: 'cup' });
    expect(scaled[1].quantity).toEqual({ amount: 4.5, unit: 'each' });
  });

  it('scales down', () => {
    expect(scaleIngredients(r, 1)[0].quantity.amount).toBe(0.5);
  });

  it('keeps names, sections and prep', () => {
    const scaled = scaleIngredients(r, 8);
    expect(scaled[0]).toMatchObject({ name: 'rice', section: 'other', prep: 'rinsed' });
  });

  it('is an identity at base servings', () => {
    expect(scaleIngredients(r, 4)).toEqual(r.ingredients);
  });

  it('does not mutate the recipe', () => {
    scaleIngredients(r, 8);
    expect(r.ingredients[0].quantity.amount).toBe(2);
  });

  it('rejects zero or negative servings', () => {
    expect(() => scaleIngredients(r, 0)).toThrow();
    expect(() => scaleIngredients(r, -2)).toThrow();
    expect(() => scaleIngredients(r, Number.NaN)).toThrow();
  });

  it('rejects a recipe with zero base servings', () => {
    expect(() => scaleIngredients(recipe({ id: 'bad', baseServings: 0 }), 2)).toThrow();
  });
});

describe('validateRecipe', () => {
  const good = recipe({
    id: 'r',
    name: 'Good',
    baseServings: 4,
    activeMinutes: 20,
    totalMinutes: 30,
    ingredients: [ing('onion', 1, 'each'), ing('salt', 1, 'tsp')],
    advancePrep: [{ id: 's1', description: 'Soak', leadDays: 1, activeMinutes: 5 }],
  });

  it('accepts a well-formed recipe', () => {
    expect(validateRecipe(good)).toEqual([]);
  });

  it('accepts zero hands-on minutes', () => {
    expect(validateRecipe({ ...good, activeMinutes: 0 })).toEqual([]);
  });

  it('reports every header problem with a code', () => {
    const codes = validateRecipe({
      ...good,
      name: '   ',
      baseServings: 0,
      activeMinutes: 2.5,
      totalMinutes: 0,
      ingredients: [],
    }).map((p) => p.code);
    expect(codes).toEqual([
      'empty-name',
      'invalid-base-servings',
      'invalid-active-minutes',
      'invalid-total-minutes',
      'no-ingredients',
    ]);
  });

  it('rejects total minutes below hands-on minutes', () => {
    const problems = validateRecipe({ ...good, activeMinutes: 40, totalMinutes: 30 });
    expect(problems).toHaveLength(1);
    expect(problems[0].code).toBe('invalid-total-minutes');
  });

  it('rejects NaN numbers (what an empty form field parses to)', () => {
    const codes = validateRecipe({ ...good, baseServings: NaN, totalMinutes: NaN }).map((p) => p.code);
    expect(codes).toEqual(['invalid-base-servings', 'invalid-total-minutes']);
  });

  it('points at the offending ingredient', () => {
    const problems = validateRecipe({
      ...good,
      ingredients: [
        ing('onion', 1, 'each'),
        ing(' ', 0, 'bogus' as never, { section: 'aisle 9' as never }),
      ],
    });
    expect(problems.map((p) => [p.code, p.ingredientIndex])).toEqual([
      ['ingredient-empty-name', 1],
      ['ingredient-invalid-amount', 1],
      ['ingredient-invalid-unit', 1],
      ['ingredient-invalid-section', 1],
    ]);
    expect(problems[0].message).toContain('Ingredient 2');
  });

  it('points at the offending prep step and catches duplicate ids', () => {
    const problems = validateRecipe({
      ...good,
      advancePrep: [
        { id: 'a', description: 'Thaw', leadDays: 1, activeMinutes: 2 },
        { id: 'a', description: '', leadDays: 0, activeMinutes: -1 },
      ],
    });
    expect(problems.map((p) => [p.code, p.stepIndex])).toEqual([
      ['prep-empty-description', 1],
      ['prep-invalid-lead-days', 1],
      ['prep-invalid-minutes', 1],
      ['prep-duplicate-id', 1],
    ]);
  });
});
