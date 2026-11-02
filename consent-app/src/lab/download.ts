import type JSZip from 'jszip';
import { formatBytes } from './cleaner';
import { labStudy } from './config';

/**
 * Reading a participant's data download, whatever shape it arrives in
 * (2 November 2026, after a participant could not add a YouTube file "that is
 * not a ZIP" or a 145 MB Instagram file):
 *
 * - a ZIP, recognised by its first bytes whatever its name (".zip.download",
 *   no extension, a renamed "Takeout");
 * - a Google Takeout .tgz (gzip-compressed tar), read as a stream;
 * - a folder, when the browser or a Mac unzipped the download;
 * - several files at once, such as a Takeout export split into parts
 *   (takeout-…-001.zip, -002.zip), merged into one;
 * - a ZIP inside the ZIP (re-zipped downloads), one level down;
 * - a single history file (watch-history.json, liked_posts.json…).
 *
 * Only the files the cleaner reads are taken out, one at a time, into a small
 * in-memory ZIP that cleanArchive and detectPlatforms read unchanged. A ZIP is
 * read through its central directory with Blob.slice, so a large download
 * (photos and videos included) never has to fit in memory: only the history
 * files do. Downloads up to labStudy.maxDownloadBytes are accepted; the
 * cleaned file sent is still limited to labStudy.maxArchiveBytes.
 */

type JSZipCtor = typeof JSZip;

/** Largest single history file read out of a download. */
export const MAX_ENTRY_BYTES = 300 * 1024 * 1024;
/** JSON files tried as a renamed TikTok export when no user_data file is present (as findSources does). */
const MAX_TIKTOK_GUESSES = 5;
const MAX_TIKTOK_GUESS_BYTES = 50 * 1024 * 1024;

export type DownloadKind = 'zip' | 'gzip' | 'tar' | 'json' | 'html' | 'csv' | 'text' | 'unknown';

const norm = (n: string) => n.replace(/\\/g, '/').replace(/^\.?\//, '');
const baseName = (n: string) => norm(n).split('/').pop() ?? n;

/** What a file is, from its first bytes (at least 512 for a tar); the name only settles a CSV. */
export function sniffKind(head: Uint8Array, name = ''): DownloadKind {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && ((head[2] === 3 && head[3] === 4) || (head[2] === 5 && head[3] === 6) || (head[2] === 7 && head[3] === 8))) return 'zip';
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
  if (head.length >= 262 && String.fromCharCode(...head.subarray(257, 262)) === 'ustar') return 'tar';
  const sample = head.subarray(0, 512);
  if (!sample.length) return 'unknown';
  let printable = 0;
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || b >= 32) printable += 1;
  if (printable / sample.length < 0.95) return 'unknown';
  const text = new TextDecoder('utf-8').decode(sample).replace(/^﻿/, '').trimStart();
  if (/^[[{]/.test(text)) return 'json';
  if (/^<(!doctype|html|\?xml|div|body)/i.test(text)) return 'html';
  if (/\.csv$/i.test(name)) return 'csv';
  return 'text';
}

const YOUTUBE = [/(^|\/)history\/watch-history\.(json|html)$/i, /(^|\/)history\/search-history\.(json|html)$/i, /(^|\/)subscriptions\/subscriptions\.csv$/i];
const INSTAGRAM = [/ads_and_topics\/videos_watched\.json$/i, /ads_and_topics\/posts_viewed\.json$/i, /your_instagram_activity\/likes\/liked_posts\.json$/i, /recent_searches\/(profile_searches|word_or_phrase_searches)\.json$/i];
const INSTAGRAM_HTML = /your_instagram_activity\/.*\.html$/i;
const ARCHIVE_NAME = /\.(zip|tgz|tar\.gz|tar)$/i;

export type Need = 'keep' | 'marker' | 'tiktok-guess' | 'nested' | null;

/** Whether a file in a download is one the cleaner reads (the same rules as findSources). */
export function needOf(path: string): Need {
  const p = norm(path);
  if (/(^|\/)__MACOSX\//.test(p) || /(^|\/)\._/.test(p)) return null;
  if (YOUTUBE.some((r) => r.test(p)) || INSTAGRAM.some((r) => r.test(p))) return 'keep';
  if (/\.json$/i.test(p) && /user_data/i.test(p)) return 'keep';
  if (INSTAGRAM_HTML.test(p)) return 'marker';
  if (ARCHIVE_NAME.test(p)) return 'nested';
  if (/\.json$/i.test(p) && !/instagram|ads_and_topics|recent_searches/i.test(p)) return 'tiktok-guess';
  return null;
}

/** Where a single history file chosen on its own belongs, so the cleaner finds it; null when it is not one. */
export function placeLoose(name: string): string | null {
  const b = baseName(name);
  const yt = 'Takeout/YouTube and YouTube Music';
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^(watch-history|search-history)\.(json|html)$/i, (m) => `${yt}/history/${m[1].toLowerCase()}.${m[2].toLowerCase()}`],
    [/^subscriptions\.csv$/i, () => `${yt}/subscriptions/subscriptions.csv`],
    [/^videos_watched\.json$/i, () => 'ads_information/ads_and_topics/videos_watched.json'],
    [/^posts_viewed\.json$/i, () => 'ads_information/ads_and_topics/posts_viewed.json'],
    [/^liked_posts\.json$/i, () => 'your_instagram_activity/likes/liked_posts.json'],
    [/^(profile_searches|word_or_phrase_searches)\.json$/i, (m) => `logged_information/recent_searches/${m[1].toLowerCase()}.json`],
    [/user_data.*\.json$/i, () => b],
  ];
  for (const [re, to] of rules) {
    const m = b.match(re);
    if (m) return to(m);
  }
  return null;
}

