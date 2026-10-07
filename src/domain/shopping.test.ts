import { beforeEach, describe, expect, it } from 'vitest';
import { allItems, buildShoppingList, shoppingKey } from './shopping';
import { cook, index, ing, leftover, plan, recipe, resetIds, settings } from './testHelpers';

beforeEach(resetIds);

const chili = recipe({
  id: 'chili',
  name: 'Chili',
  baseServings: 4,
  ingredients: [
    ing('Yellow Onion', 1, 'each', { section: 'produce', prep: 'diced' }),
    ing('ground cumin', 1, 'tbsp', { section: 'spices' }),
    ing('ground beef', 1, 'lb', { section: 'meat' }),
    ing('salt', 1, 'tsp', { section: 'spices' }),
  ],
});
const tacos = recipe({
  id: 'tacos',
  name: 'Tacos',
  baseServings: 4,
  ingredients: [
    ing('yellow onion', 1, 'each', { section: 'produce', prep: 'diced' }),
    ing('ground cumin', 1, 'tsp', { section: 'spices' }),
    ing('garlic', 2, 'clove', { section: 'produce' }),
  ],
});
const R = index(chili, tacos);

describe('buildShoppingList', () => {
  it('merges the same ingredient across recipes, case-insensitively', () => {
    const list = buildShoppingList(plan([cook('chili', 0, 4), cook('tacos', 1, 4)]), R);
    const onion = allItems(list).find((i) => i.name.toLowerCase() === 'yellow onion')!;
    expect(onion.quantity).toEqual({ amount: 2, unit: 'each' });
    expect(onion.sources.map((s) => s.recipeName)).toEqual(['Chili', 'Tacos']);
    expect(onion.unmergedConflict).toBe(false);
  });

  it('normalizes compatible units and picks a display unit', () => {
    const list = buildShoppingList(plan([cook('chili', 0, 4), cook('tacos', 1, 4)]), R);
    const cumin = allItems(list).find((i) => i.name === 'ground cumin')!;
    // 1 tbsp + 1 tsp = 4 tsp = 1 1/3 tbsp; tbsp is the largest contributor's unit.
    expect(cumin.quantity.unit).toBe('tbsp');
    expect(cumin.quantity.amount).toBeCloseTo(4 / 3, 10);
  });

  it('scales quantities by entry servings before merging', () => {
    const list = buildShoppingList(plan([cook('chili', 0, 8), cook('tacos', 1, 2)]), R);
    const beef = allItems(list).find((i) => i.name === 'ground beef')!;
    expect(beef.quantity).toEqual({ amount: 2, unit: 'lb' });
    const onion = allItems(list).find((i) => i.name.toLowerCase() === 'yellow onion')!;
    // 2 + 0.5 onions: you buy whole onions, so the list says 3. Sources keep the exact amounts.
    expect(onion.quantity).toEqual({ amount: 3, unit: 'each' });
    expect(onion.sources.map((s) => s.quantity.amount)).toEqual([2, 0.5]);
  });

  it('rounds count items up but never volume or mass', () => {
    const a = recipe({ id: 'a', baseServings: 3, ingredients: [ing('lime', 1, 'each'), ing('oil', 1, 'tbsp'), ing('beef', 1, 'lb')] });
    const list = buildShoppingList(plan([cook('a', 0, 1)]), index(a));
    const by = Object.fromEntries(allItems(list).map((i) => [i.name, i.quantity]));
    expect(by.lime).toEqual({ amount: 1, unit: 'each' });
    expect(by.oil.amount).toBeCloseTo(1, 10); // 1/3 tbsp = 1 tsp
    expect(by.oil.unit).toBe('tsp');
    expect(by.beef.amount).toBeCloseTo(16 / 3, 10);
    expect(by.beef.unit).toBe('oz');
  });

  it('does not round an exact whole count up by float noise', () => {
    const a = recipe({ id: 'a', baseServings: 3, ingredients: [ing('egg', 1, 'each')] });
    const b = recipe({ id: 'b', baseServings: 3, ingredients: [ing('egg', 2, 'each')] });
    const list = buildShoppingList(plan([cook('a', 0, 1), cook('b', 1, 1)]), index(a, b));
    expect(allItems(list)[0].quantity.amount).toBe(1);
  });

  it('keeps incompatible units separate and flags both', () => {
    const bread = recipe({ id: 'bread', ingredients: [ing('flour', 2, 'cup')] });
    const cake = recipe({ id: 'cake', ingredients: [ing('flour', 300, 'g')] });
    const list = buildShoppingList(plan([cook('bread', 0), cook('cake', 1)]), index(bread, cake));
    const flours = allItems(list).filter((i) => i.name === 'flour');
    expect(flours).toHaveLength(2);
    expect(flours.every((f) => f.unmergedConflict)).toBe(true);
    expect(flours.map((f) => f.quantity.unit).sort()).toEqual(['cup', 'g']);
    expect(list.warnings.map((w) => w.code)).toEqual(['unit-conflict']);
  });

  it('keeps different count units separate (cloves vs heads)', () => {
    const a = recipe({ id: 'a', ingredients: [ing('garlic', 3, 'clove')] });
    const b = recipe({ id: 'b', ingredients: [ing('garlic', 1, 'head')] });
    const list = buildShoppingList(plan([cook('a', 0), cook('b', 1)]), index(a, b));
    expect(allItems(list).filter((i) => i.name === 'garlic')).toHaveLength(2);
    expect(list.warnings[0].code).toBe('unit-conflict');
  });

  it('never merges weight oz with fluid oz', () => {
    const a = recipe({ id: 'a', ingredients: [ing('cream', 8, 'oz')] });
    const b = recipe({ id: 'b', ingredients: [ing('cream', 8, 'floz')] });
    const list = buildShoppingList(plan([cook('a', 0), cook('b', 1)]), index(a, b));
    expect(allItems(list)).toHaveLength(2);
  });

  it('merges across measurement systems and displays in the larger contributor system', () => {
    const a = recipe({ id: 'a', ingredients: [ing('milk', 1, 'cup')] });
    const b = recipe({ id: 'b', ingredients: [ing('milk', 250, 'ml')] });
    const list = buildShoppingList(plan([cook('a', 0), cook('b', 1)]), index(a, b));
    const milk = allItems(list)[0];
    expect(milk.quantity.unit).toBe('ml'); // 250 ml > 236.6 ml, so metric wins
    expect(milk.quantity.amount).toBeCloseTo(486.588, 2);
  });

  it('bumps small units up the ladder after merging', () => {
    const a = recipe({ id: 'a', ingredients: [ing('oil', 8, 'tbsp')] });
    const b = recipe({ id: 'b', ingredients: [ing('oil', 8, 'tbsp')] });
    const list = buildShoppingList(plan([cook('a', 0), cook('b', 1)]), index(a, b));
    expect(allItems(list)[0].quantity).toEqual({ amount: expect.closeTo(1, 10), unit: 'cup' });
  });

  it('groups by section in store-walking order and sorts items by name', () => {
    const list = buildShoppingList(plan([cook('chili', 0, 4), cook('tacos', 1, 4)]), R);
    expect(list.sections.map((s) => s.section)).toEqual(['produce', 'meat', 'spices']);
    expect(list.sections[0].items.map((i) => i.name)).toEqual(['garlic', 'Yellow Onion']);
  });

  it('excludes pantry staples case-insensitively and reports them', () => {
    const s = settings({ pantryStaples: ['Salt', 'Ground Cumin'] });
    const list = buildShoppingList(plan([cook('chili', 0, 4), cook('tacos', 1, 4)], s), R);
    const names = allItems(list).map((i) => i.name.toLowerCase());
    expect(names).not.toContain('salt');
    expect(names).not.toContain('ground cumin');
    expect(list.excludedStaples).toEqual(['ground cumin', 'salt']);
  });

  it('ignores leftovers, inactive slots, unknown recipes and invalid servings', () => {
    const c = cook('chili', 0, 4);
    const p = plan([
      c,
      leftover(c.id, 1, 2),
      cook('tacos', 2, 4, 'lunch'),
      cook('nope', 3),
      cook('tacos', 4, 0),
    ]);
    const list = buildShoppingList(p, R);
    expect(allItems(list).map((i) => i.name)).toEqual(['Yellow Onion', 'ground beef', 'ground cumin', 'salt']);
    expect(allItems(list).find((i) => i.name === 'Yellow Onion')!.quantity.amount).toBe(1);
  });

  it('uses the first section seen on a conflict and warns once', () => {
    const a = recipe({ id: 'a', ingredients: [ing('tomatoes', 1, 'each', { section: 'produce' })] });
    const b = recipe({ id: 'b', ingredients: [ing('tomatoes', 1, 'each', { section: 'canned' })] });
    const c = recipe({ id: 'c', ingredients: [ing('tomatoes', 1, 'each', { section: 'canned' })] });
    const list = buildShoppingList(plan([cook('a', 0), cook('b', 1), cook('c', 2)]), index(a, b, c));
    expect(list.sections[0].section).toBe('produce');
    expect(allItems(list)[0].quantity.amount).toBe(3);
    expect(list.warnings.filter((w) => w.code === 'section-conflict')).toHaveLength(1);
  });

  it('returns an empty list for an empty plan', () => {
    const list = buildShoppingList(plan([]), R);
    expect(list.sections).toEqual([]);
    expect(list.warnings).toEqual([]);
    expect(list.excludedStaples).toEqual([]);
  });

  it('produces stable keys independent of order', () => {
    expect(shoppingKey('flour', 'cup')).toBe('flour|volume');
    expect(shoppingKey('flour', 'ml')).toBe('flour|volume');
    expect(shoppingKey('flour', 'g')).toBe('flour|mass');
    expect(shoppingKey('garlic', 'clove')).toBe('garlic|clove');
    const a = buildShoppingList(plan([cook('chili', 0, 4), cook('tacos', 1, 4)]), R);
    const b = buildShoppingList(plan([cook('tacos', 1, 4), cook('chili', 0, 4)]), R);
    expect(allItems(a).map((i) => i.key)).toEqual(allItems(b).map((i) => i.key));
  });
});
