import type { PlanEntry, WeekSettings } from '../domain/types';
import { defaultSettings } from '../domain/defaults';

/**
 * A mock week over the seed recipes that exercises every rule at once:
 * leftovers, advance prep, batch prep, a unit conflict, a too-long recipe,
 * and one deliberately overloaded day. Used by the "Load sample week" button.
 */
export function sampleWeekSettings(): WeekSettings {
  return { ...defaultSettings(), activeSlots: ['lunch', 'dinner'] };
}

export function sampleWeekEntries(): PlanEntry[] {
  return [
    // Sunday: big chili, eaten again Monday and Tuesday lunch
    { kind: 'cook', id: 'sw-chili', slot: { dayIndex: 0, slot: 'dinner' }, recipeId: 'weeknight-chili', servings: 6 },
    { kind: 'leftover', id: 'sw-chili-l1', slot: { dayIndex: 1, slot: 'lunch' }, sourceEntryId: 'sw-chili', servings: 2 },
    { kind: 'leftover', id: 'sw-chili-l2', slot: { dayIndex: 2, slot: 'lunch' }, sourceEntryId: 'sw-chili', servings: 2 },
    // Monday: tacos (marinate Sunday)
    { kind: 'cook', id: 'sw-tacos', slot: { dayIndex: 1, slot: 'dinner' }, recipeId: 'chicken-tacos', servings: 2 },
    // Tuesday: bolognese, 90 min total on a 45 min day -> recipe-too-long
    { kind: 'cook', id: 'sw-bolognese', slot: { dayIndex: 2, slot: 'dinner' }, recipeId: 'spaghetti-bolognese', servings: 4 },
    // Wednesday: wraps for lunch + black bean soup (soak Tuesday) + thaw steak for Thursday
    //   -> 20 + 30 + 2 = 52 min on a 45 min day: day-overloaded
    { kind: 'cook', id: 'sw-wraps', slot: { dayIndex: 3, slot: 'lunch' }, recipeId: 'chicken-caesar-wraps', servings: 2 },
    { kind: 'cook', id: 'sw-soup', slot: { dayIndex: 3, slot: 'dinner' }, recipeId: 'black-bean-soup', servings: 6 },
    // Thursday: bolognese leftovers for lunch, stir-fry for dinner
    { kind: 'leftover', id: 'sw-bolognese-l1', slot: { dayIndex: 4, slot: 'lunch' }, sourceEntryId: 'sw-bolognese', servings: 2 },
    { kind: 'cook', id: 'sw-stirfry', slot: { dayIndex: 4, slot: 'dinner' }, recipeId: 'beef-stir-fry', servings: 2 },
    { kind: 'leftover', id: 'sw-soup-l1', slot: { dayIndex: 5, slot: 'lunch' }, sourceEntryId: 'sw-soup', servings: 2 },
    // Friday: pulled pork (rub Thursday), 8 hours -> recipe-too-long
    { kind: 'cook', id: 'sw-pork', slot: { dayIndex: 5, slot: 'dinner' }, recipeId: 'pulled-pork', servings: 8 },
    { kind: 'leftover', id: 'sw-pork-l1', slot: { dayIndex: 6, slot: 'lunch' }, sourceEntryId: 'sw-pork', servings: 2 },
    // Saturday: sheet-pan chicken, uses olive oil (a pantry staple)
    { kind: 'cook', id: 'sw-sheetpan', slot: { dayIndex: 6, slot: 'dinner' }, recipeId: 'sheet-pan-chicken', servings: 4 },
  ];
}
