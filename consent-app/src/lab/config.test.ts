import { describe, expect, it } from 'vitest';
import { ageFrom, buildParticipantId, formatPostcode, idDetails, idName, isoDateOf, isUkPostcode, participantIdKey, PARTICIPANT_CODE } from './config';

const dob = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return { day, month, year };
};
const person = (firstName: string, lastName: string, date: string, postcode: string) => ({ firstName, lastName, dateOfBirth: dob(date), postcode });

/** The worked examples in docs/participant-id.md: the survey platform must give the same IDs. */
const examples: [ReturnType<typeof person>, string, string][] = [
  [person('Jane', 'Smith', '2005-03-14', 'LS2 9JT'), 'JANE|SMITH|20050314|LS29JT', 'MP2670FF90A5F2'],
  [person(' jane ', 'smith', '2005-03-14', 'ls29jt'), 'JANE|SMITH|20050314|LS29JT', 'MP2670FF90A5F2'],
  [person('Élodie', 'O’Brien-Smith', '2003-11-02', 'ls6 1ab'), 'ELODIE|OBRIENSMITH|20031102|LS61AB', 'MP2E11B78F58BE'],
  [person('Mary Jane', 'van der Berg', '2006-01-01', 'M1 1AE'), 'MARYJANE|VANDERBERG|20060101|M11AE', 'MP532156113C03'],
  [person('Zoë', 'Ng', '2001-12-31', 'EC1A 1BB'), 'ZOE|NG|20011231|EC1A1BB', 'MPC464EEC6978B'],
];

describe('participant ID', () => {
  it('normalises names to plain capital letters', () => {
    expect(idName('Élodie')).toBe('ELODIE');
    expect(idName("O'Brien-Smith")).toBe('OBRIENSMITH');
    expect(idName('  mary jane ')).toBe('MARYJANE');
    expect(idName('Ömer')).toBe('OMER');
    expect(idName('Strauß')).toBe('STRAUSS');
    expect(idName('-')).toBe('');
  });

  it('reads a date of birth only when it is a real date', () => {
    expect(isoDateOf({ day: '14', month: '3', year: '2005' })).toBe('2005-03-14');
    expect(isoDateOf({ day: '29', month: '2', year: '2004' })).toBe('2004-02-29');
    expect(isoDateOf({ day: '29', month: '2', year: '2005' })).toBeNull();
    expect(isoDateOf({ day: '', month: '3', year: '2005' })).toBeNull();
    expect(ageFrom('2005-03-14', new Date(2026, 2, 13))).toBe(20);
    expect(ageFrom('2005-03-14', new Date(2026, 2, 14))).toBe(21);
  });

  it('gives the worked examples exactly, whatever the spacing, case and accents', async () => {
    for (const [parts, key, id] of examples) {
      expect(participantIdKey(parts)).toBe(key);
      expect(await buildParticipantId(parts)).toBe(id);
      expect(PARTICIPANT_CODE.test(id)).toBe(true);
    }
  });

  it('keeps twins apart by their first names', async () => {
    const amira = await buildParticipantId(person('Amira', 'Khan', '2004-07-09', 'BD1 1AA'));
    const yasmin = await buildParticipantId(person('Yasmin', 'Khan', '2004-07-09', 'BD1 1AA'));
    expect(amira).toBe('MP4B89BF282A5D');
    expect(yasmin).toBe('MP33CE17327FF2');
  });

  it('needs every detail', async () => {
    expect(await buildParticipantId(person('Jane', '', '2005-03-14', 'LS2 9JT'))).toBeNull();
    expect(await buildParticipantId({ ...person('Jane', 'Smith', '2005-03-14', 'LS2 9JT'), dateOfBirth: { day: '', month: '', year: '' } })).toBeNull();
    expect(idDetails(person(' Jane ', 'Smith ', '2005-03-14', 'ls29jt'))).toEqual({ firstName: 'Jane', lastName: 'Smith', dateOfBirth: '2005-03-14', postcode: 'LS2 9JT' });
  });
});

describe('postcodes', () => {
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
});
