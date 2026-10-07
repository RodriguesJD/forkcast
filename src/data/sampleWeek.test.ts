import { describe, expect, it } from 'vitest';
import { sampleWeekEntries, sampleWeekSettings } from './sampleWeek';
import { SEED_RECIPE_INDEX } from './seedRecipes';
import { validatePlan } from '../domain/plan';
import { buildShoppingList, allItems } from '../domain/shopping';
import { buildSchedule } from '../domain/schedule';
import type { WeekPlan } from '../domain/types';

const plan: WeekPlan = { settings: sampleWeekSettings(), entries: sampleWeekEntries() };

describe('sample week', () => {
  it('is a valid plan over the seed recipes', () => {
    expect(validatePlan(plan, SEED_RECIPE_INDEX)).toEqual([]);
  });

  it('exercises leftovers, a unit conflict, staples, prep, batch prep, overload and too-long', () => {
    const list = buildShoppingList(plan, SEED_RECIPE_INDEX);
    expect(list.warnings.some((w) => w.code === 'unit-conflict')).toBe(true); // parmesan oz vs cup
    expect(list.excludedStaples).toContain('olive oil');
    expect(allItems(list).find((i) => i.name === 'yellow onion')!.sources.length).toBeGreaterThanOrEqual(4);

    const schedule = buildSchedule(plan, SEED_RECIPE_INDEX);
    const codes = new Set(schedule.warnings.map((w) => w.code));
    expect(codes.has('day-overloaded')).toBe(true);
    expect(codes.has('recipe-too-long')).toBe(true);
    expect(codes.has('prep-before-week')).toBe(false);
    expect(schedule.days[0].tasks.some((t) => t.kind === 'batch-prep')).toBe(true);
    expect(schedule.days[0].tasks.some((t) => t.kind === 'advance-prep')).toBe(true);
    expect(schedule.days[3].overloaded).toBe(true);
  });
});
