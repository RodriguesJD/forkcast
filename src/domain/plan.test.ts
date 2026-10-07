import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSlot,
  compareSlots,
  effectiveCookEntries,
  isSlotActive,
  removeEntry,
  setEntry,
  slotOrdinal,
  slotSequence,
  validatePlan,
  weekdayFor,
  weekdayName,
} from './plan';
import { cook, index, leftover, plan, recipe, resetIds, settings } from './testHelpers';
import type { Warning } from './types';

const codes = (w: Warning[]) => w.map((x) => x.code).sort();
const R = index(recipe({ id: 'chili', baseServings: 6 }), recipe({ id: 'tacos' }));

beforeEach(resetIds);

describe('week geometry', () => {
  it('maps day indexes to weekdays from the start day', () => {
    const s = settings({ startDay: 1 });
    expect(weekdayFor(s, 0)).toBe(1);
    expect(weekdayFor(s, 6)).toBe(0);
    expect(weekdayName(s, 6)).toBe('Sunday');
    expect(weekdayName(settings({ startDay: 6 }), 1)).toBe('Sunday');
  });

  it('orders slots breakfast < lunch < dinner within a day, then by day', () => {
    expect(slotOrdinal({ dayIndex: 0, slot: 'dinner' })).toBeLessThan(
      slotOrdinal({ dayIndex: 1, slot: 'breakfast' }),
    );
    expect(compareSlots({ dayIndex: 2, slot: 'lunch' }, { dayIndex: 2, slot: 'breakfast' })).toBeGreaterThan(0);
    expect(compareSlots({ dayIndex: 2, slot: 'lunch' }, { dayIndex: 2, slot: 'lunch' })).toBe(0);
  });

  it('lists only active slots in week order', () => {
    expect(slotSequence(settings())).toHaveLength(7);
    const all = slotSequence(settings({ activeSlots: ['dinner', 'breakfast', 'lunch'] }));
    expect(all).toHaveLength(21);
    expect(all[0]).toEqual({ dayIndex: 0, slot: 'breakfast' });
    expect(all[2]).toEqual({ dayIndex: 0, slot: 'dinner' });
  });

  it('treats out-of-week days as inactive', () => {
    expect(isSlotActive(settings(), { dayIndex: 7, slot: 'dinner' })).toBe(false);
    expect(isSlotActive(settings(), { dayIndex: -1, slot: 'dinner' })).toBe(false);
    expect(isSlotActive(settings(), { dayIndex: 3, slot: 'lunch' })).toBe(false);
    expect(isSlotActive(settings(), { dayIndex: 3, slot: 'dinner' })).toBe(true);
  });
});

describe('validatePlan', () => {
  it('passes a well-formed plan with leftovers', () => {
    const chili = cook('chili', 1, 6);
    const p = plan([chili, leftover(chili.id, 2, 2), leftover(chili.id, 3, 2)]);
    expect(validatePlan(p, R)).toEqual([]);
  });

  it('flags unknown recipes', () => {
    expect(codes(validatePlan(plan([cook('nope', 0)]), R))).toEqual(['unknown-recipe']);
  });

  it('flags non-positive or fractional servings', () => {
    expect(codes(validatePlan(plan([cook('chili', 0, 0)]), R))).toEqual(['invalid-servings']);
    expect(codes(validatePlan(plan([cook('chili', 0, 1.5)]), R))).toEqual(['invalid-servings']);
    expect(codes(validatePlan(plan([cook('chili', 0, -2)]), R))).toEqual(['invalid-servings']);
  });

  it('flags two entries in one slot', () => {
    const w = validatePlan(plan([cook('chili', 0), cook('tacos', 0)]), R);
    expect(codes(w)).toEqual(['duplicate-slot']);
  });

  it('flags entries in inactive slots and out-of-week days', () => {
    const w = validatePlan(plan([cook('chili', 0, 2, 'lunch'), cook('tacos', 9)]), R);
    expect(codes(w)).toEqual(['inactive-slot', 'inactive-slot']);
  });

  it('flags a leftover whose source is missing', () => {
    expect(codes(validatePlan(plan([leftover('ghost', 3)]), R))).toEqual(['leftover-missing-source']);
  });

  it('flags a leftover chained to another leftover', () => {
    const chili = cook('chili', 0, 6);
    const l1 = leftover(chili.id, 1);
    const w = validatePlan(plan([chili, l1, leftover(l1.id, 2)]), R);
    expect(codes(w)).toEqual(['leftover-source-not-cook']);
  });

  it('flags a leftover at or before its source', () => {
    const chili = cook('chili', 3, 6);
    expect(codes(validatePlan(plan([chili, leftover(chili.id, 2)]), R))).toEqual(['leftover-before-source']);
    const lunchChili = cook('chili', 3, 6, 'lunch');
    const s = settings({ activeSlots: ['lunch', 'dinner'] });
    expect(codes(validatePlan(plan([lunchChili, leftover(lunchChili.id, 3, 2, 'lunch', 'dup')], s), R))).toEqual([
      'duplicate-slot',
      'leftover-before-source',
    ]);
    expect(validatePlan(plan([lunchChili, leftover(lunchChili.id, 3, 2, 'dinner')], s), R)).toEqual([]);
  });

  it('warns when more portions are planned than cooked', () => {
    const chili = cook('chili', 0, 4);
    const w = validatePlan(plan([chili, leftover(chili.id, 1, 2), leftover(chili.id, 2, 2)]), R);
    expect(codes(w)).toEqual(['leftover-over-allocated']);
    expect(w[0].message).toContain('6');
    expect(w[0].entryId).toBe(chili.id);
  });

  it('counts household size at the cook slot', () => {
    const chili = cook('chili', 0, 2);
    const s = settings({ householdSize: 3 });
    expect(codes(validatePlan(plan([chili], s), R))).toEqual(['leftover-over-allocated']);
  });
});

describe('effectiveCookEntries', () => {
  it('drops leftovers, inactive slots, unknown recipes and bad servings, sorted by slot', () => {
    const late = cook('tacos', 5);
    const early = cook('chili', 1, 6);
    const p = plan([
      late,
      leftover(early.id, 2),
      cook('chili', 3, 2, 'lunch'),
      cook('missing', 4),
      cook('tacos', 6, 0),
      early,
    ]);
    expect(effectiveCookEntries(p, R).map((e) => e.id)).toEqual([early.id, late.id]);
  });
});

describe('plan edits', () => {
  it('setEntry adds, replaces by id, and displaces whatever was in the slot', () => {
    const chili = cook('chili', 0, 6);
    const l = leftover(chili.id, 1);
    let p = plan([chili, l]);
    p = setEntry(p, { ...chili, servings: 8 });
    expect(p.entries).toHaveLength(2);
    expect(p.entries[0]).toMatchObject({ servings: 8 });

    p = setEntry(p, cook('tacos', 0, 2, 'dinner', 'new'));
    expect(p.entries.map((e) => e.id)).toEqual(['new']);
  });

  it('removeEntry cascades to dependent leftovers', () => {
    const chili = cook('chili', 0, 6);
    const other = cook('tacos', 4);
    const p = plan([chili, leftover(chili.id, 1), leftover(chili.id, 2), other]);
    expect(removeEntry(p, chili.id).entries).toEqual([other]);
  });

  it('clearSlot is a no-op on empty slots', () => {
    const p = plan([cook('chili', 0)]);
    expect(clearSlot(p, { dayIndex: 3, slot: 'dinner' })).toBe(p);
    expect(clearSlot(p, { dayIndex: 0, slot: 'dinner' }).entries).toEqual([]);
  });
});
