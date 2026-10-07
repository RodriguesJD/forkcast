import { normalizeIngredientName, scaleIngredients } from './recipes';
import { DAYS_PER_WEEK, compareSlots, effectiveCookEntries, isDayInWeek, weekdayName } from './plan';
import type {
  AdvancePrepTask,
  BatchPrepTask,
  CookTask,
  DaySchedule,
  Quantity,
  RecipeIndex,
  Schedule,
  ScheduleTask,
  Warning,
  WeekPlan,
} from './types';
import { add, chooseDisplayUnit, fromBase, toBase } from './units';

/**
 * Flat estimate for one batch-prep item. No per-ingredient prep times exist
 * in the data model yet; this is a documented placeholder.
 */
export const BATCH_PREP_MINUTES_PER_ITEM = 10;

/** Minimum number of distinct cook entries sharing an ingredient+prep before batching is suggested. */
export const BATCH_PREP_MIN_USES = 2;

/**
 * Build the cooking schedule.
 *
 * - One cook task per effective cook entry, on its own day.
 * - Advance-prep steps land on cookDay - leadDays; before day 0 they go to `beforeWeek`.
 * - Day load = active minutes of cook + advance-prep tasks. Passive time (simmering) is free.
 * - Batch-prep suggestions are optional and never count toward load.
 */
export function buildSchedule(plan: WeekPlan, recipes: RecipeIndex): Schedule {
  const { settings } = plan;
  const warnings: Warning[] = [];
  const beforeWeek: AdvancePrepTask[] = [];
  const dayTasks: ScheduleTask[][] = Array.from({ length: DAYS_PER_WEEK }, () => []);

  const entries = effectiveCookEntries(plan, recipes);

  for (const entry of entries) {
    const recipe = recipes[entry.recipeId];
    const cook: CookTask = {
      kind: 'cook',
      entryId: entry.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      slot: entry.slot.slot,
      servings: entry.servings,
      activeMinutes: recipe.activeMinutes,
      totalMinutes: recipe.totalMinutes,
    };
    dayTasks[entry.slot.dayIndex].push(cook);

    const limit = settings.availableMinutesPerDay[entry.slot.dayIndex] ?? null;
    if (limit !== null && recipe.totalMinutes > limit) {
      warnings.push({
        code: 'recipe-too-long',
        entryId: entry.id,
        dayIndex: entry.slot.dayIndex,
        message: `${recipe.name} takes ${recipe.totalMinutes} min start to finish, more than the ${limit} min available on ${weekdayName(settings, entry.slot.dayIndex)}. Start early or pick another day.`,
      });
    }

    for (const step of recipe.advancePrep) {
      const prepDay = entry.slot.dayIndex - Math.max(1, Math.ceil(step.leadDays));
      const task: AdvancePrepTask = {
        kind: 'advance-prep',
        forEntryId: entry.id,
        recipeName: recipe.name,
        stepId: step.id,
        description: step.description,
        activeMinutes: step.activeMinutes,
        forDayIndex: entry.slot.dayIndex,
        forSlot: entry.slot.slot,
      };
      if (isDayInWeek(prepDay)) {
        dayTasks[prepDay].push(task);
      } else {
        beforeWeek.push(task);
        warnings.push({
          code: 'prep-before-week',
          entryId: entry.id,
          dayIndex: entry.slot.dayIndex,
          message: `"${step.description}" for ${recipe.name} (${weekdayName(settings, entry.slot.dayIndex)} ${entry.slot.slot}) must happen before this week starts.`,
        });
      }
    }
  }

  for (const task of suggestBatchPrep(plan, recipes)) {
    dayTasks[settings.batchPrepDayIndex as number].push(task);
  }

  const days: DaySchedule[] = dayTasks.map((tasks, dayIndex) => {
    const sorted = sortTasks(tasks);
    const loadMinutes = sorted
      .filter((t) => t.kind !== 'batch-prep')
      .reduce((sum, t) => sum + t.activeMinutes, 0);
    const availableMinutes = settings.availableMinutesPerDay[dayIndex] ?? null;
    const overloaded = availableMinutes !== null && loadMinutes > availableMinutes;
    if (overloaded) {
      warnings.push({
        code: 'day-overloaded',
        dayIndex,
        message: `${weekdayName(settings, dayIndex)} needs ${loadMinutes} min of hands-on time but only ${availableMinutes} min is available.`,
      });
    }
    return { dayIndex, tasks: sorted, loadMinutes, availableMinutes, overloaded };
  });

  return { beforeWeek, days, warnings };
}

