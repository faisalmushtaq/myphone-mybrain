import { daysBetween, formatDay } from '../dates';
import type { BreakDay } from '../streaks';
import { DAY_STATE_LABEL, DayIcon } from './DayIcon';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function spoken(day: BreakDay): string {
  const what =
    day.state === 'kept'
      ? 'kept the break'
      : day.state === 'slipped'
        ? `slipped ${day.slip === 'lot' ? 'a lot' : 'a little'}`
        : day.state === 'not-checked'
          ? day.canCheckIn
            ? 'not checked in yet, you can still check in'
            : 'not checked in'
          : day.isToday
            ? 'today'
            : 'still to come';
  return `Day ${day.number}, ${formatDay(day.date, 'no-year')}: ${what}.`;
}

/** The break's days as a calendar, Monday first. */
export function Calendar({ days }: { days: BreakDay[] }) {
  if (!days.length) return null;
  // Monday is 0. 1 January 2024 was a Monday.
  const lead = (((daysBetween('2024-01-01', days[0].date) % 7) + 7) % 7);
  return (
    <div className="ny-cal">
      <div className="ny-cal__head" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <ol className="ny-cal__grid" role="list">
        {Array.from({ length: lead }, (_, i) => (
          <li key={`pad-${i}`} className="ny-cal__pad" aria-hidden="true" />
        ))}
        {days.map((day) => (
          <li key={day.date} className={`ny-cal__day is-${day.state}${day.isToday ? ' is-today' : ''}${day.canCheckIn ? ' is-open' : ''}`}>
            <span className="ny-cal__num" aria-hidden="true">
              {day.number}
            </span>
            <DayIcon state={day.state} />
            <span className="ny-cal__date" aria-hidden="true">
              {formatDay(day.date, 'short')}
            </span>
            <span className="mpmb-sr-only">{spoken(day)}</span>
          </li>
        ))}
      </ol>
      <ul className="ny-cal__legend" role="list" aria-label="What the marks mean">
        {(['kept', 'slipped', 'not-checked', 'future'] as const).map((state) => (
          <li key={state}>
            <span className={`ny-cal__swatch is-${state}`}>
              <DayIcon state={state} />
            </span>
            {DAY_STATE_LABEL[state]}
          </li>
        ))}
        <li>
          <span className="ny-cal__swatch is-future is-today" aria-hidden="true" />
          Today
        </li>
      </ul>
    </div>
  );
}
