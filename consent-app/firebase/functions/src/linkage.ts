import { createHash } from 'node:crypto';
import { myselfId, nameKey, variantIds } from './myselfId.js';

/**
 * The linkage registry's matching engine (4 November 2026): one study ID
 * ("sub-0001") a young person, joining their website record, their MySelf
 * survey codes and their EEG recordings. Pure: it takes records, people and
 * decisions and says what to do; linkageStore.ts reads and writes Firestore.
 *
 * The scoring is a port of scripts/match-myself.mjs (the local route, which
 * still works); linkage.test.ts checks the two agree.
 *
 * Tiers, strongest first:
 *   exact    the MySelf-style ID (myselfId.ts) is the same on both sides
 *   variant  one side's ID is the other's under a usual slip (nickname, day and
 *            month swapped, names swapped, part of a double-barrelled name,
 *            the school's legal name)
 *   upn      the same Unique Pupil Number
 *   fuzzy    names (Jaro-Winkler), date of birth (same, swapped, a digit off,
 *            a few days apart), school or site, postcode; sex and ethnicity
 *            only break ties
 * Only exact, variant and UPN ever link on their own, and only when the pair
 * is unique on both sides and neither is one of a possible pair of twins.
 * Everything else goes to a person. A decision ("same" or "different") is
 * final: the pair is never suggested again.
 */

/** The portal actions (portalCore.ts): the project manager and the research team; unlinking and settings, the project manager only. */
export const LINK_TEAM_ACTIONS = ['link-summary', 'link-queue', 'link-decide', 'link-person', 'link-search', 'link-run', 'link-myself-status', 'link-myself-upload', 'link-myself-names', 'link-eeg-upload', 'link-eeg-list', 'link-audit', 'link-settings'];
export const LINK_PM_ACTIONS = ['link-unlink', 'link-save-settings'];

export type SourceKind = 'website' | 'myself' | 'eeg';
export const SOURCE_KINDS: SourceKind[] = ['website', 'myself', 'eeg'];
const PREFIX: Record<SourceKind, string> = { website: 'w', myself: 'm', eeg: 'e' };
export const recordKey = (kind: SourceKind, ref: string) => `${PREFIX[kind]}:${ref}`;
export function kindOfKey(key: string): SourceKind {
  return key.startsWith('w:') ? 'website' : key.startsWith('m:') ? 'myself' : 'eeg';
}
export const refOfKey = (key: string) => key.slice(2);

/** One record from one source, as the engine sees it. Names only in memory (MySelf's never stored). */
export interface SourceRecord {
  key: string;
  kind: SourceKind;
  ref: string;
  /** The MySelf-style ID: worked out from name and date of birth, or MySelf's own code. */
  exactId: string | null;
  /** The IDs a usual slip would give (website and EEG; never the exact one). */
  variants: { id: string; kind: string }[];
  upn: string | null;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD */
  dob: string | null;
  postcode: string;
  sex: string;
  ethnicity: string;
  /** The website's school id, or a site mapped to one. */
  schoolId: string;
  yearGroup: string;
  /** YYYY-MM-DD: when this source first saw them. */
  firstContact: string | null;
  /** The website record carries an opt-out. */
  withdrawn: boolean;
}

export type PersonStatus = 'active' | 'withdrawn' | 'retired';
export interface Person {
  studyId: string;
  status: PersonStatus;
  keys: string[];
}
export type DecisionKind = 'same' | 'different';
export interface Decision {
  recordKey: string;
  studyId: string;
  decision: DecisionKind;
}
export type Tier = 'decision' | 'exact' | 'variant' | 'upn' | 'fuzzy' | 'new';
export interface Candidate {
  id: string;
  recordKey: string;
  studyId: string;
  tier: Tier;
  score: number;
  matchedOn: string[];
  reason: string;
}
export interface Attachment {
  recordKey: string;
  studyId: string;
  tier: Tier;
  matchedOn: string[];
  how: 'auto' | 'decision' | 'new';
}
export interface Plan {
  /** Study IDs to create, in order: "new:1", "new:2" … (the store gives each the next number). */
  newPeople: string[];
  attachments: Attachment[];
  candidates: Candidate[];
  /** Records waiting on a decision (they have candidates and no person yet). */
  awaiting: string[];
  /** Every person's status after this run (withdrawn when a website record in it is opted out). */
  statuses: Map<string, PersonStatus>;
}

