import JSZip from 'jszip';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cleanArchive, detectPlatforms } from './cleaner';
import { labStudy } from './config';
import { cleanedTooLarge, downloadProblem, needOf, paxPath, placeLoose, readDownload, sniffKind, zipEntries, type ChosenFile } from './download';

const enc = new TextEncoder();
const watch = JSON.stringify([{ header: 'YouTube', title: 'Watched How brains work', titleUrl: 'https://www.youtube.com/watch?v=abc', subtitles: [{ name: 'Brain Channel', url: 'https://www.youtube.com/channel/UC1' }], time: '2026-10-01T14:01:48.000Z', products: ['YouTube'] }]);
const subs = 'Channel Id,Channel Url,Channel Title\nUC1,http://www.youtube.com/channel/UC1,Brain Channel\n';
const igLikes = JSON.stringify({ likes_media_likes: [{ title: 'someone', string_list_data: [{ href: 'https://www.instagram.com/p/1/', timestamp: 1759320000 }] }] });
const YT = 'Takeout/YouTube and YouTube Music';
const junk = (n: number) => new Uint8Array(n).fill(7);

const blobOf = (b: Uint8Array) => new Blob([b as BlobPart]);
async function zipBytes(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [k, v] of Object.entries(files)) z.file(k, v);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
const files = (z: JSZip) => Object.keys(z.files).filter((n) => !z.files[n].dir);
const chosen = (name: string, bytes: Uint8Array, path?: string): ChosenFile => ({ file: blobOf(bytes), name, path });

/** One tar entry: a 512-byte header (ustar), then the data padded to 512. */
function tarEntry(name: string, data: Uint8Array, type = '0', prefix = ''): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number) => h.set(enc.encode(s), at);
  put(name.slice(0, 100), 0);
  put('0000644\0', 100);
  put('0000000\0', 108);
  put('0000000\0', 116);
  put(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  put('00000000000\0', 136);
  put('        ', 148);
  put(type, 156);
  put('ustar\0', 257);
  put('00', 263);
  if (prefix) put(prefix, 345);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const out = new Uint8Array(512 + Math.ceil(data.length / 512) * 512);
  out.set(h, 0);
  out.set(data, 512);
  return out;
}
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};
function longNameEntry(path: string, data: Uint8Array): Uint8Array {
  const name = enc.encode(`${path}\0`);
  return concat([tarEntry('././@LongLink', name, 'L'), tarEntry(path.slice(0, 99), data)]);
}
function paxEntry(path: string, data: Uint8Array): Uint8Array {
  const body = ` path=${path}\n`;
  let len = body.length;
  len += String(len + String(len).length).length;
  const record = enc.encode(`${len}${body}`);
  return concat([tarEntry('PaxHeader', record, 'x'), tarEntry('short-name', data)]);
}

