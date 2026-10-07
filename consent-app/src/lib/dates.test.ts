import { describe, expect, it } from 'vitest';
import { schoolYearFor } from './dates';

const dob = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return { day, month, year };
};
const on = (iso: string) => new Date(`${iso}T12:00:00`);

describe('schoolYearFor (England: the year group is set by age on 31 August)', () => {
  it('puts 1 September birthdays at the top of the younger year', () => {
    // School year 2026/27.
    expect(schoolYearFor(dob('2014-08-31'), on('2026-10-07'))).toBe('Year 8');
    expect(schoolYearFor(dob('2014-09-01'), on('2026-10-07'))).toBe('Year 7');
    expect(schoolYearFor(dob('2013-03-14'), on('2026-10-07'))).toBe('Year 9');
  });

  it('uses the school year that started last September until the next one starts', () => {
    expect(schoolYearFor(dob('2014-09-01'), on('2026-07-15'))).toBeNull();
    expect(schoolYearFor(dob('2013-09-01'), on('2026-07-15'))).toBe('Year 7');
    expect(schoolYearFor(dob('2013-09-01'), on('2026-09-01'))).toBe('Year 8');
  });

  it('covers Year 7 to Year 13 and nothing else', () => {
    expect(schoolYearFor(dob('2009-08-31'), on('2026-10-07'))).toBe('Year 13');
    expect(schoolYearFor(dob('2009-09-01'), on('2026-10-07'))).toBe('Year 12');
    expect(schoolYearFor(dob('2008-08-31'), on('2026-10-07'))).toBeNull();
    expect(schoolYearFor(dob('2015-09-01'), on('2026-10-07'))).toBeNull();
    expect(schoolYearFor({ day: '31', month: '2', year: '2013' }, on('2026-10-07'))).toBeNull();
    expect(schoolYearFor({ day: '', month: '', year: '' }, on('2026-10-07'))).toBeNull();
  });
});
