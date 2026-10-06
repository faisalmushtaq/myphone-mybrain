import { describe, expect, it } from 'vitest';
import { buildParticipantCode, formatPostcode, isUkPostcode, nameHasTwoLetters } from './config';

describe('participant code answers', () => {
  it('tidies a postcode into its standard form', () => {
    expect(formatPostcode('ls29jt')).toBe('LS2 9JT');
    expect(formatPostcode(' ec1a  1bb ')).toBe('EC1A 1BB');
    expect(formatPostcode('m11ae')).toBe('M1 1AE');
    expect(formatPostcode('LS2')).toBe('LS2');
  });

  it('accepts full UK postcodes and refuses partial or foreign ones', () => {
    for (const ok of ['LS2 9JT', 'ls29jt', 'M1 1AE', 'B33 8TH', 'DN55 1PT', 'W1A 0AX', 'EC1A 1BB', 'GIR 0AA']) expect(isUkPostcode(ok), ok).toBe(true);
    for (const bad of ['', 'LS2', 'LS2 9J', '12345', '75008', 'LS2 JT9', 'L 9JT', 'SW1A1AAA', 'K1A 0B1']) expect(isUkPostcode(bad), bad).toBe(false);
  });

  it('builds the code from the person’s own first name, as the questionnaire does, whatever the postcode spacing', () => {
    expect(buildParticipantCode({ firstName: 'Jane', house: '123', month: '01', postcode: 'ab12cd' })).toBe('JA101CD');
    expect(buildParticipantCode({ firstName: 'Zoë', house: '7', month: '12', postcode: 'LS2 9JT' })).toBe('ZO712JT');
  });

  it('keeps twins apart by their own names, and reads accented first letters as plain ones', () => {
    const home = { house: '14', month: '03', postcode: 'LS6 1AB' };
    expect(buildParticipantCode({ firstName: 'Amira', ...home })).not.toBe(buildParticipantCode({ firstName: 'Yasmin', ...home }));
    expect(buildParticipantCode({ firstName: 'Élodie', ...home })).toBe('EL103AB');
    expect(buildParticipantCode({ firstName: 'Ömer', ...home })).toBe('OM103AB');
    expect(buildParticipantCode({ firstName: 'Mary-Jane', ...home })).toBe('MA103AB');
    expect(nameHasTwoLetters('Jo')).toBe(true);
    expect(nameHasTwoLetters('J')).toBe(false);
  });
});
