import { beforeEach, describe, expect, it } from 'vitest';
import { BATCH_PREP_MINUTES_PER_ITEM, buildSchedule, suggestBatchPrep } from './schedule';
import { cook, index, ing, leftover, plan, recipe, resetIds, settings } from './testHelpers';

beforeEach(resetIds);

const tacos = recipe({
  id: 'tacos',
  name: 'Tacos',
  activeMinutes: 30,
  totalMinutes: 40,
  advancePrep: [{ id: 'marinate', description: 'Marinate chicken', leadDays: 1, activeMinutes: 10 }],
  ingredients: [ing('onion', 1, 'each', { prep: 'diced' }), ing('garlic', 2, 'clove', { prep: 'minced' })],
});
const chili = recipe({
  id: 'chili',
  name: 'Chili',
  activeMinutes: 25,
  totalMinutes: 60,
  ingredients: [ing('onion', 1, 'each', { prep: 'diced' }), ing('garlic', 3, 'clove', { prep: 'minced' })],
});
const roast = recipe({
  id: 'roast',
  name: 'Roast',
  activeMinutes: 20,
  totalMinutes: 480,
  advancePrep: [{ id: 'brine', description: 'Brine', leadDays: 2, activeMinutes: 15 }],
  ingredients: [ing('onion', 1, 'each', { prep: 'sliced' })],
});
const R = index(tacos, chili, roast);

const tasksOn = (s: ReturnType<typeof buildSchedule>, day: number) => s.days[day].tasks;

describe('buildSchedule', () => {
  it('places one cook task per entry on its day, with slot and times', () => {
    const s = buildSchedule(plan([cook('chili', 2, 4)]), R);
    expect(s.days).toHaveLength(7);
    expect(tasksOn(s, 2)).toEqual([
      expect.objectContaining({ kind: 'cook', recipeName: 'Chili', slot: 'dinner', servings: 4, activeMinutes: 25, totalMinutes: 60 }),
    ]);
    expect(s.days.filter((d) => d.tasks.length > 0)).toHaveLength(1);
  });

  it('puts advance prep on the day before for leadDays 1', () => {
    const entry = cook('tacos', 3);
    const s = buildSchedule(plan([entry]), R);
    expect(tasksOn(s, 2)).toEqual([
      expect.objectContaining({ kind: 'advance-prep', description: 'Marinate chicken', forEntryId: entry.id, forDayIndex: 3, forSlot: 'dinner' }),
    ]);
    expect(s.beforeWeek).toEqual([]);
  });

  it('handles leadDays 2', () => {
    const s = buildSchedule(plan([cook('roast', 6)]), R);
    expect(tasksOn(s, 4)[0]).toMatchObject({ kind: 'advance-prep', description: 'Brine' });
    expect(tasksOn(s, 5)).toEqual([]);
  });

  it('moves prep that falls before the week into beforeWeek and warns', () => {
    const entry = cook('tacos', 0);
    const s = buildSchedule(plan([entry]), R);
    expect(s.beforeWeek).toHaveLength(1);
    expect(s.beforeWeek[0]).toMatchObject({ forEntryId: entry.id, description: 'Marinate chicken' });
    expect(s.warnings.map((w) => w.code)).toEqual(['prep-before-week']);
    expect(s.days.flatMap((d) => d.tasks).filter((t) => t.kind === 'advance-prep')).toHaveLength(0);
  });

  it('counts cook and advance-prep active minutes toward the day load', () => {
    // chili on day 1 (25) + tacos marinate for day 2 (10) = 35
    const s = buildSchedule(plan([cook('chili', 1), cook('tacos', 2)]), R);
    expect(s.days[1].loadMinutes).toBe(35);
    expect(s.days[2].loadMinutes).toBe(30);
    expect(s.days[1].overloaded).toBe(false);
  });

  it('warns when a day is overloaded, including by other days\' prep', () => {
    const s = buildSchedule(
      plan([cook('chili', 1), cook('tacos', 2)], settings({ availableMinutesPerDay: [60, 30, 60, 60, 60, 60, 60] })),
      R,
    );
    expect(s.days[1].overloaded).toBe(true);
    expect(s.days[1].availableMinutes).toBe(30);
    expect(s.warnings.filter((w) => w.code === 'day-overloaded').map((w) => w.dayIndex)).toEqual([1]);
  });

  it('never overloads a day with a null limit', () => {
    const s = buildSchedule(
      plan([cook('chili', 1), cook('tacos', 2)], settings({ availableMinutesPerDay: [null, null, null, null, null, null, null] })),
      R,
    );
    expect(s.days.every((d) => !d.overloaded)).toBe(true);
    expect(s.warnings).toEqual([]);
  });

  it('warns when a recipe takes longer start-to-finish than the day allows', () => {
    const s = buildSchedule(plan([cook('roast', 3)]), R);
    const w = s.warnings.find((x) => x.code === 'recipe-too-long')!;
    expect(w).toBeDefined();
    expect(w.dayIndex).toBe(3);
    expect(s.days[3].overloaded).toBe(false); // only 20 active minutes
  });

  it('generates no tasks for leftover slots', () => {
    const c = cook('chili', 0, 6);
    const s = buildSchedule(plan([c, leftover(c.id, 1), leftover(c.id, 2)]), R);
    expect(tasksOn(s, 1)).toEqual([]);
    expect(tasksOn(s, 2)).toEqual([]);
  });

  it('sums two meals on one day and orders tasks cook, prep, batch', () => {
    const sAll = settings({ activeSlots: ['lunch', 'dinner'], batchPrepDayIndex: 1 });
    const s = buildSchedule(
      plan([cook('chili', 1, 2, 'dinner'), cook('tacos', 1, 2, 'lunch'), cook('tacos', 2), cook('chili', 3)], sAll),
      R,
    );
    const kinds = tasksOn(s, 1).map((t) => t.kind);
    expect(kinds).toEqual(['cook', 'cook', 'advance-prep', 'batch-prep', 'batch-prep']);
    const cooks = tasksOn(s, 1).filter((t) => t.kind === 'cook');
    expect(cooks.map((t) => (t.kind === 'cook' ? t.slot : ''))).toEqual(['lunch', 'dinner']);
    expect(s.days[1].loadMinutes).toBe(30 + 25 + 10);
  });

  it('ignores inactive slots and unknown recipes', () => {
    const s = buildSchedule(plan([cook('tacos', 2, 2, 'breakfast'), cook('nope', 3)]), R);
    expect(s.days.every((d) => d.tasks.length === 0)).toBe(true);
  });
});

