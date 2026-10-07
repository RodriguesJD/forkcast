import {
  activeSlotsInOrder,
  compareSlots,
  DAYS_PER_WEEK,
  entryAt,
  weekdayName,
  type CookEntry,
  type DaySchedule,
  type PlanEntry,
  type RecipeIndex,
  type SlotRef,
  type Warning,
  type WeekPlan,
} from '../domain';

interface Props {
  plan: WeekPlan;
  recipes: RecipeIndex;
  warnings: Warning[];
  days: DaySchedule[];
  onSet: (entry: PlanEntry) => void;
  onClear: (slot: SlotRef) => void;
  newId: () => string;
}

const LEFTOVER_PREFIX = 'leftover:';

export function WeekGrid({ plan, recipes, warnings, days, onSet, onClear, newId }: Props) {
  const slots = activeSlotsInOrder(plan.settings);
  const cookEntries = plan.entries
    .filter((e): e is CookEntry => e.kind === 'cook' && recipes[e.recipeId] !== undefined)
    .sort((a, b) => compareSlots(a.slot, b.slot));
  const recipeList = Object.values(recipes).sort((a, b) => a.name.localeCompare(b.name));

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

  return (
    <table className="grid">
      <thead>
        <tr>
          <th />
          {Array.from({ length: DAYS_PER_WEEK }, (_, d) => (
            <th key={d}>
              {weekdayName(plan.settings, d)}
              {days[d] && (
                <div className={`load${days[d].overloaded ? ' over' : ''}`}>
                  {days[d].loadMinutes} min
                  {days[d].availableMinutes !== null ? ` / ${days[d].availableMinutes}` : ''}
                </div>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {slots.map((slot) => (
          <tr key={slot}>
            <th>{slot}</th>
            {Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex) => {
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
              return (
                <td key={dayIndex} className="slot">
                  <div className="cell">
                    <select value={value} onChange={(e) => handleChange(ref, entry, e.target.value)}>
                      <option value="">—</option>
                      <optgroup label="Cook">
                        {recipeList.map((r) => (
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
                      <div className="meta">
                        <label>
                          {entry.kind === 'cook' ? 'cook' : 'eat'}{' '}
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={entry.servings}
                            onChange={(e) => onSet({ ...entry, servings: Number(e.target.value) })}
                          />{' '}
                          servings
                        </label>
                      </div>
                    )}
                    {entry?.kind === 'leftover' && (
                      <div className="leftover">
                        {(() => {
                          const src = plan.entries.find((e) => e.id === entry.sourceEntryId);
                          return src?.kind === 'cook' && recipes[src.recipeId]
                            ? `leftover ${recipes[src.recipeId].name}`
                            : 'leftover (source missing)';
                        })()}
                      </div>
                    )}
                    {entryWarnings.map((w, i) => (
                      <div key={i} className="warn" title={w.message}>
                        ⚠ {w.code}
                      </div>
                    ))}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
