import type { DayState } from '../streaks';

/**
 * The calendar's marks. Each state has its own shape as well as its own
 * colour (a tick, a wave, a question mark, nothing), and the legend and the
 * screen-reader text say it in words, so nothing relies on colour alone.
 */
export function DayIcon({ state }: { state: DayState }) {
  if (state === 'kept') {
    return (
      <svg className="ny-dayicon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
      </svg>
    );
  }
  if (state === 'slipped') {
    return (
      <svg className="ny-dayicon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M3.5 13.5c2.2-3.2 4.3-3.2 6.4 0s4.3 3.2 6.4 0c1.4-2 2.8-2.6 4.2-1.6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === 'not-checked') {
    return (
      <span className="ny-dayicon ny-dayicon--text" aria-hidden="true">
        ?
      </span>
    );
  }
  return <span className="ny-dayicon ny-dayicon--empty" aria-hidden="true" />;
}

export const DAY_STATE_LABEL: Record<DayState, string> = {
  kept: 'Kept the break',
  slipped: 'Slipped',
  'not-checked': 'Not checked in',
  future: 'Still to come',
};
