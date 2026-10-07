import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { sendTeamMail } from './mail.js';
import { readSecret } from './secrets.js';
import { ukDate } from './ukTime.js';
import { isObj } from './validate.js';

/**
 * Finding a family's address (Ideal Postcodes, decided 7 October 2026), so the
 * address is complete and spelt the way the records it is linked with spell
 * it, and comes with the property's UPRN. The family form offers two ways:
 * the addresses at a postcode, and suggestions as the parent types their
 * address, the one they choose then fetched in full. The form asks this
 * function and this function asks Ideal Postcodes, so the provider sees only
 * the postcode or the part of the address typed so far, never who is asking,
 * and the account key stays in Secret Manager (scripts/set-address-key.sh).
 * Until the key is stored, or if the provider fails or the credit runs out,
 * the answer is "unavailable" and the form simply asks for the address to be
 * typed.
 *
 * A postcode's list or a chosen address costs a credit. Suggestions are free,
 * but Ideal Postcodes suspends accounts that ask for many without fetching
 * addresses. So one browser session may have 10 lookups and 60 suggestions an
 * hour, and the whole site MPMB_ADDRESS_DAILY_CAP lookups a day (300 unless
 * set) and ten times as many suggestions. Nothing typed is ever logged.
 */

const REGION = 'europe-west2';
const callOptions = { region: REGION, memory: '256MiB' as const, timeoutSeconds: 30, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };
const MAX_ADDRESSES = 200;
const SUGGESTIONS = 8;
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
const OUTWARD = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const SUGGESTION_ID = /^[A-Za-z0-9_|.:-]{1,80}$/;

type Kind = 'lookup' | 'suggestion';
const PER_SESSION_PER_HOUR: Record<Kind, number> = { lookup: 10, suggestion: 60 };
/** Suggestions are counted on five documents, so families typing at the same moment do not queue on one. */
const SUGGESTION_SHARDS = 5;

export interface FoundAddress {
  /** What the list shows: the address lines without the town. */
  label: string;
  /** What goes in the address box: the lines and the town. */
  address: string;
  /** Ordnance Survey's Unique Property Reference Number, when the property has one. */
  uprn: string | null;
}

export interface AddressSuggestion {
  /** Ideal Postcodes' id for the address, to fetch it in full when chosen. */
  id: string;
  /** The suggestion as Ideal Postcodes words it, for example "12 Long Lane, Leeds, LS6". */
  label: string;
}

export type AddressLookup = { status: 'found'; postcode: string; addresses: FoundAddress[] } | { status: 'not-found' } | { status: 'unavailable' };
export type AddressSuggestions = { status: 'suggestions'; suggestions: AddressSuggestion[] } | { status: 'unavailable' };
export type PickedAddress = { status: 'picked'; postcode: string; address: string; uprn: string | null } | { status: 'not-found' } | { status: 'unavailable' };

/** "ls61ab" or "LS6 1AB" → "LS61AB", or null if it is not a full UK postcode. */
export function compactPostcode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 12) return null;
  const compact = input.toUpperCase().replace(/\s+/g, '');
  return POSTCODE.test(compact) ? compact : null;
}

