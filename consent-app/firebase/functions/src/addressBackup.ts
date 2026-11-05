import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';

/**
 * The address finder's backup, for when Ideal Postcodes cannot answer (no key
 * stored yet, no credit, a limit reached, the key refused, or no reply).
 *
 * It answers from West Yorkshire open data built by
 * consent-app/firebase/address-backup (every live postcode from OS Code-Point
 * Open, about 635,000 addresses from HM Land Registry Price Paid Data and
 * about 44,800 streets from OS Open Names). The files sit in a private Cloud
 * Storage bucket that only the functions read, so the address list is never
 * public: a family only ever receives the few addresses matching what they
 * typed. The Price Paid addresses may be used for non-commercial purposes
 * only, which this study is.
 *
 * It has no UPRNs, and it lacks homes not sold since 1995 (much social
 * housing), so an address it does not know is still typed by the family, as
 * before. Its answers have the same shape as Ideal Postcodes' answers, so the
 * form cannot tell them apart; picked suggestions have ids starting "wy:".
 */

/** One postcode's entry: coordinates, district, ward and addresses as [line 1, line 2, locality, town]. */
export interface BackupPostcode {
  lat: number;
  lon: number;
  d: string;
  w: string;
  a: [string, string, string, string][];
}
/** A street: name, place, district, postcode district, inward codes (space separated), how many of them have listed addresses, extra area words. */
export type BackupStreet = [string, string, string, string, string, number, string?];

export interface BackupFiles {
  /** The postcodes of one postcode district ("LS6"), or null if there is no such file. */
  outcode(outward: string): Promise<Record<string, BackupPostcode> | null>;
  /** The streets with a word starting with this letter ("0" for digits). */
  streets(letter: string): Promise<BackupStreet[] | null>;
}

const SUGGESTIONS = 8;
const PICK_ID = /^wy:([A-Z0-9]{5,7}):(\d{1,4})$/;
const ABBR: Record<string, string> = {
  rd: 'road', st: 'street', la: 'lane', ln: 'lane', ave: 'avenue', av: 'avenue', dr: 'drive', cres: 'crescent',
  cl: 'close', ct: 'court', gr: 'grove', gro: 'grove', ter: 'terrace', terr: 'terrace', tce: 'terrace', pl: 'place',
  gdns: 'gardens', sq: 'square', mt: 'mount', wk: 'walk', pk: 'park', grn: 'green', vw: 'view', app: 'approach',
};
const GENERIC = new Set(['road', 'street', 'lane', 'avenue', 'drive', 'close', 'court', 'crescent', 'grove', 'terrace',
  'place', 'way', 'gardens', 'view', 'walk', 'mount', 'rise', 'square', 'the']);
const UNIT = new Set(['flat', 'apartment', 'apt', 'unit', 'room']);

