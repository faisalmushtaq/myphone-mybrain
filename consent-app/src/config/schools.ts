/**
 * Participating schools. PLACEHOLDER list — replace with the schools taking
 * part, keyed by the identifier used in the study database.
 */
export interface School {
  id: string;
  name: string;
  area: 'Bradford' | 'Leeds';
}

export const schools: School[] = [
  { id: 'BRD-001', name: 'Example High School, Bradford', area: 'Bradford' },
  { id: 'BRD-002', name: 'Example Academy, Bradford', area: 'Bradford' },
  { id: 'LDS-001', name: 'Example School, Leeds', area: 'Leeds' },
  { id: 'LDS-002', name: 'Example Academy, Leeds', area: 'Leeds' },
];

/** Special value for "My school is not in the list". */
export const OTHER_SCHOOL_ID = 'other';