/** "LS61AB" → "LS6 1AB". */
function spaced(compact: string): string {
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/** PAF towns are in capitals: "LEEDS" → "Leeds", "STOKE-ON-TRENT" → "Stoke-on-Trent". */
export function townCase(town: string): string {
  const small = new Set(['on', 'upon', 'in', 'le', 'by', 'under', 'next', 'the', 'de', 'en', 'sur']);
  return town
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

/** Turns Ideal Postcodes' address records into what the form shows and stores. */
export function addressesFrom(result: unknown): FoundAddress[] {
  if (!Array.isArray(result)) return [];
  return result
    .filter(isObj)
    .slice(0, MAX_ADDRESSES)
    .map((a) => {
      const text = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
      const lines = [text('line_1'), text('line_2'), text('line_3')].filter(Boolean);
      const town = text('post_town') ? townCase(text('post_town')) : '';
      const uprn = String(a.uprn ?? '').trim();
      // 200 characters is the most the form keeps; no home address comes near it.
      return { label: lines.join(', '), address: [...lines, town].filter(Boolean).join(', ').slice(0, 200), uprn: /^\d{1,12}$/.test(uprn) ? uprn : null };
    })
    .filter((a) => a.label);
}

/** What the parent has typed so far, tidied for a search: 3 to 100 characters with at least one letter or number, or null. */
export function searchText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.replace(/\s+/g, ' ').trim();
  return text.length >= 3 && text.length <= 100 && /[A-Za-z0-9]/.test(text) ? text : null;
}

/** Puts addresses at the postcode the parent has given, or in its area, first; never leaves others out, in case the postcode is wrong. */
export function biasFor(near: unknown): Record<string, string> {
  if (typeof near !== 'string' || near.length > 12) return {};
  const full = compactPostcode(near);
  if (full) return { bias_postcode: spaced(full) };
  const outward = near.toUpperCase().replace(/\s+/g, '');
  return OUTWARD.test(outward) ? { bias_postcode_outward: outward } : {};
}

/** Ideal Postcodes' suggestions, as the list shows them. */
export function suggestionsFrom(hits: unknown): AddressSuggestion[] {
  if (!Array.isArray(hits)) return [];
  return hits
    .filter(isObj)
    .filter((h) => typeof h.id === 'string' && SUGGESTION_ID.test(h.id) && typeof h.suggestion === 'string' && h.suggestion.trim())
    .slice(0, SUGGESTIONS)
    .map((h) => ({ id: h.id as string, label: (h.suggestion as string).replace(/\s+/g, ' ').trim().slice(0, 200) }));
}

/** What an answer from Ideal Postcodes means: found, an unknown postcode or address (not charged), or a problem the team should hear about. */
export function outcomeOf(status: number, body: unknown): { kind: 'found' | 'not-found' | 'unavailable'; reason?: 'no-credit' | 'limit' | 'key' | 'provider' } {
  const code = isObj(body) && typeof body.code === 'number' ? body.code : null;
  if (status === 200 && code === 2000) return { kind: 'found' };
  // 4040 for a postcode, 4044 or 4046 for an address that has gone.
  if (status === 404) return { kind: 'not-found' };
  if (code === 4020) return { kind: 'unavailable', reason: 'no-credit' };
  if (code === 4021) return { kind: 'unavailable', reason: 'limit' };
  if (status === 401 || code === 4010 || code === 4042) return { kind: 'unavailable', reason: 'key' };
  return { kind: 'unavailable', reason: 'provider' };
}

/** The site's allowance for a day: MPMB_ADDRESS_DAILY_CAP lookups (300 unless set), and ten times as many suggestions. */
export function dailyCap(kind: Kind): number {
  const lookups = Number(process.env.MPMB_ADDRESS_DAILY_CAP) || 300;
  return kind === 'lookup' ? lookups : lookups * 10;
}

/** Counts one more lookup or suggestion for this browser session (an hour at a time) and for the site (a day at a time); counts nothing once either is used up. */
async function allowed(db: Firestore, uid: string, kind: Kind): Promise<'yes' | 'session' | 'site'> {
  const mine = db.collection('ratelimits').doc(`address-${kind}-${uid}`);
  const shard = kind === 'suggestion' ? `-${[...uid].reduce((n, c) => n + c.charCodeAt(0), 0) % SUGGESTION_SHARDS}` : '';
  const site = db.collection('meta').doc(`address-${kind}s${shard}`);
  const siteCap = kind === 'suggestion' ? Math.ceil(dailyCap(kind) / SUGGESTION_SHARDS) : dailyCap(kind);
  const today = ukDate(new Date());
  return db.runTransaction(async (tx) => {
    const [m, s] = await tx.getAll(mine, site);
    const now = Date.now();
    const md = m.data();
    const sameHour = typeof md?.windowStart === 'number' && now - md.windowStart < 3600_000;
    const used = sameHour ? Number(md?.count ?? 0) : 0;
    const sd = s.data();
    const usedToday = sd?.day === today ? Number(sd.count ?? 0) : 0;
    if (used >= PER_SESSION_PER_HOUR[kind]) return 'session';
    if (usedToday >= siteCap) return 'site';
    tx.set(mine, { windowStart: sameHour ? md!.windowStart : now, count: used + 1, updatedAt: FieldValue.serverTimestamp() });
    tx.set(site, { day: today, count: usedToday + 1, updatedAt: FieldValue.serverTimestamp() });
    return 'yes';
  });
}

type Reason = 'no-credit' | 'limit' | 'key' | 'cap' | 'suggestion-cap';

/** Tells the team, at most once a day, that the address finder has stopped and families are typing their addresses. */
async function alertTeam(db: Firestore, reason: Reason): Promise<void> {
  const ref = db.collection('meta').doc('address-alert');
  const today = ukDate(new Date());
  const first = await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).data()?.day === today) return false;
    tx.set(ref, { day: today, reason, at: FieldValue.serverTimestamp() });
    return true;
  });
  if (!first) return;
  const why: Record<Reason, string> = {
    'no-credit': 'the Ideal Postcodes account has run out of credit. Top it up at ideal-postcodes.co.uk.',
    limit: 'a daily limit on the Ideal Postcodes key has been reached. Raise or remove it at ideal-postcodes.co.uk.',
    key: 'Ideal Postcodes does not accept the key. Store the current key again with consent-app/firebase/scripts/set-address-key.sh.',
    cap: `the site reached its own cap of ${dailyCap('lookup')} address lookups today (MPMB_ADDRESS_DAILY_CAP). It starts again tomorrow.`,
    'suggestion-cap': `the site reached its own cap of ${dailyCap('suggestion')} address suggestions today (ten times MPMB_ADDRESS_DAILY_CAP), far more than families typing their addresses need, so someone may be misusing it. Suggestions start again tomorrow; finding addresses by postcode still works.`,
  };
  await sendTeamMail({
    subject: 'MyPhone/MyBrain — the address finder has stopped',
    text: `The family form's address finder stopped working today: ${why[reason]}\n\nUntil it is fixed, families type their address instead; nothing is lost.`,
  }).catch(() => undefined);
}