/** Lower-case words, apostrophes and full stops dropped, "saint" read as "st". */
export function words(s: string): string[] {
  return (s || '').toLowerCase().replace(/['’.]/g, '').replace(/\bsaint\b/g, 'st').split(/[^a-z0-9]+/).filter(Boolean);
}

function spaced(compact: string): string {
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function natural(a: string, b: string): number {
  return a.localeCompare(b, 'en-GB', { numeric: true, sensitivity: 'base' });
}

/** The address as the form shows it (lines, then lines and town), as for Ideal Postcodes. */
function shown(r: [string, string, string, string]): { label: string; address: string } {
  const lines = [r[0], r[1], r[2]].filter(Boolean);
  return { label: lines.join(', '), address: [...lines, r[3]].filter(Boolean).join(', ').slice(0, 200) };
}

/** Splits what was typed into the house part (numbers, "flat 3") and the rest. */
export function splitQuery(query: string): { house: string[]; rest: string[] } {
  const toks = words(query);
  const house: string[] = [];
  let i = 0;
  while (i < toks.length) {
    if (/\d/.test(toks[i]!)) { house.push(toks[i]!); i++; }
    else if (UNIT.has(toks[i]!) && i + 1 < toks.length && /\d/.test(toks[i + 1]!)) { house.push(toks[i]!, toks[i + 1]!); i += 2; }
    else break;
  }
  return { house, rest: toks.slice(i) };
}

interface Street { name: string; oc: string; pcs: string[]; known: number; nw: string[]; aw: string[] }

function streetOf(r: BackupStreet): Street {
  return {
    name: r[0], oc: r[3], known: r[5],
    pcs: r[4].split(' ').filter(Boolean).map((x) => `${r[3]}${x}`),
    nw: words(r[0]), aw: words(`${r[0]} ${r[1]} ${r[2]} ${r[3]} ${r[6] ?? ''}`),
  };
}

/** Streets matching the words typed, best first. Every word must start a word of the street or its area; the first must be in the name. */
export function matchStreets(rows: BackupStreet[], toks: string[]): Street[] {
  const out: { s: Street; score: number }[] = [];
  for (const row of rows) {
    const s = streetOf(row);
    let score = 0;
    let ok = true;
    toks.forEach((t, i) => {
      if (!ok) return;
      const full = ABBR[t];
      const hit = s.aw.findIndex((w) => w === t || w === full || w.startsWith(t));
      if (hit < 0 || (i === 0 && hit >= s.nw.length)) { ok = false; return; }
      const w = s.aw[hit]!;
      score += hit < s.nw.length ? 2 : 1;
      if (w !== t && w !== full && i < toks.length - 1) score -= 0.5;
    });
    if (!ok) continue;
    if (s.nw[0]?.startsWith(toks[0]!)) score += 3;
    if (s.known) score += 1;
    out.push({ s, score: score - s.nw.length * 0.1 });
  }
  return out.sort((a, b) => b.score - a.score || natural(a.s.name, b.s.name)).map((x) => x.s);
}

function containsRun(hay: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

function houseMatches(line1: string, house: string[]): boolean {
  const w = words(line1);
  return house.every((t) => (/\d/.test(t) ? w.includes(t) : w.some((x) => x.startsWith(t))));
}

export function createBackup(files: BackupFiles) {
  /** The addresses listed on a street, each with the id that picks it. */
  async function onStreet(s: Street): Promise<{ id: string; pc: string; r: [string, string, string, string] }[]> {
    const shard = await files.outcode(s.oc);
    if (!shard) return [];
    const out: { id: string; pc: string; r: [string, string, string, string] }[] = [];
    for (const compact of s.pcs.slice(0, s.known)) {
      const pc = spaced(compact);
      (shard[pc]?.a ?? []).forEach((r, i) => {
        if (containsRun(words(`${r[0]} ${r[1]}`), s.nw)) out.push({ id: `wy:${compact}:${i}`, pc, r });
      });
    }
    return out.sort((a, b) => natural(a.r[0], b.r[0]));
  }

  return {
    /** The addresses at a postcode; not-found when the backup has none listed there. */
    async postcode(compact: string) {
      const pc = spaced(compact);
      const shard = await files.outcode(pc.split(' ')[0]!);
      const entry = shard?.[pc];
      if (!entry || !entry.a.length) return { status: 'not-found' as const };
      const addresses = entry.a.map((r) => ({ ...shown(r), uprn: null }))
        .sort((x, y) => natural(x.label, y.label));
      return { status: 'found' as const, postcode: pc, addresses };
    },

    /** Addresses matching what has been typed, as suggestions to pick. */
    async suggest(query: string) {
      const { house, rest } = splitQuery(query);
      // A house name is tried only when no number was typed ("rose cottage manor dr").
      const tries: { house: string[]; toks: string[] }[] = [];
      for (let k = 0; k < rest.length && k < (house.length ? 1 : 3); k++) {
        const first = rest[k]!;
        if (first.length < 2 || (k > 0 && (GENERIC.has(first) || GENERIC.has(ABBR[first] ?? '')))) continue;
        tries.push({ house: [...house, ...rest.slice(0, k)], toks: rest.slice(k) });
      }
      for (const t of tries) {
        const letter = /[a-z]/.test(t.toks[0]![0]!) ? t.toks[0]![0]! : '0';
        const found = matchStreets((await files.streets(letter)) ?? [], t.toks).filter((s) => s.known);
        if (!found.length) continue;
        const hits: { id: string; label: string }[] = [];
        for (const s of found.slice(0, 6)) {
          for (const a of await onStreet(s)) {
            if (!houseMatches(a.r[0], t.house)) continue;
            hits.push({ id: a.id, label: [a.r[0], a.r[1], a.r[2], a.r[3], a.pc].filter(Boolean).join(', ') });
            if (hits.length >= SUGGESTIONS) return { status: 'suggestions' as const, suggestions: hits };
          }
        }
        return { status: 'suggestions' as const, suggestions: hits };
      }
      return { status: 'suggestions' as const, suggestions: [] };
    },

    /** The full address for a backup suggestion ("wy:LS61DE:3"). */
    async pick(id: string) {
      const m = PICK_ID.exec(id);
      if (!m) return { status: 'not-found' as const };
      const pc = spaced(m[1]!);
      const r = (await files.outcode(pc.split(' ')[0]!))?.[pc]?.a[Number(m[2])];
      if (!r) return { status: 'not-found' as const };
      return { status: 'picked' as const, postcode: pc, address: shown(r).address, uprn: null };
    },
  };
}

export const isBackupId = (id: unknown): id is string => typeof id === 'string' && id.startsWith('wy:');

/**
 * The files from the private bucket (MPMB_ADDRESS_BACKUP_BUCKET, myphone-mybrain-address-backup
 * unless set), kept in memory while the function instance lives. A missing bucket or file
 * means "no backup", never an error the family sees.
 */
export function bucketFiles(): BackupFiles {
  const name = process.env.MPMB_ADDRESS_BACKUP_BUCKET?.trim() || 'myphone-mybrain-address-backup';
  const cache = new Map<string, Promise<unknown>>();
  function read<T>(path: string): Promise<T | null> {
    if (!cache.has(path)) {
      cache.set(path, getStorage().bucket(name).file(path).download()
        .then(([buf]) => JSON.parse(buf.toString('utf8')) as T)
        .catch((error: unknown) => {
          cache.delete(path);
          const code = (error as { code?: number }).code;
          if (code !== 404) logger.warn('Address backup: could not read a file', { path, code });
          return null;
        }));
    }
    return cache.get(path) as Promise<T | null>;
  }
  return {
    outcode: (outward) => (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward) ? read(`pc/${outward}.json`) : Promise.resolve(null)),
    streets: (letter) => (/^[a-z0]$/.test(letter) ? read(`st/${letter}.json`) : Promise.resolve(null)),
  };
}

let shared: ReturnType<typeof createBackup> | null = null;
/** The backup the functions use. */
export function backup(): ReturnType<typeof createBackup> {
  shared ??= createBackup(bucketFiles());
  return shared;
}
