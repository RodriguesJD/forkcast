import {
  activeSlotsInOrder,
  compareSlots,
  DAYS_PER_WEEK,
  entryAt,
  weekdayName,
  type CookEntry,
  type DaySchedule,
  type PlanEntry,
  type Recipe,
  type RecipeIndex,
  type SlotRef,
  type Warning,
  type WeekPlan,
} from '../domain';

interface Props {
  plan: WeekPlan;
  /** Every resolvable recipe, for labelling entries that already exist. */
  recipes: RecipeIndex;
  /** Recipes offered for new meals (archived ones are left out). */
  options: Recipe[];
  warnings: Warning[];
  days: DaySchedule[];
  onSet: (entry: PlanEntry) => void;
  onClear: (slot: SlotRef) => void;
  newId: () => string;
}

const LEFTOVER_PREFIX = 'leftover:';

/**
 * The week as seven day columns on a wide screen and seven stacked day cards on
 * a phone. Same markup both ways; CSS decides the layout (see .week in index.css).
 */
export function WeekGrid({ plan, recipes, options, warnings, days, onSet, onClear, newId }: Props) {
  const slots = activeSlotsInOrder(plan.settings);
  const cookEntries = plan.entries
    .filter((e): e is CookEntry => e.kind === 'cook' && recipes[e.recipeId] !== undefined)
    .sort((a, b) => compareSlots(a.slot, b.slot));

  function handleChange(slot: SlotRef, existing: PlanEntry | undefined, value: string) {
    if (value === '') {
      onClear(slot);
      return;
    }
    const id = existing?.id ?? newId();
    if (value.startsWith(LEFTOVER_PREFIX)) {
      onSet({
        kind: 'leftover',
        id,
        slot,
        sourceEntryId: value.slice(LEFTOVER_PREFIX.length),
        servings: existing?.kind === 'leftover' ? existing.servings : plan.settings.householdSize,
      });
    } else {
      onSet({
        kind: 'cook',
        id,
        slot,
        recipeId: value,
        servings: existing?.kind === 'cook' ? existing.servings : plan.settings.householdSize,
      });
    }
  }

  function labelFor(entry: CookEntry): string {
    return `${weekdayName(plan.settings, entry.slot.dayIndex).slice(0, 3)} ${entry.slot.slot}: ${recipes[entry.recipeId].name}`;
  }

  /**
   * The picker list, plus the slot's current recipe when it is archived (so the
   * select still shows it) or deleted (a placeholder, so the select does not
   * fall back to "—" and leave the entry impossible to clear).
   */
  function optionsFor(entry: PlanEntry | undefined): Recipe[] {
    if (entry?.kind !== 'cook') return options;
    const current = recipes[entry.recipeId] ?? {
      id: entry.recipeId,
      name: '(deleted recipe)',
      baseServings: 1,
      ingredients: [],
      activeMinutes: 0,
      totalMinutes: 0,
      advancePrep: [],
    };
    if (options.some((r) => r.id === current.id)) return options;
    return [...options, current].sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div className="week" style={{ ['--slot-rows' as string]: slots.length }}>
      {Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex) => (
        <section key={dayIndex} className="day-col" aria-label={weekdayName(plan.settings, dayIndex)}>
          <h3 className="day-head">
            <span>{weekdayName(plan.settings, dayIndex)}</span>
            {days[dayIndex] && (
              <span className={`load${days[dayIndex].overloaded ? ' over' : ''}`}>
                {days[dayIndex].loadMinutes} min
                {days[dayIndex].availableMinutes !== null ? ` / ${days[dayIndex].availableMinutes}` : ''}
              </span>
            )}
          </h3>
          {slots.map((slot) => {
            const ref: SlotRef = { dayIndex, slot };
            const entry = entryAt(plan, ref);
            const entryWarnings = entry ? warnings.filter((w) => w.entryId === entry.id) : [];
            const value =
              entry?.kind === 'cook'
                ? entry.recipeId
                : entry?.kind === 'leftover'
                  ? LEFTOVER_PREFIX + entry.sourceEntryId
                  : '';
            const leftoverSources = cookEntries.filter((c) => compareSlots(c.slot, ref) < 0);
            const source = entry?.kind === 'leftover' ? plan.entries.find((e) => e.id === entry.sourceEntryId) : undefined;
            return (
              <div key={slot} className={`slot-cell${entry ? ' filled' : ''}`}>
                <div className="slot-label">{slot}</div>
                <div className="cell">
                  <select
                    value={value}
                    onChange={(e) => handleChange(ref, entry, e.target.value)}
                    aria-label={`${weekdayName(plan.settings, dayIndex)} ${slot}`}
                  >
                    <option value="">—</option>
                    <optgroup label="Cook">
                      {optionsFor(entry).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                    {leftoverSources.length > 0 && (
                      <optgroup label="Leftovers from">
                        {leftoverSources.map((c) => (
                          <option key={c.id} value={LEFTOVER_PREFIX + c.id}>
                            {labelFor(c)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {entry && (
                    <label className="meta">
                      {entry.kind === 'cook' ? 'cook' : 'eat'}
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={entry.servings}
                        onChange={(e) => onSet({ ...entry, servings: Number(e.target.value) })}
                      />
                      servings
                    </label>
                  )}
                  {entry?.kind === 'leftover' && (
                    <div className="leftover">
                      {source?.kind === 'cook' && recipes[source.recipeId]
                        ? `leftover ${recipes[source.recipeId].name}`
                        : 'leftover (source missing)'}
                    </div>
                  )}
                  {entryWarnings.map((w, i) => (
                    <div key={i} className="warn" title={w.message}>
                      ⚠ {w.code}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