/** Asks Ideal Postcodes; null if it did not answer. */
async function ask(key: string, path: string, params: Record<string, string> = {}): Promise<{ status: number; body: unknown } | null> {
  const base = (process.env.MPMB_ADDRESS_API?.trim() || 'https://api.ideal-postcodes.co.uk').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}${path}?${new URLSearchParams({ api_key: key, ...params })}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (error) {
    logger.warn('Address finder: Ideal Postcodes did not answer', { error: String((error as Error).message ?? error).replaceAll(key, '[key]').slice(0, 200) });
    return null;
  }
}

/** Logs a failed answer (never what was asked) and tells the team when it needs them. */
async function failed(db: Firestore, status: number, reason: 'no-credit' | 'limit' | 'key' | 'provider' | undefined): Promise<{ status: 'unavailable' }> {
  logger.error('Address finder: Ideal Postcodes refused', { status, reason });
  if (reason && reason !== 'provider') await alertTeam(db, reason);
  return { status: 'unavailable' };
}

/** The addresses at a postcode (one credit). */
async function lookUp(uid: string, input: unknown): Promise<AddressLookup> {
  const postcode = compactPostcode(input);
  if (!postcode) throw new HttpsError('invalid-argument', 'Enter a full UK postcode, for example LS2 9JT.');
  const key = await readSecret(process.env.MPMB_ADDRESS_SECRET?.trim() || 'mpmb-address-key');
  if (!key) return { status: 'unavailable' };
  const db = getFirestore();
  const gate = await allowed(db, uid, 'lookup');
  if (gate !== 'yes') {
    if (gate === 'site') await alertTeam(db, 'cap');
    return { status: 'unavailable' };
  }
  const answer = await ask(key, `/v1/postcodes/${postcode}`);
  if (!answer) return { status: 'unavailable' };
  const outcome = outcomeOf(answer.status, answer.body);
  if (outcome.kind === 'not-found') return { status: 'not-found' };
  if (outcome.kind === 'unavailable') return failed(db, answer.status, outcome.reason);
  const addresses = addressesFrom(isObj(answer.body) ? answer.body.result : null);
  if (!addresses.length) return { status: 'not-found' };
  return { status: 'found', postcode: spaced(postcode), addresses };
}