const TASK_KIND_ORDER: Record<ScheduleTask['kind'], number> = {
  cook: 0,
  'advance-prep': 1,
  'batch-prep': 2,
};

function sortTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  return [...tasks].sort((a, b) => {
    const kindDiff = TASK_KIND_ORDER[a.kind] - TASK_KIND_ORDER[b.kind];
    if (kindDiff !== 0) return kindDiff;
    if (a.kind === 'cook' && b.kind === 'cook') {
      return compareSlots({ dayIndex: 0, slot: a.slot }, { dayIndex: 0, slot: b.slot });
    }
    if (a.kind === 'advance-prep' && b.kind === 'advance-prep') {
      return a.forDayIndex - b.forDayIndex;
    }
    return 0;
  });
}

interface PrepGroup {
  displayName: string;
  prep: string;
  entryIds: Set<string>;
  recipeNames: Set<string>;
  total: Quantity | null;
}

/**
 * Suggest shared prep for the batch-prep day.
 *
 * An ingredient qualifies when the same normalized name AND the same `prep`
 * verb appear in at least BATCH_PREP_MIN_USES distinct cook entries that cook
 * on or after the batch-prep day. Diced onion and sliced onion are different tasks.
 * Pantry staples are not excluded here: you still have to chop the garlic you own.
 */
export function suggestBatchPrep(plan: WeekPlan, recipes: RecipeIndex): BatchPrepTask[] {
  const batchDay = plan.settings.batchPrepDayIndex;
  if (batchDay === null || !isDayInWeek(batchDay)) return [];

  const groups = new Map<string, PrepGroup>();
  for (const entry of effectiveCookEntries(plan, recipes)) {
    if (entry.slot.dayIndex < batchDay) continue;
    const recipe = recipes[entry.recipeId];
    for (const ing of scaleIngredients(recipe, entry.servings)) {
      if (!ing.prep) continue;
      const prep = ing.prep.trim().toLowerCase();
      const key = `${normalizeIngredientName(ing.name)}|${prep}`;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, {
          displayName: ing.name.trim(),
          prep,
          entryIds: new Set([entry.id]),
          recipeNames: new Set([recipe.name]),
          total: ing.quantity,
        });
      } else {
        group.entryIds.add(entry.id);
        group.recipeNames.add(recipe.name);
        group.total = group.total ? add(group.total, ing.quantity) : null;
      }
    }
  }

  const tasks: BatchPrepTask[] = [];
  for (const group of groups.values()) {
    if (group.entryIds.size < BATCH_PREP_MIN_USES) continue;
    const amount = group.total
      ? ` (${formatAmount(group.total)} total)`
      : '';
    tasks.push({
      kind: 'batch-prep',
      description: `${capitalize(group.prep)} ${group.displayName}${amount} for ${[...group.recipeNames].join(', ')}`,
      coversEntryIds: [...group.entryIds],
      activeMinutes: BATCH_PREP_MINUTES_PER_ITEM,
      optional: true,
    });
  }
  return tasks.sort((a, b) => a.description.localeCompare(b.description));
}

function formatAmount(q: Quantity): string {
  const display = fromBase(toBase(q), chooseDisplayUnit(toBase(q), q.unit));
  const rounded = Math.round(display.amount * 100) / 100;
  return `${rounded} ${display.unit}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
