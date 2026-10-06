import type JSZip from 'jszip';

/**
 * In-browser cleaning of a TikTok or YouTube data export before it is
 * donated. Nothing here touches the network: the participant's ZIP is read
 * on their own device, only the categories they tick are kept, and the
 * fields inside each category are reduced to what the study needs (dates,
 * links, search terms). Everything else is dropped.
 *
 * Ported from the lab team's single-file cleaner (clean_data_donation); the
 * output file names are unchanged so the server's allow-list recognises
 * them. Works in the browser and in Node (the Takeout HTML parser does not
 * need a DOM), so the rules are unit-tested.
 */

export type Platform = 'tiktok' | 'youtube';
export type CategoryId = 'tt_watch' | 'tt_search' | 'tt_engage' | 'tt_login' | 'tt_counts' | 'yt_watch' | 'yt_search' | 'yt_subs';

export interface Category {
  id: CategoryId;
  platform: Platform;
  title: string;
  detail: string;
  /** Worth a second thought before sharing (search terms). */
  sensitive?: boolean;
}

export const categories: Category[] = [
  { id: 'tt_watch', platform: 'tiktok', title: 'Watch history', detail: 'Which videos you watched and when (link and time only)' },
  { id: 'tt_search', platform: 'tiktok', title: 'Search history', detail: 'The words you searched for and when', sensitive: true },
  { id: 'tt_engage', platform: 'tiktok', title: 'Likes, reposts and shares', detail: 'Which videos, and when' },
  { id: 'tt_login', platform: 'tiktok', title: 'App open times', detail: 'When you opened the app (no device or network details)' },
  { id: 'tt_counts', platform: 'tiktok', title: 'Activity totals', detail: 'Just numbers, such as how many comments you have made; no content' },
  { id: 'yt_watch', platform: 'youtube', title: 'Watch history', detail: 'Video title, link, channel and when you watched' },
  { id: 'yt_search', platform: 'youtube', title: 'Search history', detail: 'The words you searched for and when', sensitive: true },
  { id: 'yt_subs', platform: 'youtube', title: 'Subscriptions', detail: 'The channels you follow' },
];

export const alwaysRemoved: Record<Platform, string[]> = {
  tiktok: ['Direct messages', 'Location and GPS', 'Device IDs and IP addresses', 'TikTok Shop', 'Wallet', 'Profile, followers and contacts', 'Comment text', 'Uploaded videos'],
  youtube: ['Uploaded videos', 'Comments', 'Video metadata', 'Channel settings', 'Music library', 'Playables', 'Clips', 'Playlists'],
};

export const platformNames: Record<Platform, string> = { tiktok: 'TikTok', youtube: 'YouTube' };

/** Written into every cleaned archive so the team knows how it was made. */
export const CLEANER_VERSION = '1.0';

export interface CleanReport {
  platforms: Platform[];
  /** Rows kept per category (only categories that were on). */
  kept: Partial<Record<CategoryId, number>>;
  removed: string[];
}

export interface CleanedFile {
  path: string;
  text: string;
}

export interface PreviewRow {
  kind: 'Watched' | 'Searched';
  when: string;
  what: string;
}

export interface CleanResult {
  files: CleanedFile[];
  report: CleanReport;
  preview: PreviewRow[];
}

type Json = Record<string, unknown>;
type Row = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keeps only the allowed keys (case-insensitive) of each object in a list; anything else is dropped. */
export function keepFields(rows: unknown, allowed: string[]): Row[] {
  const low = allowed.map((a) => a.toLowerCase());
  if (!Array.isArray(rows)) return [];
  const out: Row[] = [];
  for (const it of rows) {
    if (!isObj(it)) continue;
    const row: Row = {};
    for (const k of Object.keys(it)) if (low.includes(k.toLowerCase())) row[k] = it[k];
    out.push(row);
  }
  return out;
}