/* ── Scoring (ported from scripts/match-myself.mjs) ───────────────────── */

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export type DobHow = 'missing' | 'same' | 'day-month-swapped' | 'one-digit-off' | 'within-a-week' | 'different';
/** How alike two dates of birth are. The first four as the script has them; "within a week" is the portal's addition. */
export function dobAgreement(a: string | null, b: string | null): { score: number; how: DobHow } {
  if (!a || !b) return { score: 0, how: 'missing' };
  if (a === b) return { score: 1, how: 'same' };
  const ma = a.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const mb = b.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!ma || !mb) return { score: 0, how: 'different' };
  if (ma[1] === mb[1] && ma[2] === mb[3] && ma[3] === mb[2]) return { score: 0.9, how: 'day-month-swapped' };
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  if (diff === 1) return { score: 0.8, how: 'one-digit-off' };
  const days = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
  if (days <= 7) return { score: 0.6, how: 'within-a-week' };
  return { score: 0, how: 'different' };
}

/** How alike two people's names are, allowing first and last the wrong way round. */
export function nameAgreement(f1: string, l1: string, f2: string, l2: string): { first: number; last: number; swapped: boolean; score: number } {
  const [a, b, c, d] = [f1, l1, f2, l2].map((x) => nameKey(x ?? ''));
  const straight = { first: jaroWinkler(a, c), last: jaroWinkler(b, d), swapped: false };
  const crossed = { first: jaroWinkler(a, d), last: jaroWinkler(b, c), swapped: true };
  const avg = (x: { first: number; last: number }) => (x.first + x.last) / 2;
  const best = avg(crossed) > avg(straight) + 0.05 ? crossed : straight;
  return { ...best, score: avg(best) };
}

export const postcodeKey = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface Named {
  firstName: string;
  lastName: string;
  dob: string | null;
  postcode: string;
  schoolId: string;
  sex: string;
  ethnicity: string;
}

/**
 * A fuzzy score for two people with names, or null when too unlike to show.
 * The "shown" rule is the script's, plus: a different school rules a pair out
 * unless the name and date of birth are near certain. Sex and ethnicity move
 * the score by a hair, to order near-ties, and never decide whether a pair is
 * shown.
 */
export function fuzzyScore(w: Named, m: Named): { score: number; matchedOn: string[] } | null {
  if (!w.firstName || !w.lastName || !m.firstName || !m.lastName) return null;
  const name = nameAgreement(w.firstName, w.lastName, m.firstName, m.lastName);
  const dob = dobAgreement(w.dob, m.dob);
  const samePostcode = Boolean(w.postcode && m.postcode && w.postcode === m.postcode);
  const schoolKnown = Boolean(w.schoolId && m.schoolId);
  const sameSchool = schoolKnown && w.schoolId === m.schoolId;
  let shown = (dob.score > 0 && name.last >= 0.85 && name.first >= 0.7) || (dob.score === 1 && name.score >= 0.8) || (samePostcode && dob.score > 0 && name.last >= 0.8) || (samePostcode && name.score >= 0.93);
  if (schoolKnown && !sameSchool && !(dob.score === 1 && name.score >= 0.93)) shown = false;
  if (!shown) return null;
  let score = 0.5 * name.score + 0.3 * dob.score + 0.1 * (sameSchool ? 1 : 0) + 0.1 * (samePostcode ? 1 : 0);
  const matchedOn = [`names ${name.first.toFixed(2)}/${name.last.toFixed(2)}${name.swapped ? ' (swapped)' : ''}`, `date of birth ${dob.how.replace(/-/g, ' ')}`, sameSchool ? 'same school' : schoolKnown ? 'other school' : 'school unknown', samePostcode ? 'same postcode' : w.postcode && m.postcode ? 'other postcode' : 'no postcode'];
  const sexA = sexOf(w.sex);
  const sexB = sexOf(m.sex);
  if (sexA !== 'n/a' && sexB !== 'n/a') {
    score += sexA === sexB ? 0.02 : -0.02;
    matchedOn.push(sexA === sexB ? 'same sex' : 'sex differs');
  }
  if (w.ethnicity && m.ethnicity) {
    const same = nameKey(w.ethnicity) === nameKey(m.ethnicity);
    score += same ? 0.01 : -0.01;
    matchedOn.push(same ? 'same ethnicity' : 'ethnicity differs');
  }
  return { score: Math.round(score * 1000) / 1000, matchedOn };
}

