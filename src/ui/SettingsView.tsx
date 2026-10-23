import { MEAL_SLOT_ORDER, WEEKDAY_NAMES, weekdayName, type MealSlot, type WeekSettings, type Weekday } from '../domain';

interface Props {
  settings: WeekSettings;
  onChange: (settings: WeekSettings) => void;
}

export function SettingsView({ settings, onChange }: Props) {
  function toggleSlot(slot: MealSlot) {
    const active = settings.activeSlots.includes(slot)
      ? settings.activeSlots.filter((s) => s !== slot)
      : [...settings.activeSlots, slot];
    onChange({ ...settings, activeSlots: active });
  }

  return (
    <div className="settings">
      <label>
        Week starts on{' '}
        <select
          value={settings.startDay}
          onChange={(e) => onChange({ ...settings, startDay: Number(e.target.value) as Weekday })}
        >
          {WEEKDAY_NAMES.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <div className="slots">
        Active meal slots:{' '}
        {MEAL_SLOT_ORDER.map((slot) => (
          <label key={slot}>
            <input type="checkbox" checked={settings.activeSlots.includes(slot)} onChange={() => toggleSlot(slot)} />{' '}
            {slot}
          </label>
        ))}
        <div className="muted">Meals in a deactivated slot are kept but ignored until the slot is re-enabled.</div>
      </div>

      <label>
        Household size{' '}
        <input
          type="number"
          min={1}
          step={1}
          value={settings.householdSize}
          onChange={(e) => onChange({ ...settings, householdSize: Math.max(1, Number(e.target.value) || 1) })}
        />
        <span className="muted"> default servings for new meals; existing meals are not changed</span>
      </label>

      <div>
        Hands-on cooking minutes available per day (blank = no limit):
        <div className="days">
          {settings.availableMinutesPerDay.map((minutes, dayIndex) => (
            <label key={dayIndex}>
              {weekdayName(settings, dayIndex).slice(0, 3)}
              <input
                type="number"
                min={0}
                step={5}
                value={minutes ?? ''}
                onChange={(e) => {
                  const next = [...settings.availableMinutesPerDay];
                  next[dayIndex] = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                  onChange({ ...settings, availableMinutesPerDay: next });
                }}
              />
            </label>
          ))}
        </div>
      </div>

      <label>
        Suggest batch prep on{' '}
        <select
          value={settings.batchPrepDayIndex ?? ''}
          onChange={(e) =>
            onChange({ ...settings, batchPrepDayIndex: e.target.value === '' ? null : Number(e.target.value) })
          }
        >
          <option value="">don't suggest</option>
          {settings.availableMinutesPerDay.map((_, dayIndex) => (
            <option key={dayIndex} value={dayIndex}>
              {weekdayName(settings, dayIndex)}
            </option>
          ))}
        </select>
      </label>

      <label>
        Pantry staples (one per line; excluded from the shopping list)
        <textarea
          value={settings.pantryStaples.join('\n')}
          onChange={(e) =>
            onChange({
              ...settings,
              pantryStaples: e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            })
          }
        />
      </label>
    </div>
  );
}
