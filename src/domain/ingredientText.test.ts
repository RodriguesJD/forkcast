import { describe, expect, it } from 'vitest';
import { guessSection, parseIngredientLine, parseIngredientLines } from './ingredientText';

describe('parseIngredientLine', () => {
  const cases: [string, { name: string; amount: number; unit: string; prep?: string; section?: string }][] = [
    ['2 cups all-purpose flour, sifted', { name: 'all-purpose flour', amount: 2, unit: 'cup', prep: 'sifted', section: 'dry-goods' }],
    ['1 ½ cups milk', { name: 'milk', amount: 1.5, unit: 'cup', section: 'dairy' }],
    ['1 1/2 lbs chicken thighs', { name: 'chicken thighs', amount: 1.5, unit: 'lb', section: 'meat' }],
    ['½ teaspoon salt', { name: 'salt', amount: 0.5, unit: 'tsp', section: 'spices' }],
    ['3 cloves garlic, minced', { name: 'garlic', amount: 3, unit: 'clove', prep: 'minced', section: 'produce' }],
    ['2 (14 oz) cans diced tomatoes', { name: 'diced tomatoes', amount: 2, unit: 'can', section: 'canned' }],
    ['1 large yellow onion, diced', { name: 'large yellow onion', amount: 1, unit: 'each', prep: 'diced', section: 'produce' }],
    ['Salt and pepper to taste', { name: 'Salt and pepper', amount: 1, unit: 'pinch', section: 'spices' }],
    ['4 oz. cheddar cheese', { name: 'cheddar cheese', amount: 4, unit: 'oz', section: 'dairy' }],
    ['8 fl oz heavy cream', { name: 'heavy cream', amount: 8, unit: 'floz', section: 'dairy' }],
    ['2-3 tbsp olive oil', { name: 'olive oil', amount: 2, unit: 'tbsp', section: 'dry-goods' }],
    ['250 g spaghetti', { name: 'spaghetti', amount: 250, unit: 'g', section: 'dry-goods' }],
    ['a pinch of nutmeg', { name: 'nutmeg', amount: 1, unit: 'pinch', section: 'spices' }],
    ['- 1 lime', { name: 'lime', amount: 1, unit: 'each', section: 'produce' }],
    ['Fresh basil leaves', { name: 'Fresh basil leaves', amount: 1, unit: 'each', section: 'produce' }],
    ['1 cup of rice', { name: 'rice', amount: 1, unit: 'cup', section: 'dry-goods' }],
    ['1 lb shrimp, peeled and deveined', { name: 'shrimp', amount: 1, unit: 'lb', prep: 'peeled and deveined', section: 'seafood' }],
  ];
  for (const [line, expected] of cases) {
    it(`reads "${line}"`, () => {
      const ing = parseIngredientLine(line);
      expect(ing).not.toBeNull();
      expect(ing!.name).toBe(expected.name);
      expect(ing!.quantity.amount).toBeCloseTo(expected.amount, 5);
      expect(ing!.quantity.unit).toBe(expected.unit);
      expect(ing!.prep).toBe(expected.prep);
      if (expected.section) expect(ing!.section).toBe(expected.section);
    });
  }

  it('returns null for blank lines and keeps unreadable lines whole', () => {
    expect(parseIngredientLine('   ')).toBeNull();
    const odd = parseIngredientLine('some leftover roast');
    expect(odd).toMatchObject({ name: 'some leftover roast', quantity: { amount: 1, unit: 'each' } });
  });

  it('parses several lines', () => {
    expect(parseIngredientLines('2 eggs\n\n1 cup milk\n')).toHaveLength(2);
  });
});

describe('guessSection', () => {
  it('tells black pepper from bell pepper and garlic cloves from clove spice', () => {
    expect(guessSection('black pepper')).toBe('spices');
    expect(guessSection('red bell pepper')).toBe('produce');
    expect(guessSection('garlic')).toBe('produce');
    expect(guessSection('ground cloves')).toBe('spices');
    expect(guessSection('fresh thyme')).toBe('produce');
    expect(guessSection('dried thyme')).toBe('spices');
    expect(guessSection('chicken stock')).toBe('canned');
    expect(guessSection('mystery item')).toBe('other');
  });
});