/** Addresses matching what the parent has typed so far (free, but limited). */
async function suggest(uid: string, input: unknown, near: unknown): Promise<AddressSuggestions> {
  const query = searchText(input);
  if (!query) throw new HttpsError('invalid-argument', 'Type at least three letters or numbers of your address.');
  const key = await readSecret(process.env.MPMB_ADDRESS_SECRET?.trim() || 'mpmb-address-key');
  if (!key) return { status: 'unavailable' };
  const db = getFirestore();
  const gate = await allowed(db, uid, 'suggestion');
  if (gate !== 'yes') {
    if (gate === 'site') await alertTeam(db, 'suggestion-cap');
    return { status: 'unavailable' };
  }
  const answer = await ask(key, '/v1/autocomplete/addresses', { query, limit: String(SUGGESTIONS), context: 'GBR', ...biasFor(near) });
  if (!answer) return { status: 'unavailable' };
  const outcome = outcomeOf(answer.status, answer.body);
  if (outcome.kind !== 'found') return failed(db, answer.status, outcome.reason ?? 'provider');
  const result = isObj(answer.body) && isObj(answer.body.result) ? answer.body.result : null;
  return { status: 'suggestions', suggestions: suggestionsFrom(result?.hits) };
}

/** The full address for the suggestion the parent chose (one credit). */
async function pick(uid: string, input: unknown): Promise<PickedAddress> {
  if (typeof input !== 'string' || !SUGGESTION_ID.test(input)) throw new HttpsError('invalid-argument', 'Choose an address from the list.');
  const key = await readSecret(process.env.MPMB_ADDRESS_SECRET?.trim() || 'mpmb-address-key');
  if (!key) return { status: 'unavailable' };
  const db = getFirestore();
  const gate = await allowed(db, uid, 'lookup');
  if (gate !== 'yes') {
    if (gate === 'site') await alertTeam(db, 'cap');
    return { status: 'unavailable' };
  }
  const answer = await ask(key, `/v1/autocomplete/addresses/${encodeURIComponent(input)}/gbr`);
  if (!answer) return { status: 'unavailable' };
  const outcome = outcomeOf(answer.status, answer.body);
  if (outcome.kind === 'not-found') return { status: 'not-found' };
  if (outcome.kind === 'unavailable') return failed(db, answer.status, outcome.reason);
  const record = isObj(answer.body) ? answer.body.result : null;
  const [found] = addressesFrom([record]);
  const postcode = compactPostcode(isObj(record) ? record.postcode : null);
  if (!found || !postcode) return { status: 'not-found' };
  return { status: 'picked', postcode: spaced(postcode), address: found.address, uprn: found.uprn };
}

/**
 * One function for all three, so the suggestions as a parent types keep it
 * warm for the address they then choose: { postcode } for the addresses at a
 * postcode, { search, near } for suggestions (near being whatever is in the
 * postcode box), { pick } for the full address of a suggestion.
 */
export const findAddresses = onCall(callOptions, async (request): Promise<AddressLookup | AddressSuggestions | PickedAddress> => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const data = isObj(request.data) ? request.data : {};
  if (data.search !== undefined) return suggest(uid, data.search, data.near);
  if (data.pick !== undefined) return pick(uid, data.pick);
  return lookUp(uid, data.postcode);
});