/** Sex as BIDS writes it: M, F, O, or n/a. */
export function sexOf(v: unknown): 'M' | 'F' | 'O' | 'n/a' {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 'n/a';
  if (['m', 'male', 'boy', 'man'].includes(s)) return 'M';
  if (['f', 'female', 'girl', 'woman'].includes(s)) return 'F';
  if (['o', 'other', 'non-binary', 'nonbinary', 'x'].includes(s)) return 'O';
  return 'n/a';
}

/* ── The engine ───────────────────────────────────────────────────────── */

export const candidateId = (recordKey: string, studyId: string) => createHash('sha256').update(`${recordKey}|${studyId}`).digest('hex').slice(0, 20);

interface Profile {
  studyId: string;
  status: PersonStatus;
  kinds: Set<SourceKind>;
  exact: Set<string>;
  variants: Map<string, string>;
  upns: Set<string>;
  named: Named[];
  twin: boolean;
}

const named = (r: SourceRecord): Named => ({ firstName: r.firstName, lastName: r.lastName, dob: r.dob, postcode: r.postcode, schoolId: r.schoolId, sex: r.sex, ethnicity: r.ethnicity });
const twinKey = (n: { lastName: string; dob: string | null }) => (n.lastName && n.dob ? `${nameKey(n.lastName)}|${n.dob}` : '');

function profilesOf(people: Map<string, Person>, records: Map<string, SourceRecord>): Map<string, Profile> {
  const out = new Map<string, Profile>();
  for (const p of people.values()) {
    if (p.status === 'retired') continue;
    const prof: Profile = { studyId: p.studyId, status: p.status, kinds: new Set(), exact: new Set(), variants: new Map(), upns: new Set(), named: [], twin: false };
    for (const key of p.keys) {
      const r = records.get(key);
      prof.kinds.add(kindOfKey(key));
      if (!r) continue;
      if (r.exactId) prof.exact.add(r.exactId);
      for (const v of r.variants) prof.variants.set(v.id, v.kind);
      if (r.upn) prof.upns.add(r.upn);
      if (r.firstName && r.lastName) prof.named.push(named(r));
    }
    out.set(p.studyId, prof);
  }
  // Twins: two people (or two records still waiting) with one surname and one date of birth, and different first names.
  const firstsBy = new Map<string, Map<string, Set<string>>>();
  for (const prof of out.values())
    for (const n of prof.named) {
      const k = twinKey(n);
      if (!k) continue;
      if (!firstsBy.has(k)) firstsBy.set(k, new Map());
      const m = firstsBy.get(k)!;
      if (!m.has(prof.studyId)) m.set(prof.studyId, new Set());
      m.get(prof.studyId)!.add(nameKey(n.firstName));
    }
  for (const m of firstsBy.values()) {
    if (m.size < 2) continue;
    const firsts = new Set([...m.values()].flatMap((s) => [...s]));
    if (firsts.size < 2) continue;
    for (const id of m.keys()) out.get(id)!.twin = true;
  }
  return out;
}

