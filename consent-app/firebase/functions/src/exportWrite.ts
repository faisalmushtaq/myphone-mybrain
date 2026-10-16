import { createHash } from 'node:crypto';

/**
 * How the hourly export makes its bucket match what it built, decided here
 * as pure functions so the rules can be tested without a bucket (16 October
 * 2026, when the OneDrive copy became the team's main way into the data).
 *
 * Tables and text files are compared by MD5 with what is already there and
 * written only when they differ, so an hour with no new records changes
 * nothing in OneDrive.
 *
 * Images, signatures, archives and recordings are copied bucket to bucket
 * (server side: nothing is downloaded), and every copy is stamped with where
 * it came from: the source path and the SHA-256 the record holds, or, for a
 * file whose record holds none, the source's MD5. A file is copied again
 * whenever its name is missing, unstamped (copies made before this date,
 * re-copied once, which heals the bucket), or stamped with another source.
 * Names come from positions (run-01, ses-02), and before this an image
 * withdrawn from an automatic save moved the ones after it up a place while
 * the old files kept their names, so a name could hold another image.
 *
 * The tables built from an archive carry the same stamp, and are built again
 * when any of them is missing or stamped with another archive. An archive
 * that cannot be unpacked is listed in manifest.json and tried again a day
 * later, not every hour.
 */

/** An object already in a bucket, as a listing describes it. */
export interface ObjectInfo {
  name: string;
  md5Hash?: string;
  contentType?: string;
  /** The object's custom metadata. */
  metadata?: Record<string, string>;
}

/** The custom metadata keys of the stamp. */
export const STAMP_SOURCE = 'mpmbSource';
export const STAMP_SHA256 = 'mpmbSourceSha256';
export const STAMP_MD5 = 'mpmbSourceMd5';

/** At most this many files are copied, and archives unpacked, in one run; the rest wait for the next (manifest.json says how many). */
export const COPY_LIMIT = 500;
export const UNPACK_LIMIT = 20;
/** An archive that failed to unpack is tried again after this long. */
export const UNPACK_RETRY_MS = 24 * 60 * 60 * 1000;

export interface CopyJob {
  source: string;
  target: string;
  /** The SHA-256 the record holds for the stored file, when it holds one. */
  sha256?: string | null;
}

/** MD5 as Cloud Storage reports it (base64). */
export const md5Of = (body: string | Buffer): string => createHash('md5').update(body).digest('base64');

/** The stamp for a copy of (or tables built from) a source: its path and the record's SHA-256, else the source object's MD5; null when the source cannot be found. */
export function stampFor(source: string, sha256: string | null | undefined, sourceInfo: ObjectInfo | undefined): Record<string, string> | null {
  if (!sourceInfo) return null;
  if (typeof sha256 === 'string' && sha256) return { [STAMP_SOURCE]: source, [STAMP_SHA256]: sha256 };
  return { [STAMP_SOURCE]: source, [STAMP_MD5]: String(sourceInfo.md5Hash ?? '') };
}

export type CopyState = 'up-to-date' | 'missing' | 'unstamped' | 'other-source';

/** Whether an object already holds what the stamp says it should. */
export function copyState(existing: ObjectInfo | undefined, stamp: Record<string, string>): CopyState {
  if (!existing) return 'missing';
  const meta = existing.metadata ?? {};
  if (!meta[STAMP_SOURCE]) return 'unstamped';
  return Object.entries(stamp).every(([k, v]) => meta[k] === v) ? 'up-to-date' : 'other-source';
}

/** Whether a table or text file must be written: missing, different content (by MD5), or different custom metadata. */
export function needsWrite(existing: ObjectInfo | undefined, file: { body: string; metadata?: Record<string, string> }): boolean {
  if (!existing) return true;
  if (existing.md5Hash !== md5Of(file.body)) return true;
  return Object.entries(file.metadata ?? {}).some(([k, v]) => existing.metadata?.[k] !== v);
}

export interface PlannedCopy extends CopyJob {
  stamp: Record<string, string>;
  state: Exclude<CopyState, 'up-to-date'>;
  contentType: string;
}

export interface CopyPlan {
  /** In order of need: names holding another file first, then missing ones, then unstamped ones (probably right, re-copied to be sure). */
  toCopy: PlannedCopy[];
  /** Records whose file is not in the study's storage. */
  missingSource: CopyJob[];
  upToDate: number;
}

const ORDER: Record<PlannedCopy['state'], number> = { 'other-source': 0, missing: 1, unstamped: 2 };

export function planCopies(jobs: CopyJob[], existing: Map<string, ObjectInfo>, sources: Map<string, ObjectInfo>): CopyPlan {
  const toCopy: PlannedCopy[] = [];
  const missingSource: CopyJob[] = [];
  let upToDate = 0;
  for (const job of jobs) {
    const info = sources.get(job.source);
    const stamp = stampFor(job.source, job.sha256, info);
    if (!stamp) {
      missingSource.push(job);
      continue;
    }
    const state = copyState(existing.get(job.target), stamp);
    if (state === 'up-to-date') upToDate += 1;
    else toCopy.push({ ...job, stamp, state, contentType: String(info?.contentType ?? 'application/octet-stream') });
  }
  toCopy.sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  return { toCopy, missingSource, upToDate };
}

/** An archive the export could not unpack into tables, as manifest.json lists it. */
export interface UnpackFailure {
  /** The archive's place in the export. */
  archive: string;
  sha256: string | null;
  error: string;
  at: string;
}

/** Whether to try unpacking an archive this run: always, unless it failed less than a day ago (the same archive, by SHA-256 or place). */
export function unpackDue(previous: UnpackFailure[], archive: string, sha256: string | null | undefined, now: Date): boolean {
  const last = previous.find((f) => (sha256 ? f.sha256 === sha256 : f.archive === archive));
  if (!last) return true;
  const at = Date.parse(last.at);
  return Number.isNaN(at) || now.getTime() - at >= UNPACK_RETRY_MS;
}

/** What is in the bucket and no longer belongs: anything not expected, unless kept (a binary whose copy failed is still expected, so is never here). */
export function staleObjects(existing: ObjectInfo[], expected: Set<string>): ObjectInfo[] {
  return existing.filter((f) => !expected.has(f.name));
}
