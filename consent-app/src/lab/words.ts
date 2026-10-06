import type { LabPhaseCounts } from '../api/types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 screenshots and 1 cleaned file", or "nothing yet". */
export function filesPhrase(c: LabPhaseCounts | null | undefined): string {
  if (!c || (!c.screenshots && !c.archives)) return 'nothing yet';
  const parts = [c.screenshots ? plural(c.screenshots, 'screen-time screenshot', 'screen-time screenshots') : '', c.archives ? plural(c.archives, 'cleaned app-data file', 'cleaned app-data files') : ''].filter(Boolean);
  return parts.join(' and ');
}