/** Records of one kind that share a surname and date of birth with another record of that kind under a different first name. */
function twinRecords(records: SourceRecord[]): Set<string> {
  const by = new Map<string, SourceRecord[]>();
  for (const r of records) {
    const k = twinKey(r);
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  const out = new Set<string>();
  for (const group of by.values()) if (new Set(group.map((r) => nameKey(r.firstName))).size > 1) for (const r of group) out.add(r.key);
  return out;
}

interface IdMatch {
  studyId: string;
  tier: 'exact' | 'variant' | 'upn';
  matchedOn: string[];
}

/** The strongest ID tier at which a record meets any person, with every person it meets there. */
function idMatches(r: SourceRecord, profiles: Map<string, Profile>, isDifferent: (studyId: string) => boolean): IdMatch[] {
  const tiers: [IdMatch['tier'], (p: Profile) => string[] | null][] = [
    ['exact', (p) => (r.exactId && p.exact.has(r.exactId) ? [r.kind === 'myself' ? 'MySelf code is the ID their name and date of birth give' : 'same MySelf-style ID'] : null)],
    [
      'variant',
      (p) => {
        if (r.exactId && p.variants.has(r.exactId)) return [`variant: ${p.variants.get(r.exactId)!.replace(/-/g, ' ')}`];
        const v = r.variants.find((x) => p.exact.has(x.id));
        return v ? [`variant: ${v.kind.replace(/-/g, ' ')}`] : null;
      },
    ],
    ['upn', (p) => (r.upn && p.upns.has(r.upn) ? ['same UPN'] : null)],
  ];
  for (const [tier, test] of tiers) {
    const found: IdMatch[] = [];
    for (const p of profiles.values()) {
      if (isDifferent(p.studyId)) continue;
      const on = test(p);
      if (on) found.push({ studyId: p.studyId, tier, matchedOn: on });
    }
    if (found.length) return found;
  }
  return [];
}

/**
 * What one run should do. Sources are taken in order (website, MySelf, EEG),
 * so a MySelf code can join a website record created in the same run. A
 * record with no suggestion gets a new study ID; a record with suggestions
 * waits for a person (it never gets an ID it might have to give back).
 */
export function plan(input: { records: SourceRecord[]; people: Person[]; decisions: Decision[]; carry?: Candidate[] }): Plan {
  const records = new Map(input.records.map((r) => [r.key, r]));
  const people = new Map(input.people.map((p) => [p.studyId, { ...p, keys: [...p.keys] }]));
  const owner = new Map<string, string>();
  for (const p of people.values()) if (p.status !== 'retired') for (const k of p.keys) owner.set(k, p.studyId);
  const decided = new Map(input.decisions.map((d) => [`${d.recordKey}|${d.studyId}`, d.decision]));
  const out: Plan = { newPeople: [], attachments: [], candidates: [], awaiting: [], statuses: new Map() };
  let temp = 0;
  const attach = (r: SourceRecord, studyId: string, tier: Tier, matchedOn: string[], how: Attachment['how']) => {
    people.get(studyId)!.keys.push(r.key);
    owner.set(r.key, studyId);
    out.attachments.push({ recordKey: r.key, studyId, tier, matchedOn, how });
  };
  const create = (r: SourceRecord) => {
    const studyId = `new:${++temp}`;
    people.set(studyId, { studyId, status: 'active', keys: [] });
    out.newPeople.push(studyId);
    attach(r, studyId, 'new', [], 'new');
    return studyId;
  };

  for (const kind of SOURCE_KINDS) {
    const waiting = input.records.filter((r) => r.kind === kind && !owner.has(r.key)).sort((a, b) => a.key.localeCompare(b.key));
    // 1. What a person decided.
    for (const r of waiting) {
      const same = input.decisions.find((d) => d.recordKey === r.key && d.decision === 'same' && people.has(d.studyId) && people.get(d.studyId)!.status !== 'retired');
      if (same) attach(r, same.studyId, 'decision', ['a person said these are the same'], 'decision');
    }
    const open = waiting.filter((r) => !owner.has(r.key));
    const profiles = profilesOf(people, records);
    const twins = twinRecords(input.records.filter((r) => r.kind === kind));
    const isDifferent = (r: SourceRecord) => (studyId: string) => decided.get(`${r.key}|${studyId}`) === 'different';

    // 2. The ID tiers, against the people as they stand.
    const found = new Map(open.map((r) => [r.key, idMatches(r, profiles, isDifferent(r))]));
    // How many records fit each person at each tier. Several EEG recordings of one child (one ID) count once.
    const fitting = new Map<string, Set<string>>();
    for (const r of open)
      for (const m of found.get(r.key)!) {
        const k = `${m.tier}|${m.studyId}`;
        if (!fitting.has(k)) fitting.set(k, new Set());
        fitting.get(k)!.add(kind === 'eeg' && r.exactId ? r.exactId : r.key);
      }
    const perPerson = new Map([...fitting].map(([k, v]) => [k, v.size]));
    const pending = new Map<string, Candidate[]>();
    const suggest = (r: SourceRecord, studyId: string, tier: Tier, score: number, matchedOn: string[], reason: string) => {
      const list = pending.get(r.key) ?? [];
      if (list.some((c) => c.studyId === studyId)) return;
      list.push({ id: candidateId(r.key, studyId), recordKey: r.key, studyId, tier, score, matchedOn, reason });
      pending.set(r.key, list);
    };
    for (const r of open) {
      const list = found.get(r.key)!;
      if (!list.length) continue;
      for (const m of list) {
        const prof = profiles.get(m.studyId)!;
        const unique = list.length === 1 && perPerson.get(`${m.tier}|${m.studyId}`) === 1;
        const twin = twins.has(r.key) || prof.twin;
        const sameKind = (kind === 'website' || kind === 'myself') && prof.kinds.has(kind);
        if (unique && !twin && !sameKind) {
          attach(r, m.studyId, m.tier, m.matchedOn, 'auto');
          break;
        }
        const reason = twin
          ? 'possible twin: someone else has this surname and date of birth, so this is never linked automatically'
          : sameKind
            ? kind === 'website'
              ? 'this person already has a website record: the same young person registered twice?'
              : 'second MySelf code: this person already has one; if both are theirs, MySelf should merge them'
            : list.length > 1
              ? `ambiguous: ${list.length} people fit this record`
              : `ambiguous: ${perPerson.get(`${m.tier}|${m.studyId}`)} records fit this person`;
        suggest(r, m.studyId, m.tier, 1, m.matchedOn, reason);
      }
    }

    // 3. Fuzzy, for records no ID tier reached.
    for (const r of open) {
      if (owner.has(r.key) || found.get(r.key)!.length) continue;
      if (!r.firstName || !r.lastName) {
        // No names this run (MySelf's are read only when it can be reached): what was suggested before stands.
        for (const c of input.carry ?? []) if (c.recordKey === r.key && profiles.has(c.studyId) && !isDifferent(r)(c.studyId)) suggest(r, c.studyId, c.tier, c.score, c.matchedOn, c.reason);
        continue;
      }
      const scored: { studyId: string; score: number; matchedOn: string[] }[] = [];
      for (const prof of profiles.values()) {
        if (isDifferent(r)(prof.studyId)) continue;
        // A second website record is a double registration, found by ID; names alone would pair up siblings.
        if (kind === 'website' && prof.kinds.has('website')) continue;
        let best: { score: number; matchedOn: string[] } | null = null;
        for (const n of prof.named) {
          const s = fuzzyScore(named(r), n);
          if (s && (!best || s.score > best.score)) best = s;
        }
        if (best) scored.push({ studyId: prof.studyId, ...best });
      }
      scored.sort((a, b) => b.score - a.score || a.studyId.localeCompare(b.studyId));
      const top = scored.slice(0, 3);
      for (const s of top) suggest(r, s.studyId, 'fuzzy', s.score, s.matchedOn, top.length > 1 ? `close in name and date of birth; ${top.length - 1} other ${top.length > 2 ? 'people' : 'person'} also fit (twins or siblings?)` : 'close in name and date of birth');
    }

    // 4. Nothing to ask about: a new study ID. EEG recordings of one child (same ID) share it.
    const createdFor = new Map<string, string>();
    for (const r of open) {
      if (owner.has(r.key)) continue;
      const list = pending.get(r.key);
      if (list?.length) {
        out.candidates.push(...list);
        out.awaiting.push(r.key);
        continue;
      }
      const sibling = kind === 'eeg' && r.exactId && !twins.has(r.key) ? createdFor.get(r.exactId) : undefined;
      if (sibling) attach(r, sibling, 'exact', ['another recording with the same ID'], 'auto');
      else {
        const id = create(r);
        if (r.exactId) createdFor.set(r.exactId, id);
      }
    }
  }

  for (const p of people.values()) {
    if (p.status === 'retired') {
      out.statuses.set(p.studyId, 'retired');
      continue;
    }
    const withdrawn = p.keys.some((k) => records.get(k)?.withdrawn);
    out.statuses.set(p.studyId, withdrawn ? 'withdrawn' : 'active');
  }
  // A candidate may point at a person this run created: the store renames both.
  return out;
}

/* ── Records from each source ─────────────────────────────────────────── */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
export function dayOf(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}
const isoDob = (v: unknown) => {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** A website participant, with what the export knows of them (label, UPN and the school's legal name, opt-out). */
export function websiteRecord(id: string, d: Record<string, unknown>, extra: { label?: string | null; upn?: string | null; schoolFirstName?: string | null; schoolLastName?: string | null; withdrawn?: boolean }): SourceRecord {
  const firstName = str(d.firstName);
  const lastName = str(d.lastName);
  const dob = isoDob(d.dateOfBirth);
  const guardian = (d.guardian ?? {}) as Record<string, unknown>;
  return {
    key: recordKey('website', id),
    kind: 'website',
    ref: id,
    exactId: myselfId(firstName, lastName, dob),
    variants: variantIds({ firstName, lastName, dob, schoolFirstName: extra.schoolFirstName ?? undefined, schoolLastName: extra.schoolLastName ?? undefined }).map((v) => ({ id: v.id, kind: v.kind })),
    upn: extra.upn || null,
    firstName,
    lastName,
    dob,
    postcode: postcodeKey(guardian.postcode ?? d.postcode),
    sex: '',
    ethnicity: '',
    schoolId: str(d.schoolId),
    yearGroup: str(d.yearGroup),
    firstContact: dayOf(d.createdAt) ?? dayOf(d.submittedAt),
    withdrawn: extra.withdrawn === true,
  };
}

/** A MySelf participant as stored here: code, sites, sittings, UPN. Names only when handed in for this run. */
export function myselfRecord(d: { code: string; sites?: string[]; sittings?: { date: string; release?: string }[]; upn?: string | null }, siteMap: Record<string, string>, names?: { givenName?: string; familyName?: string; dateOfBirth?: string | null; postcode?: string } | null): SourceRecord {
  const sites = (d.sites ?? []).map((s) => s.toUpperCase());
  const dates = (d.sittings ?? []).map((s) => s.date).filter(Boolean).sort();
  return {
    key: recordKey('myself', d.code),
    kind: 'myself',
    ref: d.code,
    exactId: d.code,
    variants: [],
    upn: d.upn || null,
    firstName: str(names?.givenName),
    lastName: str(names?.familyName),
    dob: isoDob(names?.dateOfBirth),
    postcode: postcodeKey(names?.postcode),
    sex: '',
    ethnicity: '',
    schoolId: sites.map((s) => siteMap[s]).find(Boolean) ?? '',
    yearGroup: '',
    firstContact: dates[0] ?? null,
    withdrawn: false,
  };
}

export interface EegRow {
  recordingId: string;
  firstName: string;
  lastName: string;
  dob: string | null;
  sex: string;
  ethnicity: string;
  recordingDate: string | null;
  site: string;
  schoolId: string;
  task: string;
  fileName: string;
  /** Kept when the names are removed at the end of the retention period. */
  exactId?: string | null;
}

/** An EEG recording from the manifest (names held here until the retention date). */
export function eegRecord(d: EegRow): SourceRecord {
  return {
    key: recordKey('eeg', d.recordingId),
    kind: 'eeg',
    ref: d.recordingId,
    exactId: d.firstName ? myselfId(d.firstName, d.lastName, d.dob) : (d.exactId ?? null),
    variants: d.firstName ? variantIds({ firstName: d.firstName, lastName: d.lastName, dob: d.dob }).map((v) => ({ id: v.id, kind: v.kind })) : [],
    upn: null,
    firstName: d.firstName,
    lastName: d.lastName,
    dob: d.dob,
    postcode: '',
    sex: d.sex,
    ethnicity: d.ethnicity,
    schoolId: d.schoolId,
    yearGroup: '',
    firstContact: d.recordingDate,
    withdrawn: false,
  };
}

/** A school or site as written on a manifest, as the website's school id when it names one. */
export function schoolIdFor(site: string, schools: { id: string; name: string }[], siteMap: Record<string, string> = {}): string {
  const s = site.trim();
  if (!s) return '';
  const k = nameKey(s);
  const hit = schools.find((x) => nameKey(x.id) === k || nameKey(x.name) === k);
  if (hit) return hit.id;
  return siteMap[s.toUpperCase()] ?? '';
}

/* ── The EEG manifest ─────────────────────────────────────────────────── */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A date written the UK way (dd/mm/yyyy, d.m.yy, 4 May 2012) or as YYYY-MM-DD, as YYYY-MM-DD; null when it cannot be read. */
export function ukDate(input: unknown, now = new Date()): string | null {
  const s = str(input);
  if (!s) return null;
  const real = (y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 1950 && y <= now.getUTCFullYear() + 1 ? date.toISOString().slice(0, 10) : null;
  };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\s.*)?$/);
  if (m) {
    let y = Number(m[3]);
    if (m[3].length === 2) y += y <= now.getUTCFullYear() % 100 ? 2000 : 1900;
    return real(y, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})\.?[\s\-,]+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return month ? real(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

export const EEG_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const EEG_TEMPLATE_COLUMNS = ['recording_id', 'first_name', 'last_name', 'date_of_birth', 'sex', 'ethnicity', 'recording_date', 'site', 'task', 'file_name'];

/** One manifest row as the browser sent it, checked again here; the problem in words when it cannot be used. */
export function eegRowOf(raw: Record<string, unknown>, schools: { id: string; name: string }[], siteMap: Record<string, string>, now = new Date()): { row: EegRow } | { problem: string } {
  const recordingId = str(raw.recordingId);
  if (!EEG_ID.test(recordingId)) return { problem: `“${recordingId.slice(0, 40)}” is not a usable recording id (letters, digits, dot, dash or underscore).` };
  const firstName = str(raw.firstName).slice(0, 80);
  const lastName = str(raw.lastName).slice(0, 80);
  const dob = ukDate(raw.dob, now);
  if (!firstName || !lastName) return { problem: `${recordingId}: first and last name are needed.` };
  if (str(raw.dob) && !dob) return { problem: `${recordingId}: the date of birth “${str(raw.dob).slice(0, 20)}” could not be read (use dd/mm/yyyy).` };
  if (!dob) return { problem: `${recordingId}: the date of birth is needed.` };
  const recordingDate = ukDate(raw.recordingDate, now);
  if (str(raw.recordingDate) && !recordingDate) return { problem: `${recordingId}: the recording date “${str(raw.recordingDate).slice(0, 20)}” could not be read (use dd/mm/yyyy).` };
  const site = str(raw.site).slice(0, 80);
  const task = str(raw.task).replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  return { row: { recordingId, firstName, lastName, dob, sex: str(raw.sex).slice(0, 20), ethnicity: str(raw.ethnicity).slice(0, 80), recordingDate, site, schoolId: schoolIdFor(site, schools, siteMap), task, fileName: str(raw.fileName).slice(0, 200) } };
}

/* ── The export: linkage/ ─────────────────────────────────────────────── */

export type Row = Record<string, string | number | null>;
export interface PersonDoc {
  studyId: string;
  number: number;
  status: PersonStatus;
  keys: string[];
  createdAt: string | null;
}
export interface ExportInput {
  people: PersonDoc[];
  records: Map<string, SourceRecord & { label?: string | null; referenceCode?: string | null }>;
  eeg: EegRow[];
  /** Records waiting for a decision. */
  awaiting: Set<string>;
}

/** Age in whole years on a day. */
export function ageOn(dob: string | null, day: string | null): number | null {
  if (!dob || !day) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const [Y, M, D] = day.split('-').map(Number);
  const age = Y - y - (M < m || (M === m && D < d) ? 1 : 0);
  return age >= 0 && age < 120 ? age : null;
}

export const LINK_PARTICIPANT_COLUMNS = ['participant_id', 'sex', 'age', 'school_id', 'year_group', 'first_contact_year', 'has_website', 'has_myself', 'has_eeg', 'has_lab'];
export const CROSSWALK_COLUMNS = ['participant_id', 'status', 'website_participant_ids', 'website_firestore_ids', 'reference_codes', 'myself_ids', 'upns', 'eeg_recording_ids', 'lab_ids', 'created_at'];
export const EEG_MAP_COLUMNS = ['recording_id', 'participant_id', 'session_id', 'recording_date', 'task', 'status', 'suggested_path'];

const yes = (b: boolean) => (b ? 'yes' : 'no');
const extOf = (fileName: string) => fileName.match(/\.([A-Za-z0-9]{2,6})$/)?.[1]?.toLowerCase() ?? 'edf';

/** linkage/participants.tsv (active people only, no names), identifying/crosswalk.tsv and eeg_map.tsv. */
export function linkageTables(x: ExportInput): { participants: Row[]; crosswalk: Row[]; eegMap: Row[] } {
  const live = x.people.filter((p) => p.status !== 'retired').sort((a, b) => a.number - b.number);
  const participants: Row[] = [];
  const crosswalk: Row[] = [];
  const eegSession = new Map<string, { participant: string; session: string; status: string }>();
  for (const p of live) {
    const recs = p.keys.map((k) => x.records.get(k)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    const of = (k: SourceKind) => recs.filter((r) => r.kind === k);
    const website = of('website');
    const eeg = of('eeg');
    const dob = website.find((r) => r.dob)?.dob ?? eeg.find((r) => r.dob)?.dob ?? null;
    const first = recs.map((r) => r.firstContact).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
    const sex = eeg.map((r) => sexOf(r.sex)).find((s) => s !== 'n/a') ?? 'n/a';
    const school = website.find((r) => r.schoolId)?.schoolId ?? recs.find((r) => r.schoolId)?.schoolId ?? '';
    if (p.status === 'active')
      participants.push({ participant_id: p.studyId, sex, age: ageOn(dob, first), school_id: school || null, year_group: website.find((r) => r.yearGroup)?.yearGroup || null, first_contact_year: first ? Number(first.slice(0, 4)) : null, has_website: yes(website.length > 0), has_myself: yes(of('myself').length > 0), has_eeg: yes(eeg.length > 0), has_lab: 'no' });
    crosswalk.push({
      participant_id: p.studyId,
      status: p.status,
      website_participant_ids: website.map((r) => r.label).filter(Boolean).join(',') || null,
      website_firestore_ids: website.map((r) => r.ref).join(',') || null,
      reference_codes: website.map((r) => r.referenceCode).filter(Boolean).join(',') || null,
      myself_ids: of('myself').map((r) => r.ref).join(',') || null,
      upns: [...new Set(recs.map((r) => r.upn).filter(Boolean))].join(',') || null,
      eeg_recording_ids: eeg.map((r) => r.ref).join(',') || null,
      lab_ids: null,
      created_at: p.createdAt,
    });
    const rows = x.eeg.filter((e) => p.keys.includes(recordKey('eeg', e.recordingId))).sort((a, b) => String(a.recordingDate ?? '9999').localeCompare(String(b.recordingDate ?? '9999')) || a.recordingId.localeCompare(b.recordingId));
    rows.forEach((e, i) => eegSession.set(e.recordingId, { participant: p.studyId, session: `ses-${String(i + 1).padStart(2, '0')}`, status: p.status === 'withdrawn' ? 'withdrawn' : 'linked' }));
  }
  const eegMap: Row[] = [...x.eeg]
    .sort((a, b) => a.recordingId.localeCompare(b.recordingId))
    .map((e) => {
      const s = eegSession.get(e.recordingId);
      const task = e.task || 'unknown';
      const status = s?.status ?? (x.awaiting.has(recordKey('eeg', e.recordingId)) ? 'awaiting-review' : 'unlinked');
      return {
        recording_id: e.recordingId,
        participant_id: s?.participant ?? null,
        session_id: s?.session ?? null,
        recording_date: e.recordingDate,
        task,
        status,
        suggested_path: s && status === 'linked' ? `${s.participant}/${s.session}/eeg/${s.participant}_${s.session}_task-${task}_eeg.${extOf(e.fileName)}` : null,
      };
    });
  return { participants, crosswalk, eegMap };
}

export function linkageParticipantsDictionary(): Record<string, unknown> {
  return {
    participant_id: { Description: 'The linkage study ID: one a young person, across the website, MySelf and EEG. Given in order and never reused.' },
    sex: { Description: 'Sex as recorded with the EEG recording.', Levels: { M: 'male', F: 'female', O: 'other' } },
    age: { Description: 'Age in whole years at first contact with any part of the study.', Units: 'year' },
    school_id: { Description: 'The school (the website’s school id).' },
    year_group: { Description: 'School year group, from the website.' },
    first_contact_year: { Description: 'The year of first contact.' },
    has_website: { Description: 'Has a website (consent and phone-use) record.' },
    has_myself: { Description: 'Has at least one MySelf survey code.' },
    has_eeg: { Description: 'Has at least one EEG recording.' },
    has_lab: { Description: 'Has a lab study record (not linked yet).' },
  };
}

export const LINKAGE_README = `Linkage: one study ID a young person
====================================

The staff portal's linkage registry (Linkage tab, School study) joins each
young person's website record, MySelf survey codes and EEG recordings under
one study ID, sub-0001, sub-0002 … given in order and never reused. It is
rewritten every hour.

participants.tsv   one row a young person who has not withdrawn: sex, age at
                   first contact, school, year group and which sources exist.
                   No names. Withdrawn young people are left out.
participants.json  its data dictionary.
eeg_map.tsv        each EEG recording on an uploaded manifest: the study ID and
                   session it belongs to, and a suggested BIDS path:
                   sub-XXXX/ses-NN/eeg/sub-XXXX_ses-NN_task-<task>_eeg.<ext>
                   status: linked, withdrawn (do not convert), awaiting-review
                   or unlinked (no study ID yet).
identifying/crosswalk.tsv
                   the key: study ID to website ids and reference codes,
                   MySelf codes, UPNs and EEG recording ids. Identifying; it
                   stays with the University's own copy.

Converting a recording to BIDS
------------------------------
1. Find the recording in eeg_map.tsv; convert only rows whose status is
   "linked", to the suggested path.
2. Strip names from the file's header before it goes in the dataset: EDF and
   BDF hold "patient identification" (name, sex, date of birth) in the first
   256 bytes, and BrainVision .vhdr files may name the participant in a
   comment. Set the patient field to the study ID only (for example with
   MNE-Python: raw.anonymize() then raw.info['subject_info'] = {'his_id':
   'sub-0001'}; or EDFbrowser's anonymiser). Keep no date of birth in the
   header: age is in participants.tsv.
3. Recording dates may be shifted by MNE's anonymize; the real date is in
   eeg_map.tsv if needed.
`;
