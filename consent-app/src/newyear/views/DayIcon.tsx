import type { DayState } from '../progress';

/**
 * The calendar's marks. Each state has its own shape as well as its own
 * colour (a double tick, a tick, a wave, pause bars, a question mark,
 * nothing), and the legend and the screen-reader text say it in words, so
 * nothing relies on colour alone.
 */
export function DayIcon({ state }: { state: DayState }) {
  if (state === 'verified') {
    return (
      <svg className="ny-dayicon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M1.5 13.2 6 17.7 16.8 6.9l-1.4-1.4L6 14.9l-3.1-3.1-1.4 1.4Zm9.2 3.1 1.4 1.4L22.9 6.9l-1.4-1.4-9.4 9.4-.6-.6-1.4 1.4.6.6Z" fill="currentColor" />
      </svg>
    );
  }
  if (state === 'kept') {
    return (
      <svg className="ny-dayicon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
      </svg>
    );
  }
  if (state === 'slip' || state === 'over') {
    return (
      <svg className="ny-dayicon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M3.5 13.5c2.2-3.2 4.3-3.2 6.4 0s4.3 3.2 6.4 0c1.4-2 2.8-2.6 4.2-1.6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === 'paused') {
    return (
      <svg className="ny-dayicon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
      </svg>
    );
  }
  if (state === 'unreported') {
    return (
      <span className="ny-dayicon ny-dayicon--text" aria-hidden="true">
        ?
      </span>
    );
  }
  return <span className="ny-dayicon ny-dayicon--empty" aria-hidden="true" />;
}

export const DAY_STATE_LABEL: Record<DayState, string> = {
  verified: 'Off, shown by a screenshot',
  kept: 'Off, you said',
  slip: 'Slipped',
  over: 'Screenshot shows over',
  paused: 'Paused',
  unreported: 'Not reported yet',
  today: 'Today',
  future: 'Still to come',
};