/** The small ZIP of history files the cleaner reads, filled from one or more downloads. */
export class LeanDownload {
  readonly zip: JSZip;
  private guesses = 0;
  constructor(Ctor: JSZipCtor) {
    this.zip = new Ctor();
  }
  /** What to do with a file: read it, add an empty marker, or leave it. */
  wants(path: string, size: number): 'read' | 'marker' | false {
    const need = needOf(path);
    if (need === 'marker') return 'marker';
    if (need === 'keep') {
      if (size > MAX_ENTRY_BYTES) throw new DownloadError(`${baseName(path)} in your download is ${formatBytes(size)}, too large to read here. Please email ${labStudy.contact.name} at ${labStudy.contact.email}.`);
      return 'read';
    }
    if (need === 'tiktok-guess' && this.guesses < MAX_TIKTOK_GUESSES && size <= MAX_TIKTOK_GUESS_BYTES) {
      this.guesses += 1;
      return 'read';
    }
    return false;
  }
  put(path: string, data: Uint8Array | string) {
    this.zip.file(norm(path), data);
  }
  get count(): number {
    return Object.values(this.zip.files).filter((f) => !f.dir).length;
  }
  /** Files that hold data the cleaner reads (markers and TikTok guesses aside). */
  get recognised(): number {
    return Object.keys(this.zip.files).filter((n) => needOf(n) === 'keep').length + (Object.keys(this.zip.files).some((n) => needOf(n) === 'marker') ? 1 : 0);
  }
}

/** A message for the participant, shown as it is. */
export class DownloadError extends Error {}