describe('recognising a download', () => {
  it('reads the kind from the first bytes, whatever the name', async () => {
    expect(sniffKind(await zipBytes({ a: 'b' }), 'Takeout')).toBe('zip');
    expect(sniffKind(gzipSync(Buffer.from('x')))).toBe('gzip');
    expect(sniffKind(tarEntry('a.txt', enc.encode('hi')))).toBe('tar');
    expect(sniffKind(enc.encode('﻿  {"a":1}'))).toBe('json');
    expect(sniffKind(enc.encode('<html><body>'))).toBe('html');
    expect(sniffKind(enc.encode('Date: 2026\nLink: x'), 'user_data.txt')).toBe('text');
    expect(sniffKind(new Uint8Array([0, 1, 2, 3, 200, 201, 0, 0, 9]))).toBe('unknown');
  });

  it('knows which files the cleaner reads', () => {
    expect(needOf(`${YT}/history/watch-history.json`)).toBe('keep');
    expect(needOf('your_instagram_activity/likes/liked_posts.json')).toBe('keep');
    expect(needOf('your_instagram_activity/likes/liked_posts.html')).toBe('marker');
    expect(needOf('media/posts/202610/photo.jpg')).toBeNull();
    expect(needOf('__MACOSX/Takeout/._watch-history.json')).toBeNull();
    expect(needOf('inner/takeout-2026-001.zip')).toBe('nested');
    expect(placeLoose('Watch-History.json')).toBe(`${YT}/history/watch-history.json`);
    expect(placeLoose('liked_posts.json')).toBe('your_instagram_activity/likes/liked_posts.json');
    expect(placeLoose('holiday.jpg')).toBeNull();
  });

  it('refuses over the size limit and names TXT exports', () => {
    expect(downloadProblem('big.zip', labStudy.maxDownloadBytes + 1, 'zip')).toMatch(/over the 1024\.0 MB/);
    expect(downloadProblem('big.zip', 145_000_000, 'zip')).toBeNull();
    expect(downloadProblem('user_data.txt', 100, 'text')).toMatch(/TXT file/);
    expect(downloadProblem('photo.heic', 100, 'unknown')).toMatch(/isn't a ZIP or a Google Takeout \.tgz/);
  });
});

describe('reading a ZIP', () => {
  it('takes only the history files out of a large download with no .zip name', async () => {
    const bytes = await zipBytes({ [`${YT}/history/watch-history.json`]: watch, [`${YT}/subscriptions/subscriptions.csv`]: subs, [`${YT}/videos/holiday.mp4`]: junk(3_000_000) });
    const { zip, label } = await readDownload([chosen('Takeout', bytes)], JSZip);
    expect(label).toBe('Takeout');
    expect(files(zip).sort()).toEqual([`${YT}/history/watch-history.json`, `${YT}/subscriptions/subscriptions.csv`]);
    expect(await detectPlatforms(zip)).toEqual(['youtube']);
    expect((await cleanArchive(zip)).report.kept.yt_subs).toBe(1);
  });

  it('lists entries from the central directory', async () => {
    const entries = await zipEntries(blobOf(await zipBytes({ 'a.json': '{}', 'b/c.txt': 'x' })));
    expect(entries.map((e) => e.name)).toEqual(['a.json', 'b/', 'b/c.txt']);
  });

  it('looks inside a ZIP within the ZIP', async () => {
    const inner = await zipBytes({ 'your_instagram_activity/likes/liked_posts.json': igLikes });
    const outer = await zipBytes({ 'instagram-export.zip': inner });
    const { zip } = await readDownload([chosen('download.zip', outer)], JSZip);
    expect(await detectPlatforms(zip)).toEqual(['instagram']);
  });

  it('merges a Takeout export split into parts, and says so when only a part without YouTube is chosen', async () => {
    const part1 = await zipBytes({ 'Takeout/Google Photos/a.jpg': junk(1000) });
    const part2 = await zipBytes({ [`${YT}/history/watch-history.json`]: watch });
    await expect(readDownload([chosen('takeout-20261101T100000Z-001.zip', part1)], JSZip)).rejects.toThrow(/split your export into several parts, and part 1/);
    const { zip, label } = await readDownload([chosen('takeout-20261101T100000Z-001.zip', part1), chosen('takeout-20261101T100000Z-002.zip', part2)], JSZip);
    expect(label).toBe('2 files');
    expect(await detectPlatforms(zip)).toEqual(['youtube']);
  });
});

describe('reading a Google Takeout .tgz', () => {
  it('streams the tar, with long names, ustar prefixes and pax paths', async () => {
    const longPath = `${YT}/history/${'deep/'.repeat(20)}history/watch-history.json`;
    const tar = concat([
      tarEntry('holiday.mp4', junk(200_000), '0', `${YT}/videos`),
      longNameEntry(longPath, enc.encode(watch)),
      tarEntry('subscriptions.csv', enc.encode(subs), '0', `${YT}/subscriptions`),
      paxEntry(`${YT}/history/search-history.json`, enc.encode('[]')),
      new Uint8Array(1024),
    ]);
    const { zip } = await readDownload([chosen('takeout-20261101T100000Z-001.tgz', new Uint8Array(gzipSync(tar)))], JSZip);
    expect(files(zip).sort()).toEqual([`${YT}/history/search-history.json`, `${YT}/subscriptions/subscriptions.csv`, longPath].sort());
    expect(await detectPlatforms(zip)).toEqual(['youtube']);
  });

  it('reads pax path records', () => {
    expect(paxPath('31 path=a/b/watch-history.json\n')).toBe('a/b/watch-history.json');
    expect(paxPath('20 mtime=1700000000\n')).toBeNull();
  });
});

describe('reading a folder or a single file', () => {
  it('takes the needed files from an unzipped folder by name', async () => {
    const files = [
      chosen('watch-history.json', enc.encode(watch), `Takeout/YouTube and YouTube Music/history/watch-history.json`),
      chosen('holiday.mp4', junk(10_000), 'Takeout/YouTube and YouTube Music/videos/holiday.mp4'),
      chosen('liked_posts.json', enc.encode(igLikes), 'instagram-me/your_instagram_activity/likes/liked_posts.json'),
    ];
    const { zip, label } = await readDownload(files, JSZip);
    expect(label).toBe('the folder Takeout');
    expect((await detectPlatforms(zip)).sort()).toEqual(['instagram', 'youtube']);
    expect(Object.keys(zip.files).some((n) => n.endsWith('.mp4'))).toBe(false);
  });

  it('places a history file chosen on its own', async () => {
    const { zip } = await readDownload([chosen('watch-history.json', enc.encode(watch))], JSZip);
    expect(await detectPlatforms(zip)).toEqual(['youtube']);
  });

  it('turns away a photo with advice, and a download over the limit before reading it', async () => {
    await expect(readDownload([chosen('IMG_0001.HEIC', new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 0, 0, 200, 201]))], JSZip)).rejects.toThrow(/isn't a ZIP/);
    const head = await zipBytes({ a: 'b' });
    const huge = { size: labStudy.maxDownloadBytes + 10, slice: () => blobOf(head) } as unknown as Blob;
    await expect(readDownload([{ file: huge, name: 'instagram.zip' }], JSZip)).rejects.toThrow(/over the/);
  });
});

describe('the cleaned file', () => {
  it('names the largest category when it is over the upload limit', () => {
    expect(cleanedTooLarge(1000, [])).toBeNull();
    const files = [
      { path: 'instagram/likes.json', text: 'x'.repeat(10) },
      { path: 'instagram/reels_watched.json', text: 'x'.repeat(100) },
      { path: 'manifest.json', text: 'x'.repeat(1000) },
    ];
    expect(cleanedTooLarge(labStudy.maxArchiveBytes + 1, files)).toMatch(/Untick “Instagram Reels watched”/);
  });
});