/** Counts the objects nested anywhere inside a value. */
export function deepCount(o: unknown): number {
  let n = 0;
  if (Array.isArray(o)) for (const x of o) {
    if (isObj(x)) n += 1;
    n += deepCount(x);
  }
  else if (isObj(o)) for (const k of Object.keys(o)) n += deepCount(o[k]);
  return n;
}

function get(d: unknown, ...path: string[]): unknown {
  let cur: unknown = d;
  for (const key of path) {
    if (!isObj(cur) || !(key in cur)) return null;
    cur = cur[key];
  }
  return cur;
}

/* ── TikTok ─────────────────────────────────────────────────────────────── */

export function isTikTokExport(data: unknown): data is Json {
  return isObj(data) && ('Your Activity' in data || 'Direct Message' in data || 'Likes and Favorites' in data);
}

export function cleanTikTok(data: Json, on: Set<CategoryId>): { json: Json; kept: Partial<Record<CategoryId, number>> } {
  const ya = (data['Your Activity'] ?? {}) as Json;
  const lf = (data['Likes and Favorites'] ?? {}) as Json;
  const activity: Json = {};
  const kept: Partial<Record<CategoryId, number>> = {};
  if (on.has('tt_watch')) {
    activity.WatchHistory = keepFields(get(ya, 'Watch History', 'VideoList'), ['Date', 'Link']);
    kept.tt_watch = (activity.WatchHistory as Row[]).length;
  }
  if (on.has('tt_search')) {
    activity.Searches = keepFields(get(ya, 'Searches', 'SearchList'), ['Date', 'SearchTerm']);
    kept.tt_search = (activity.Searches as Row[]).length;
  }
  if (on.has('tt_engage')) {
    activity.Reposts = keepFields(get(ya, 'Reposts', 'RepostList'), ['Date', 'Link']);
    activity.Shares = keepFields(get(ya, 'Share History', 'ShareHistoryList'), ['Date', 'Link', 'Method']);
    activity.Likes = keepFields(get(lf, 'Like List', 'ItemFavoriteList'), ['date', 'link']);
    kept.tt_engage = (activity.Reposts as Row[]).length + (activity.Shares as Row[]).length + (activity.Likes as Row[]).length;
  }
  if (on.has('tt_login')) {
    activity.LoginTimestamps = keepFields(get(ya, 'Login History', 'LoginHistoryList'), ['Date']);
    kept.tt_login = (activity.LoginTimestamps as Row[]).length;
  }
  const json: Json = { _note: 'Cleaned on the participant’s own device before donation. Personal content removed.', Activity: activity };
  if (on.has('tt_counts')) {
    const counts: Record<string, number> = {};
    for (const section of Object.keys(data)) counts[section] = deepCount(data[section]);
    json.AggregateCounts = counts;
    kept.tt_counts = Object.keys(counts).length;
  }
  return { json, kept };
}

/* ── YouTube ────────────────────────────────────────────────────────────── */

export interface YtEntry {
  header?: string;
  title?: string;
  titleUrl?: string;
  subtitles?: { name: string; url: string }[];
  time?: string;
  [key: string]: unknown;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/**
 * Google Takeout can export history as HTML instead of JSON. This turns it
 * into the same shape as the JSON, without needing a DOM: each entry is an
 * "outer-cell" whose first "content-cell" holds "Watched <a>title</a><br><a>channel</a><br>time".
 */
export function parseYtHtml(html: string): YtEntry[] {
  const rows: YtEntry[] = [];
  const cells = html.split(/<div[^>]+class="[^"]*\bouter-cell\b/).slice(1);
  for (const cell of cells) {
    const open = cell.search(/<div[^>]+class="[^"]*\bcontent-cell\b[^"]*"[^>]*>/);
    if (open < 0) continue;
    const afterOpen = cell.indexOf('>', open) + 1;
    const close = cell.indexOf('</div>', afterOpen);
    const inner = cell.slice(afterOpen, close < 0 ? undefined : close);
    const texts: string[] = [];
    const links: { name: string; url: string }[] = [];
    const token = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<[^>]+>|([^<]+)/g;
    let m: RegExpExecArray | null;
    while ((m = token.exec(inner))) {
      if (m[1] !== undefined) links.push({ name: decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(), url: decodeEntities(m[1]) });
      else if (m[3] !== undefined) {
        const t = decodeEntities(m[3]).replace(/\s+/g, ' ').trim();
        if (t) texts.push(t);
      }
    }
    if (!texts.length && !links.length) continue;
    const time = texts.length > 1 ? texts[texts.length - 1] : '';
    const lead = texts[0] ?? '';
    const row: YtEntry = { header: 'YouTube' };
    if (links.length) {
      row.title = `${lead} ${links[0].name}`.trim();
      row.titleUrl = links[0].url;
      if (links.length > 1) row.subtitles = [{ name: links[1].name, url: links[1].url }];
    } else row.title = lead;
    if (time) row.time = time;
    rows.push(row);
  }
  return rows;
}

