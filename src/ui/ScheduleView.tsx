import { weekdayName, type Schedule, type ScheduleTask, type WeekSettings } from '../domain';
import { Warnings } from './Warnings';

interface Props {
  schedule: Schedule;
  settings: WeekSettings;
}

function TaskLine({ task, settings }: { task: ScheduleTask; settings: WeekSettings }) {
  switch (task.kind) {
    case 'cook':
      return (
        <li>
          <strong>{task.slot}:</strong> cook {task.recipeName} ({task.servings} servings) · {task.activeMinutes} min
          active, {task.totalMinutes} min total
        </li>
      );
    case 'advance-prep':
      return (
        <li className="prep">
          <strong>Prep ahead:</strong> {task.description} · for {weekdayName(settings, task.forDayIndex)}{' '}
          {task.forSlot} ({task.recipeName}) · {task.activeMinutes} min
        </li>
      );
    case 'batch-prep':
      return (
        <li className="batch">
          <strong>Optional batch prep:</strong> {task.description} · ~{task.activeMinutes} min
        </li>
      );
  }
}

export function ScheduleView({ schedule, settings }: Props) {
  return (
    <div className="schedule">
      <Warnings warnings={schedule.warnings} />
      {schedule.beforeWeek.length > 0 && (
        <div className="day over">
          <h3>Before the week starts</h3>
          <ul>
            {schedule.beforeWeek.map((t, i) => (
              <TaskLine key={i} task={t} settings={settings} />
            ))}
          </ul>
        </div>
      )}
      {schedule.days.map((day) => (
        <div key={day.dayIndex} className={`day${day.overloaded ? ' over' : ''}`}>
          <h3>
            {weekdayName(settings, day.dayIndex)}
            <span className={`load${day.overloaded ? ' over' : ''}`}>
              {day.loadMinutes} min hands-on
              {day.availableMinutes !== null ? ` of ${day.availableMinutes} available` : ''}
            </span>
          </h3>
          {day.tasks.length === 0 ? (
            <div className="empty">Nothing to do</div>
          ) : (
            <ul>
              {day.tasks.map((t, i) => (
                <TaskLine key={i} task={t} settings={settings} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
