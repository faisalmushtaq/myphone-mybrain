import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { daysBetween, formatDay } from '../dates';
import type { DayInfo } from '../progress';
import { DAY_STATE_LABEL, DayIcon } from './DayIcon';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** An open-ended break can run for months: the most recent weeks first, the rest on request. */
const RECENT_DAYS = 42;

function spoken(day: DayInfo): string {
  const what = DAY_STATE_LABEL[day.state].toLowerCase();
  return `Day ${day.number}, ${formatDay(day.date, 'no-year')}: ${what}${day.covered || day.state === 'today' ? '' : ', no screenshot yet'}.`;
}

/** The break's days as a calendar, Monday first. */
export function Calendar({ days }: { days: DayInfo[] }) {
  const [all, setAll] = useState(false);
  if (!days.length) return null;
  const shown = all ? days : days.slice(-RECENT_DAYS);
  // Monday is 0. 1 January 2024 was a Monday.
  const lead = (((daysBetween('2024-01-01', shown[0].date) % 7) + 7) % 7);
  const states = (['verified', 'kept', 'slip', 'over', 'paused', 'unreported'] as const).filter((s) => days.some((d) => d.state === s));
  return (
    <div className="ny-cal">
      {days.length > RECENT_DAYS && (
        <p className="mpmb-hint">
          {all ? `All ${days.length} days.` : `The last ${RECENT_DAYS} days of ${days.length}.`}{' '}
          <Button variant="link" onClick={() => setAll((a) => !a)}>
            {all ? 'Show recent days only' : 'Show every day'}
          </Button>
        </p>
      )}
      <div className="ny-cal__head" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <ol className="ny-cal__grid" role="list">
        {Array.from({ length: lead }, (_, i) => (
          <li key={`pad-${i}`} className="ny-cal__pad" aria-hidden="true" />
        ))}
        {shown.map((day) => (
          <li key={day.date} className={`ny-cal__day is-${day.state}${day.state === 'today' ? ' is-today' : ''}${day.covered ? ' is-covered' : ''}`}>
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
        {states.map((state) => (
          <li key={state}>
            <span className={`ny-cal__swatch is-${state}`}>
              <DayIcon state={state} />
            </span>
            {DAY_STATE_LABEL[state]}
          </li>
        ))}
        <li>
          <span className="ny-cal__swatch is-today" aria-hidden="true" />
          Today
        </li>
      </ul>
    </div>
  );
}
