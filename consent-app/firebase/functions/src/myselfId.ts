import { createHash } from 'node:crypto';
import { NICKNAME_GROUPS } from './nicknames.js';

/**
 * MySelf's participant ID, worked out the same way here (4 November 2026), so
 * a young person's website record and their MySelf school survey carry the
 * same pseudonymous ID without either side knowing about the other.
 *
 * This is a copy of deriveParticipantId in MySelf
 * (packages/store/src/identity.ts, r8.0.0 on, decision D-52): "P" and ten
 * Crockford base-32 characters of SHA-256 over
 * "myself-participant-v1|<first>|<last>|<YYYY-MM-DD>", each name reduced to
 * letters and digits, lower case, accents removed. The tests pin it to IDs
 * MySelf's own code produced. Change neither without the other.
 *
 * The ID is a pseudonym, not an anonymisation: anyone with a name and a date
 * of birth can recompute it, by MySelf's design. It goes into research files
 * only as a join key, as MySelf's own research data already carries it.
 */

/** A name as the ID reads it: "O'Neill-Bárta" -> "oneillbarta". */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const MYSELF_ID_PATTERN = /^P[0-9A-HJKMNP-TV-Z]{10}$/;
const DOB = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** MySelf's participant ID for a name and date of birth, or null unless all three are present and well formed. */
export function myselfId(firstName: unknown, lastName: unknown, dob: unknown): string | null {
  const first = nameKey(typeof firstName === 'string' ? firstName : '');
  const last = nameKey(typeof lastName === 'string' ? lastName : '');
  const date = (typeof dob === 'string' ? dob : '').trim();
  if (!first || !last || !DOB.test(date)) return null;
  const digest = createHash('sha256').update(`myself-participant-v1|${first}|${last}|${date}`, 'utf8').digest();
  let bits = 0;
  let value = 0;
  let out = 'P';
  for (const byte of digest) {
    value = ((value << 8) | byte) >>> 0;
    bits += 8;
    while (bits >= 5 && out.length < 11) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === 11) break;
  }
  return out;
}

/** Each nickname group, keyed by every member's name key. */
const GROUP_OF = (() => {
  const m = new Map<string, string[]>();
  for (const group of NICKNAME_GROUPS) {
    const keys = [...new Set(group.map(nameKey))];
    for (const k of keys) m.set(k, [...new Set([...(m.get(k) ?? []), ...keys])]);
  }
  return m;
})();

/** Other forms of a first name, from the built-in list (Tom <-> Thomas, Mohammed <-> Muhammad). */
export function otherForms(firstName: string): string[] {
  const k = nameKey(firstName);
  return (GROUP_OF.get(k) ?? []).filter((x) => x !== k);
}

export type VariantKind = 'nickname' | 'dob-day-month-swapped' | 'names-swapped' | 'surname-part' | 'first-name-part' | 'class-list-name';

export interface Variant {
  kind: VariantKind;
  firstName: string;
  lastName: string;
  dob: string;
  id: string;
}

/**
 * The MySelf IDs a young person would have under the common slips between a
 * parent's form and a pupil's own survey: a nickname or the full name, day and
 * month swapped, first and last name the wrong way round, one half of a
 * double-barrelled surname, only the first of two first names, or the legal
 * name on the school's class list. Never the exact ID itself.
 */
export function variantIds(p: { firstName: unknown; lastName: unknown; dob: unknown; schoolFirstName?: unknown; schoolLastName?: unknown }): Variant[] {
  const first = typeof p.firstName === 'string' ? p.firstName.trim() : '';
  const last = typeof p.lastName === 'string' ? p.lastName.trim() : '';
  const dob = typeof p.dob === 'string' ? p.dob.trim() : '';
  const exact = myselfId(first, last, dob);
  const out: Variant[] = [];
  const seen = new Set<string>(exact ? [exact] : []);
  const add = (kind: VariantKind, f: string, l: string, d: string) => {
    const id = myselfId(f, l, d);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ kind, firstName: f, lastName: l, dob: d, id });
  };
  for (const f of otherForms(first)) add('nickname', f, last, dob);
  const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m && m[2] !== m[3] && Number(m[3]) <= 12) {
    const swapped = `${m[1]}-${m[3]}-${m[2]}`;
    add('dob-day-month-swapped', first, last, swapped);
    for (const f of otherForms(first)) add('dob-day-month-swapped', f, last, swapped);
  }
  add('names-swapped', last, first, dob);
  const lastParts = last.split(/[\s-]+/).filter(Boolean);
  if (lastParts.length > 1) for (const part of lastParts) add('surname-part', first, part, dob);
  const firstParts = first.split(/[\s-]+/).filter(Boolean);
  if (firstParts.length > 1) {
    add('first-name-part', firstParts[0], last, dob);
    for (const f of otherForms(firstParts[0])) add('first-name-part', f, last, dob);
  }
  const sf = typeof p.schoolFirstName === 'string' ? p.schoolFirstName.trim() : '';
  const sl = typeof p.schoolLastName === 'string' ? p.schoolLastName.trim() : '';
  if (sf && sl) add('class-list-name', sf, sl, dob);
  return out;
}
