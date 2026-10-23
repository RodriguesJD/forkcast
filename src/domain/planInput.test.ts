import { describe, expect, it } from 'vitest';
import { parseCheckedInput, parsePlanInput } from './planInput';
import { defaultSettings } from './defaults';

describe('parsePlanInput', () => {
  const plan = {
    settings: { ...defaultSettings(), activeSlots: ['dinner', 'lunch', 'dinner'], pantryStaples: [' salt ', ''] },
    entries: [
      { kind: 'cook', id: 'a', slot: { dayIndex: 0, slot: 'dinner' }, recipeId: 'chili', servings: 6 },
      { kind: 'leftover', id: 'b', slot: { dayIndex: 1, slot: 'lunch' }, sourceEntryId: 'a', servings: 2 },
    ],
  };

  it('accepts a plan, de-duplicates slots and trims staples', () => {
    const r = parsePlanInput(plan);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.settings.activeSlots).toEqual(['dinner', 'lunch']);
    expect(r.plan.settings.pantryStaples).toEqual(['salt']);
    expect(r.plan.entries).toEqual(plan.entries);
  });

  it('fills missing settings fields from defaults', () => {
    const r = parsePlanInput({ settings: { householdSize: 3 }, entries: [] });
    expect(r.ok && r.plan.settings).toEqual({ ...defaultSettings(), householdSize: 3 });
  });

  it('keeps entries validatePlan would merely warn about', () => {
    const r = parsePlanInput({ settings: {}, entries: [{ ...plan.entries[0], servings: 0, recipeId: 'gone' }] });
    expect(r.ok).toBe(true);
  });

  it('rejects malformed entries, duplicate ids and bad settings', () => {
    expect(parsePlanInput({ settings: {}, entries: [{ kind: 'cook', id: 'a', slot: { dayIndex: 0, slot: 'brunch' }, recipeId: 'x', servings: 1 }] }).ok).toBe(false);
    expect(parsePlanInput({ settings: {}, entries: [plan.entries[0], plan.entries[0]] }).ok).toBe(false);
    expect(parsePlanInput({ settings: { startDay: 7 }, entries: [] }).ok).toBe(false);
    expect(parsePlanInput({ settings: { availableMinutesPerDay: [1, 2] }, entries: [] }).ok).toBe(false);
    expect(parsePlanInput({ settings: {}, entries: 'nope' }).ok).toBe(false);
    expect(parsePlanInput(null).ok).toBe(false);
  });
});

describe('parseCheckedInput', () => {
  it('keeps only true values', () => {
    expect(parseCheckedInput({ a: true, b: false })).toEqual({ a: true });
  });
  it('rejects non-boolean values and non-objects', () => {
    expect(parseCheckedInput({ a: 1 })).toBeNull();
    expect(parseCheckedInput([])).toBeNull();
    expect(parseCheckedInput(null)).toBeNull();
  });
});