/* ── ZIP, read through its central directory ────────────────────────────── */

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const bytesOf = async (blob: Blob, start: number, end: number) => new Uint8Array(await blob.slice(start, end).arrayBuffer());
const viewOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** The entries of a ZIP, from its central directory (ZIP64 included), without reading the rest. */
export async function zipEntries(blob: Blob): Promise<ZipEntry[]> {
  const tailLength = Math.min(blob.size, 65535 + 22 + 20);
  const tailStart = blob.size - tailLength;
  const tail = await bytesOf(blob, tailStart, blob.size);
  const t = viewOf(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (t.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DownloadError('This ZIP file is incomplete, often because the download did not finish. Please download it again.');
  let count = t.getUint16(eocd + 10, true);
  let cdSize = t.getUint32(eocd + 12, true);
  let cdOffset = t.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && t.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(t.getBigUint64(loc + 8, true));
      const z = viewOf(await bytesOf(blob, z64, z64 + 56));
      if (z.getUint32(0, true) === 0x06064b50) {
        count = Number(z.getBigUint64(32, true));
        cdSize = Number(z.getBigUint64(40, true));
        cdOffset = Number(z.getBigUint64(48, true));
      }
    }
  }
  // Bytes before the archive (a self-extracting stub) shift every offset by the same amount.
  const shift = Math.max(0, tailStart + eocd - cdSize - cdOffset);
  const cd = await bytesOf(blob, cdOffset + shift, cdOffset + shift + cdSize);
  const c = viewOf(cd);
  const out: ZipEntry[] = [];
  const utf8 = new TextDecoder('utf-8');
  const latin1 = new TextDecoder('latin1');
  let p = 0;
  while (p + 46 <= cd.length && c.getUint32(p, true) === 0x02014b50 && out.length < Math.max(count, 1) * 2 + 10) {
    const flags = c.getUint16(p + 8, true);
    const method = c.getUint16(p + 10, true);
    let compressedSize = c.getUint32(p + 20, true);
    let size = c.getUint32(p + 24, true);
    const nameLength = c.getUint16(p + 28, true);
    const extraLength = c.getUint16(p + 30, true);
    const commentLength = c.getUint16(p + 32, true);
    let offset = c.getUint32(p + 42, true);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLength);
    const name = (flags & 0x800 ? utf8 : /[\x80-\xff]/.test(latin1.decode(nameBytes)) ? utf8 : latin1).decode(nameBytes);
    // ZIP64 sizes and offset, in the extra field, for those set to 0xffffffff.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = c.getUint16(e, true);
      const len = c.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff && q + 8 <= e + 4 + len) (size = Number(c.getBigUint64(q, true))), (q += 8);
        if (compressedSize === 0xffffffff && q + 8 <= e + 4 + len) (compressedSize = Number(c.getBigUint64(q, true))), (q += 8);
        if (offset === 0xffffffff && q + 8 <= e + 4 + len) offset = Number(c.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    out.push({ name, method, flags, compressedSize, size, offset: offset + shift });
    p = extraEnd + commentLength;
  }
  if (!out.length && count > 0) throw new DownloadError('This ZIP file could not be read. Please download it again.');
  return out;
}

/** Whether this browser can unpack ZIP and gzip data as a stream. */
export function canStream(): boolean {
  try {
    new DecompressionStream('deflate-raw');
    new DecompressionStream('gzip');
    return true;
  } catch {
    return false;
  }
}

