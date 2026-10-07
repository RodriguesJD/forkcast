import { describe, expect, it } from 'vitest';
import { normalizeIngredientName, scaleFactor, scaleIngredients } from './recipes';
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
