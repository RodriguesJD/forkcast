import { describe, expect, it } from 'vitest';
import { applyShoppingEdits, buildShoppingList, hiddenShoppingItems } from './shopping';
import { parseShoppingEditsInput } from './planInput';
import { ing, recipe, settings } from './testHelpers';

describe('applyShoppingEdits', () => {
  const recipes = { r: recipe({ id: 'r', ingredients: [ing('milk', 1, 'cup', { section: 'dairy' }), ing('onion', 1, 'each', { section: 'produce' })] }) };
  const plan = { settings: settings(), entries: [{ kind: 'cook' as const, id: 'e', slot: { dayIndex: 0, slot: 'dinner' as const }, recipeId: 'r', servings: 4 }] };
  const list = buildShoppingList(plan, recipes);

  it('hides removed items and adds extras in store order', () => {
    const edits = {
      extras: [{ id: 'x1', name: 'paper towels', quantity: { amount: 1, unit: 'each' as const }, section: 'other' as const }],
      removed: ['milk|volume'],
    };
    const edited = applyShoppingEdits(list, edits);
    expect(edited.sections.map((s) => s.section)).toEqual(['produce', 'other']);
    expect(edited.sections[1].items[0]).toMatchObject({ key: 'extra:x1', name: 'paper towels', sources: [] });
    expect(hiddenShoppingItems(list, edits).map((i) => i.name)).toEqual(['milk']);
    // the generated list is untouched
    expect(list.sections.flatMap((s) => s.items).map((i) => i.name)).toEqual(['onion', 'milk']);
  });

  it('is a no-op for empty edits', () => {
    expect(applyShoppingEdits(list, { extras: [], removed: [] })).toEqual(list);
  });
});

describe('parseShoppingEditsInput', () => {
  it('accepts and normalises', () => {
    const r = parseShoppingEditsInput({ extras: [{ id: 'a', name: ' Paper  towels ', quantity: { amount: 2, unit: 'each' }, section: 'other' }], removed: ['k', 'k'] });
    expect(r.ok && r.edits).toEqual({ extras: [{ id: 'a', name: 'Paper towels', quantity: { amount: 2, unit: 'each' }, section: 'other' }], removed: ['k'] });
  });
  it('rejects bad shapes', () => {
    expect(parseShoppingEditsInput({ extras: [{ id: 'a', name: '', quantity: { amount: 1, unit: 'each' }, section: 'other' }], removed: [] }).ok).toBe(false);
    expect(parseShoppingEditsInput({ extras: [{ id: 'a', name: 'x', quantity: { amount: 0, unit: 'each' }, section: 'other' }], removed: [] }).ok).toBe(false);
    expect(parseShoppingEditsInput({ extras: [{ id: 'a', name: 'x', quantity: { amount: 1, unit: 'bogus' }, section: 'other' }], removed: [] }).ok).toBe(false);
    expect(parseShoppingEditsInput({ extras: [], removed: [1] }).ok).toBe(false);
    expect(parseShoppingEditsInput(null).ok).toBe(false);
  });
});