/** A stream unpacked as it is read. */
function decompress(stream: ReadableStream<Uint8Array>, format: 'gzip' | 'deflate-raw'): ReadableStream<Uint8Array> {
  return stream.pipeThrough(new DecompressionStream(format) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new DownloadError(`A file in your download is over ${formatBytes(limit)}, too large to read here. Please email ${labStudy.contact.name} at ${labStudy.contact.email}.`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** One entry's contents. */
export async function readZipEntry(blob: Blob, e: ZipEntry, limit = MAX_ENTRY_BYTES): Promise<Uint8Array> {
  if (e.flags & 1) throw new DownloadError('This ZIP file is password-protected. Please download it again without a password.');
  const local = viewOf(await bytesOf(blob, e.offset, e.offset + 30));
  if (local.getUint32(0, true) !== 0x04034b50) throw new DownloadError('This ZIP file could not be read. Please download it again.');
  const start = e.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const raw = blob.slice(start, start + e.compressedSize);
  if (e.method === 0) return new Uint8Array(await raw.arrayBuffer());
  if (e.method === 8) return collect(decompress(raw.stream() as ReadableStream<Uint8Array>, 'deflate-raw'), limit);
  throw new DownloadError('This ZIP file uses a kind of compression this page cannot read. Please download it again, or email the team.');
}

/** Copies the files the cleaner needs out of a ZIP; returns the archives found inside it, for a look one level down. */
export async function readZipInto(blob: Blob, lean: LeanDownload, Ctor: JSZipCtor): Promise<{ nested: { name: string; read: () => Promise<Blob> }[] }> {
  const nested: { name: string; read: () => Promise<Blob> }[] = [];
  if (!canStream()) {
    // Older browsers: the whole ZIP in memory, as before.
    const zip = await Ctor.loadAsync(blob);
    for (const f of Object.values(zip.files)) {
      if (f.dir) continue;
      if (needOf(f.name) === 'nested') {
        nested.push({ name: f.name, read: async () => new Blob([(await f.async('uint8array')) as BlobPart]) });
        continue;
      }
      const want = lean.wants(f.name, 0);
      if (want === 'marker') lean.put(f.name, '');
      else if (want === 'read') lean.put(f.name, await f.async('uint8array'));
    }
    return { nested };
  }
  for (const e of await zipEntries(blob)) {
    if (e.name.endsWith('/')) continue;
    if (needOf(e.name) === 'nested') {
      if (e.size <= labStudy.maxDownloadBytes) nested.push({ name: e.name, read: async () => new Blob([(await readZipEntry(blob, e, labStudy.maxDownloadBytes)) as BlobPart]) });
      continue;
    }
    const want = lean.wants(e.name, e.size);
    if (want === 'marker') lean.put(e.name, '');
    else if (want === 'read') lean.put(e.name, await readZipEntry(blob, e));
  }
  return { nested };
}

/* ── tar and gzip-compressed tar (Google Takeout's .tgz), as a stream ───── */

class ByteReader {
  private chunks: Uint8Array[] = [];
  private available = 0;
  private ended = false;
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}
  private async pull(): Promise<boolean> {
    if (this.ended) return false;
    const { done, value } = await this.reader.read();
    if (done) {
      this.ended = true;
      return false;
    }
    if (value.length) {
      this.chunks.push(value);
      this.available += value.length;
    }
    return true;
  }
  async has(n: number): Promise<boolean> {
    while (this.available < n) if (!(await this.pull())) return false;
    return true;
  }
  async read(n: number): Promise<Uint8Array> {
    if (!(await this.has(n))) throw new DownloadError('This download ends early, often because it did not finish downloading. Please download it again.');
    const out = new Uint8Array(n);
    let at = 0;
    while (at < n) {
      const head = this.chunks[0];
      const take = Math.min(head.length, n - at);
      out.set(head.subarray(0, take), at);
      at += take;
      if (take === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(take);
    }
    this.available -= n;
    return out;
  }
  /** Passes over n bytes without keeping them. */
  async skip(n: number): Promise<void> {
    let left = n;
    while (left > 0) {
      if (!this.available && !(await this.pull())) return;
      const head = this.chunks[0];
      const take = Math.min(head.length, left);
      left -= take;
      this.available -= take;
      if (take === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(take);
    }
  }
  async cancel() {
    await this.reader.cancel().catch(() => undefined);
  }
}

const cString = (b: Uint8Array) => {
  const end = b.indexOf(0);
  return new TextDecoder('utf-8').decode(end < 0 ? b : b.subarray(0, end));
};

function tarNumber(b: Uint8Array): number {
  if (b[0] & 0x80) {
    // Base-256, for sizes over 8 GB.
    let n = 0;
    for (let i = 1; i < b.length; i += 1) n = n * 256 + b[i];
    return n;
  }
  const s = cString(b).trim();
  return s ? parseInt(s, 8) : 0;
}

/** The path= record of a pax extended header, if any. */
export function paxPath(text: string): string | null {
  let p = 0;
  while (p < text.length) {
    const space = text.indexOf(' ', p);
    if (space < 0) break;
    const length = parseInt(text.slice(p, space), 10);
    if (!length) break;
    const record = text.slice(space + 1, p + length - 1);
    const eq = record.indexOf('=');
    if (record.slice(0, eq) === 'path') return record.slice(eq + 1);
    p += length;
  }
  return null;
}

/** Copies the files the cleaner needs out of a tar stream (ustar prefixes, GNU long names and pax paths understood). */
export async function readTarInto(stream: ReadableStream<Uint8Array>, lean: LeanDownload): Promise<void> {
  const r = new ByteReader(stream.getReader());
  let longName: string | null = null;
  let paxName: string | null = null;
  try {
    while (await r.has(512)) {
      const h = await r.read(512);
      if (h.every((x) => x === 0)) break;
      const name = cString(h.subarray(0, 100));
      const size = tarNumber(h.subarray(124, 136));
      const type = String.fromCharCode(h[156] || 48);
      const ustar = String.fromCharCode(...h.subarray(257, 262)) === 'ustar';
      const prefix = ustar ? cString(h.subarray(345, 500)) : '';
      const padded = Math.ceil(size / 512) * 512;
      if (type === 'L') {
        longName = cString(await r.read(size));
        await r.skip(padded - size);
        continue;
      }
      if (type === 'x') {
        paxName = paxPath(new TextDecoder('utf-8').decode(await r.read(size)));
        await r.skip(padded - size);
        continue;
      }
      const path = paxName ?? longName ?? (prefix ? `${prefix}/${name}` : name);
      longName = null;
      paxName = null;
      if (type === '0' || type === '7') {
        const want = lean.wants(path, size);
        if (want === 'read') {
          lean.put(path, await r.read(size));
          await r.skip(padded - size);
          continue;
        }
        if (want === 'marker') lean.put(path, '');
      }
      await r.skip(padded);
    }
  } finally {
    await r.cancel();
  }
}

/* ── one or more chosen files or a folder ──────────────────────────────── */

export interface ChosenFile {
  file: Blob;
  name: string;
  /** Its path inside a chosen folder (webkitRelativePath), when it came from one. */
  path?: string;
}

export interface ReadResult {
  zip: JSZip;
  /** What was chosen, for the page: a file name, "3 files" or a folder's name. */
  label: string;
}

const isMemoryError = (e: unknown) => e instanceof RangeError || /memory|allocation|array buffer|too large/i.test(String((e as Error)?.message ?? e));

/** A message for something chosen that cannot be read, or null when it can. */
export function downloadProblem(name: string, size: number, kind: DownloadKind): string | null {
  if (size > labStudy.maxDownloadBytes) return `${name} is ${formatBytes(size)}, over the ${formatBytes(labStudy.maxDownloadBytes)} this page can read, usually because it includes your photos or videos. Request it again with only the items the guide lists (it will be much smaller), or email ${labStudy.contact.name} at ${labStudy.contact.email}.`;
  if (kind === 'text' && /\.txt$/i.test(name)) return `${name} is a TXT file. Please request your TikTok data again and choose the JSON format.`;
  if (kind === 'unknown' || kind === 'text' || kind === 'csv') return `${name} isn't a ZIP or a Google Takeout .tgz download. Choose the file exactly as TikTok, Google Takeout or Instagram gave it to you (usually ending in .zip), without opening or converting it. If your computer unzipped it into a folder, use “My download is a folder”. If it still won't work, email ${labStudy.contact.name} at ${labStudy.contact.email}.`;
  return null;
}

/** The advice when a download held nothing the cleaner reads. */
function nothingFound(names: string[]): string {
  const part = names.map((n) => n.match(/takeout-.*-(\d{3})\.(zip|tgz)$/i)).find(Boolean);
  if (part) return `Google split your export into several parts, and part ${Number(part[1])} has no YouTube history in it. Choose all the parts together (you can select several files at once), and the page finds the YouTube data.`;
  return 'No TikTok, YouTube or Instagram data was recognised. Check you chose the download itself (not a photo or another file), and that it was requested in JSON format. For Google Takeout, if your export came in several parts, choose them all together.';
}

/** Reads what the participant chose (one or more files, or a folder's files) into the small ZIP the cleaner reads. */
export async function readDownload(chosen: ChosenFile[], Ctor: JSZipCtor, label?: string): Promise<ReadResult> {
  const lean = new LeanDownload(Ctor);
  const nested: { name: string; read: () => Promise<Blob> }[] = [];
  const archives: string[] = [];
  const problems: string[] = [];
  const fromFolder = chosen.some((c) => c.path && c.path.includes('/'));
  try {
    for (const c of chosen) {
      const path = c.path || c.name;
      // In a folder, files are taken by name: thousands of photos are never opened.
      if (fromFolder && needOf(path) !== 'nested') {
        const want = lean.wants(path, c.file.size);
        if (want === 'marker') lean.put(path, '');
        else if (want === 'read') lean.put(path, new Uint8Array(await c.file.arrayBuffer()));
        else {
          const placed = placeLoose(path);
          if (placed && !needOf(path)) lean.put(placed, new Uint8Array(await c.file.arrayBuffer()));
        }
        continue;
      }
      const kind = sniffKind(new Uint8Array(await c.file.slice(0, 512).arrayBuffer()), c.name);
      if (kind === 'json' || kind === 'html' || kind === 'csv') {
        const placed = placeLoose(c.name);
        if (placed) {
          if (c.file.size > MAX_ENTRY_BYTES) throw new DownloadError(`${c.name} is ${formatBytes(c.file.size)}, too large to read here. Please email ${labStudy.contact.name} at ${labStudy.contact.email}.`);
          lean.put(placed, new Uint8Array(await c.file.arrayBuffer()));
          continue;
        }
        if (kind === 'json' && c.file.size <= MAX_TIKTOK_GUESS_BYTES) {
          lean.put(baseName(c.name), new Uint8Array(await c.file.arrayBuffer()));
          continue;
        }
      }
      const problem = downloadProblem(c.name, c.file.size, kind === 'json' || kind === 'html' ? 'unknown' : kind);
      if (problem) {
        problems.push(problem);
        continue;
      }
      archives.push(c.name);
      if (kind === 'zip') nested.push(...(await readZipInto(c.file, lean, Ctor)).nested);
      else if (kind === 'gzip' || kind === 'tar') {
        if (!canStream()) throw new DownloadError('This browser cannot open a .tgz file. Please use an up-to-date Chrome, Edge, Firefox or Safari, or download your data again as a .zip.');
        const stream = c.file.stream() as ReadableStream<Uint8Array>;
        await readTarInto(kind === 'gzip' ? decompress(stream, 'gzip') : stream, lean);
      }
    }
    // A ZIP inside the ZIP, when nothing was found at the top: one level down.
    if (!lean.recognised && nested.length) {
      for (const n of nested.slice(0, 3)) {
        const blob = await n.read();
        const kind = sniffKind(new Uint8Array(await blob.slice(0, 512).arrayBuffer()), n.name);
        if (kind === 'zip') await readZipInto(blob, lean, Ctor);
        else if ((kind === 'gzip' || kind === 'tar') && canStream()) await readTarInto(kind === 'gzip' ? decompress(blob.stream() as ReadableStream<Uint8Array>, 'gzip') : (blob.stream() as ReadableStream<Uint8Array>), lean);
        if (lean.recognised) break;
      }
    }
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    if (isMemoryError(e)) throw new DownloadError('This device ran out of memory reading your download. Please try again on a computer, or request the download again with only the items the guide lists, so it is smaller.');
    throw new DownloadError(`Your download could not be read (${String((e as Error)?.message ?? e)}). Please download it again, or email ${labStudy.contact.name} at ${labStudy.contact.email}.`);
  }
  if (!lean.count) throw new DownloadError(problems[0] ?? nothingFound(archives.length ? archives : chosen.map((c) => c.name)));
  if (!lean.recognised && !Object.keys(lean.zip.files).some((n) => needOf(n) === 'tiktok-guess' || /user_data/i.test(n))) throw new DownloadError(problems[0] ?? nothingFound(archives.length ? archives : chosen.map((c) => c.name)));
  const folder = fromFolder ? (chosen[0].path ?? '').split('/')[0] : '';
  return { zip: lean.zip, label: label ?? (folder ? `the folder ${folder}` : chosen.length === 1 ? chosen[0].name : `${chosen.length} files`) };
}

/** The message when a cleaned file is over the upload limit, naming what to untick; null when it fits. */
export function cleanedTooLarge(size: number, files: { path: string; text: string }[]): string | null {
  if (size <= labStudy.maxArchiveBytes) return null;
  const names: Record<string, string> = {
    'tiktok_cleaned.json': 'TikTok Watch history',
    'youtube/history/watch-history.json': 'YouTube Watch history',
    'youtube/history/search-history.json': 'YouTube Search history',
    'youtube/subscriptions/subscriptions.csv': 'YouTube Subscriptions',
    'instagram/reels_watched.json': 'Instagram Reels watched',
    'instagram/posts_viewed.json': 'Instagram Posts viewed',
    'instagram/likes.json': 'Instagram Posts liked',
    'instagram/searches.json': 'Instagram Search history',
  };
  const biggest = [...files].filter((f) => names[f.path]).sort((a, b) => b.text.length - a.text.length)[0];
  return `The cleaned file is ${formatBytes(size)}, over the ${formatBytes(labStudy.maxArchiveBytes)} that can be sent.${biggest ? ` Untick “${names[biggest.path]}”, the largest part, and press “Keep these choices” again,` : ' Untick a large category and try again,'} or email ${labStudy.contact.name} at ${labStudy.contact.email}.`;
}

/** Whether this browser lets people choose a folder (not on iPhones and iPads). */
export function canChooseFolder(): boolean {
  if (typeof document === 'undefined') return false;
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  return !iOS && 'webkitdirectory' in document.createElement('input');
}
