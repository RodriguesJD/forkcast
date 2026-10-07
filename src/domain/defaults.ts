import type { WeekSettings } from './types';

/** Common staples most kitchens keep. Users edit this list in settings. */
export const DEFAULT_PANTRY_STAPLES: readonly string[] = [
  'salt',
  'black pepper',
  'olive oil',
  'vegetable oil',
  'butter',
  'all-purpose flour',
  'sugar',
];

/**
 * Sunday-start week, dinners only, household of 2, 45 min on weeknights and
 * 2 hours on the weekend, batch prep suggested for Sunday.
 */
export function defaultSettings(): WeekSettings {
  return {
    startDay: 0,
    activeSlots: ['dinner'],
    householdSize: 2,
    availableMinutesPerDay: [120, 45, 45, 45, 45, 45, 120],
    pantryStaples: [...DEFAULT_PANTRY_STAPLES],
    batchPrepDayIndex: 0,
  };
}