function readYt(name: string, text: string): YtEntry[] {
  if (/\.html$/i.test(name)) return parseYtHtml(text);
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? (parsed as YtEntry[]) : [];
}

export const cleanYtWatch = (entries: YtEntry[]) => keepFields(entries, ['header', 'title', 'titleUrl', 'subtitles', 'time']);
export const cleanYtSearch = (entries: YtEntry[]) => keepFields(entries, ['header', 'title', 'titleUrl', 'time']);

/* ── Archive handling ───────────────────────────────────────────────────── */

export interface ArchiveSources {
  tiktokJson: string | null;
  ytWatch: string | null;
  ytSearch: string | null;
  ytSubs: string | null;
  /** JSON files to try when no obvious TikTok file is present. */
  otherJson: string[];
}

const norm = (n: string) => n.replace(/\\/g, '/');

export function findSources(zip: JSZip): ArchiveSources {
  const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !/(^|\/)__MACOSX\//.test(n));
  const lower = (n: string) => n.toLowerCase();
  return {
    tiktokJson: files.find((n) => lower(n).endsWith('.json') && lower(n).includes('user_data')) ?? null,
    ytWatch: files.find((n) => /history\/watch-history\.(json|html)$/i.test(norm(n))) ?? null,
    ytSearch: files.find((n) => /history\/search-history\.(json|html)$/i.test(norm(n))) ?? null,
    ytSubs: files.find((n) => /subscriptions\/subscriptions\.csv$/i.test(norm(n))) ?? null,
    otherJson: files.filter((n) => lower(n).endsWith('.json') && !lower(n).includes('user_data')).slice(0, 5),
  };
}

/** Which platforms an archive holds, without cleaning it yet. */
export async function detectPlatforms(zip: JSZip): Promise<Platform[]> {
  const src = findSources(zip);
  const platforms: Platform[] = [];
  if (src.tiktokJson) platforms.push('tiktok');
  else {
    for (const name of src.otherJson) {
      try {
        const text = await zip.file(name)!.async('string');
        if (text.length < 200 * 1024 * 1024 && isTikTokExport(JSON.parse(text))) {
          platforms.push('tiktok');
          break;
        }
      } catch {
        /* not it */
      }
    }
  }
  if (src.ytWatch || src.ytSearch || src.ytSubs) platforms.push('youtube');
  return platforms;
}

const allCategories = new Set<CategoryId>(categories.map((c) => c.id));

