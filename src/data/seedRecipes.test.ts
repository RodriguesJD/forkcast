import { describe, expect, it } from 'vitest';
import { SEED_RECIPES, SEED_RECIPE_INDEX } from './seedRecipes';
import { isUnit } from '../domain/units';
import { normalizeIngredientName } from '../domain/recipes';
import { buildShoppingList, allItems } from '../domain/shopping';
import { buildSchedule } from '../domain/schedule';
import { validatePlan } from '../domain/plan';
import { defaultSettings } from '../domain/defaults';
import type { WeekPlan } from '../domain/types';

describe('seed recipes', () => {
  it('has about 15 recipes with unique ids', () => {
    expect(SEED_RECIPES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(SEED_RECIPES.map((r) => r.id)).size).toBe(SEED_RECIPES.length);
  });

  it('is structurally valid', () => {
    for (const r of SEED_RECIPES) {
      expect(r.baseServings, r.id).toBeGreaterThan(0);
      expect(r.activeMinutes, r.id).toBeGreaterThan(0);
      expect(r.totalMinutes, r.id).toBeGreaterThanOrEqual(r.activeMinutes);
      expect(r.ingredients.length, r.id).toBeGreaterThan(0);
      for (const ing of r.ingredients) {
        expect(isUnit(ing.quantity.unit), `${r.id}: ${ing.name}`).toBe(true);
        expect(ing.quantity.amount, `${r.id}: ${ing.name}`).toBeGreaterThan(0);
        expect(ing.name).toBe(normalizeIngredientName(ing.name));
      }
      for (const step of r.advancePrep) {
        expect(step.leadDays, `${r.id}: ${step.id}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('shares ingredients across recipes so merging is exercised', () => {
    const uses = new Map<string, number>();
    for (const r of SEED_RECIPES) {
      for (const name of new Set(r.ingredients.map((i) => normalizeIngredientName(i.name)))) {
        uses.set(name, (uses.get(name) ?? 0) + 1);
      }
    }
    expect(uses.get('yellow onion')).toBeGreaterThanOrEqual(5);
    expect(uses.get('garlic')).toBeGreaterThanOrEqual(5);
    expect([...uses.values()].filter((n) => n >= 3).length).toBeGreaterThanOrEqual(6);
  });

  it('produces merges, a unit conflict, and batch prep in a sample week', () => {
    const plan: WeekPlan = {
      settings: { ...defaultSettings(), activeSlots: ['lunch', 'dinner'] },
      entries: [
        { kind: 'cook', id: 'a', slot: { dayIndex: 0, slot: 'dinner' }, recipeId: 'weeknight-chili', servings: 6 },
        { kind: 'leftover', id: 'a1', slot: { dayIndex: 1, slot: 'lunch' }, sourceEntryId: 'a', servings: 2 },
        { kind: 'leftover', id: 'a2', slot: { dayIndex: 2, slot: 'lunch' }, sourceEntryId: 'a', servings: 2 },
        { kind: 'cook', id: 'b', slot: { dayIndex: 1, slot: 'dinner' }, recipeId: 'chicken-tacos', servings: 2 },
        { kind: 'cook', id: 'c', slot: { dayIndex: 2, slot: 'dinner' }, recipeId: 'spaghetti-bolognese', servings: 4 },
        { kind: 'cook', id: 'd', slot: { dayIndex: 3, slot: 'lunch' }, recipeId: 'chicken-caesar-wraps', servings: 2 },
        { kind: 'cook', id: 'e', slot: { dayIndex: 3, slot: 'dinner' }, recipeId: 'black-bean-soup', servings: 6 },
        { kind: 'cook', id: 'f', slot: { dayIndex: 5, slot: 'dinner' }, recipeId: 'pulled-pork', servings: 8 },
        { kind: 'cook', id: 'g', slot: { dayIndex: 4, slot: 'dinner' }, recipeId: 'sheet-pan-chicken', servings: 4 },
      ],
    };
    expect(validatePlan(plan, SEED_RECIPE_INDEX)).toEqual([]);

    const list = buildShoppingList(plan, SEED_RECIPE_INDEX);
    const items = allItems(list);
    const onion = items.find((i) => i.name === 'yellow onion')!;
    expect(onion.sources.length).toBeGreaterThanOrEqual(4);
    expect(items.filter((i) => i.name === 'parmesan cheese')).toHaveLength(2);
    expect(list.warnings.some((w) => w.code === 'unit-conflict')).toBe(true);
    expect(list.excludedStaples).toContain('olive oil');

    const schedule = buildSchedule(plan, SEED_RECIPE_INDEX);
    const batch = schedule.days[0].tasks.filter((t) => t.kind === 'batch-prep');
    expect(batch.some((t) => t.description.startsWith('Diced yellow onion'))).toBe(true);
    expect(batch.some((t) => t.description.startsWith('Minced garlic'))).toBe(true);
    // tacos on day 1 need marinating on day 0; black bean soup on day 3 needs soaking on day 2
    expect(schedule.days[0].tasks.some((t) => t.kind === 'advance-prep')).toBe(true);
    expect(schedule.days[2].tasks.some((t) => t.kind === 'advance-prep' && t.description.includes('Soak'))).toBe(true);
    expect(schedule.warnings.some((w) => w.code === 'recipe-too-long' && w.entryId === 'f')).toBe(true);
  });
});