describe('suggestBatchPrep', () => {
  it('returns nothing when disabled', () => {
    expect(suggestBatchPrep(plan([cook('chili', 1), cook('tacos', 2)]), R)).toEqual([]);
  });

  it('suggests shared name+prep used by two or more entries, on the batch day', () => {
    const c = cook('chili', 1);
    const t = cook('tacos', 3);
    const s = buildSchedule(plan([c, t], settings({ batchPrepDayIndex: 0 })), R);
    const batch = tasksOn(s, 0).filter((x) => x.kind === 'batch-prep');
    expect(batch).toHaveLength(2);
    expect(batch[0]).toMatchObject({
      kind: 'batch-prep',
      optional: true,
      activeMinutes: BATCH_PREP_MINUTES_PER_ITEM,
      coversEntryIds: [c.id, t.id],
    });
    expect(batch[0].description).toBe('Diced onion (2 each total) for Chili, Tacos');
    expect(batch[1].description).toBe('Minced garlic (5 clove total) for Chili, Tacos');
  });

  it('does not count batch prep toward the load', () => {
    const s = buildSchedule(plan([cook('chili', 1), cook('tacos', 3)], settings({ batchPrepDayIndex: 0 })), R);
    expect(s.days[0].loadMinutes).toBe(0);
  });

  it('treats different prep of the same ingredient as different tasks', () => {
    const s = settings({ batchPrepDayIndex: 0 });
    const tasks = suggestBatchPrep(plan([cook('chili', 1), cook('roast', 3)], s), R);
    expect(tasks.filter((t) => t.description.includes('onion'))).toHaveLength(0);
  });

  it('ignores ingredients without a prep verb', () => {
    const a = recipe({ id: 'a', ingredients: [ing('rice', 1, 'cup')] });
    const b = recipe({ id: 'b', ingredients: [ing('rice', 1, 'cup')] });
    expect(suggestBatchPrep(plan([cook('a', 1), cook('b', 2)], settings({ batchPrepDayIndex: 0 })), index(a, b))).toEqual([]);
  });

  it('only covers meals cooked on or after the batch day', () => {
    const early = cook('chili', 0);
    const mid = cook('tacos', 3);
    const late = cook('chili', 5);
    const tasks = suggestBatchPrep(plan([early, mid, late], settings({ batchPrepDayIndex: 3 })), R);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].coversEntryIds).toEqual([mid.id, late.id]);
  });

  it('requires at least two distinct entries', () => {
    expect(suggestBatchPrep(plan([cook('chili', 1)], settings({ batchPrepDayIndex: 0 })), R)).toEqual([]);
  });

  it('reports the total in a display unit after conversion', () => {
    const a = recipe({ id: 'a', name: 'A', ingredients: [ing('ginger', 2, 'tbsp', { prep: 'minced' })] });
    const b = recipe({ id: 'b', name: 'B', ingredients: [ing('ginger', 1, 'tsp', { prep: 'minced' })] });
    const [task] = suggestBatchPrep(plan([cook('a', 1), cook('b', 2)], settings({ batchPrepDayIndex: 0 })), index(a, b));
    expect(task.description).toBe('Minced ginger (2.33 tbsp total) for A, B');
  });
});