/** Cleans the archive, keeping only the categories that are on (all of them when none are given). */
export async function cleanArchive(zip: JSZip, on: Set<CategoryId> = allCategories): Promise<CleanResult> {
  const src = findSources(zip);
  const files: CleanedFile[] = [];
  const report: CleanReport = { platforms: [], kept: {}, removed: [] };
  const preview: PreviewRow[] = [];

  const tryTikTok = async (name: string): Promise<boolean> => {
    const text = await zip.file(name)!.async('string');
    const data: unknown = JSON.parse(text);
    if (!isTikTokExport(data)) return false;
    report.platforms.push('tiktok');
    const res = cleanTikTok(data, on);
    Object.assign(report.kept, res.kept);
    report.removed.push(...alwaysRemoved.tiktok);
    files.push({ path: 'tiktok_cleaned.json', text: JSON.stringify(res.json, null, 1) });
    const act = res.json.Activity as Json;
    for (const x of ((act.WatchHistory as Row[] | undefined) ?? []).slice(0, 3)) preview.push({ kind: 'Watched', when: String(x.Date ?? ''), what: String(x.Link ?? '') });
    for (const x of ((act.Searches as Row[] | undefined) ?? []).slice(0, 3)) preview.push({ kind: 'Searched', when: String(x.Date ?? ''), what: String(x.SearchTerm ?? '') });
    return true;
  };
  if (src.tiktokJson) await tryTikTok(src.tiktokJson);
  else {
    for (const name of src.otherJson) {
      try {
        if (await tryTikTok(name)) break;
      } catch {
        /* not a TikTok file */
      }
    }
  }

  if (src.ytWatch || src.ytSearch || src.ytSubs) {
    report.platforms.push('youtube');
    report.removed.push(...alwaysRemoved.youtube);
    if (src.ytWatch && on.has('yt_watch')) {
      const rows = cleanYtWatch(readYt(src.ytWatch, await zip.file(src.ytWatch)!.async('string')));
      files.push({ path: 'youtube/history/watch-history.json', text: JSON.stringify(rows, null, 1) });
      report.kept.yt_watch = rows.length;
      for (const x of rows.slice(0, 3)) preview.push({ kind: 'Watched', when: String(x.time ?? ''), what: `${String(x.title ?? '')}${x.titleUrl ? ` · ${String(x.titleUrl)}` : ''}` });
    }
    if (src.ytSearch && on.has('yt_search')) {
      const rows = cleanYtSearch(readYt(src.ytSearch, await zip.file(src.ytSearch)!.async('string')));
      files.push({ path: 'youtube/history/search-history.json', text: JSON.stringify(rows, null, 1) });
      report.kept.yt_search = rows.length;
      for (const x of rows.slice(0, 3)) preview.push({ kind: 'Searched', when: String(x.time ?? ''), what: String(x.title ?? '').replace(/^Searched for /, '') });
    }
    if (src.ytSubs && on.has('yt_subs')) {
      const text = await zip.file(src.ytSubs)!.async('string');
      files.push({ path: 'youtube/subscriptions/subscriptions.csv', text });
      report.kept.yt_subs = Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1);
    }
  }

  if (!report.platforms.length) throw new Error('No TikTok or YouTube data was recognised in this file.');
  files.push({
    path: 'manifest.json',
    text: JSON.stringify({ cleanedAt: new Date().toISOString(), cleaner: `MyPhone/MyBrain data donation cleaner ${CLEANER_VERSION}`, platforms: report.platforms, categories: Array.from(on).filter((c) => report.platforms.includes(categories.find((x) => x.id === c)!.platform)), kept: report.kept, removed: report.removed }, null, 1),
  });
  return { files, report, preview };
}

/** The file names a cleaned archive may contain; the server refuses anything else. */
export const ALLOWED_CLEANED_FILES = ['manifest.json', 'tiktok_cleaned.json', 'youtube/history/watch-history.json', 'youtube/history/search-history.json', 'youtube/subscriptions/subscriptions.csv'];

export function cleanedArchiveName(platforms: Platform[]): string {
  return `${platforms.join('_')}_cleaned_donation.zip`;
}

/** Packs the cleaned files into a new ZIP (as a Blob in the browser, a Buffer in Node). */
export async function buildCleanedZip(JSZipCtor: typeof JSZip, files: CleanedFile[], type: 'blob' | 'nodebuffer' = 'blob'): Promise<Blob | Buffer> {
  const out = new JSZipCtor();
  for (const f of files) out.file(f.path, f.text);
  return out.generateAsync({ type, compression: 'DEFLATE' }) as Promise<Blob | Buffer>;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
