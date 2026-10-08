import { getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { createHash } from 'node:crypto';
import { ALLOWED_ORIGINS } from './enquiry.js';
import { addDays, ukDate } from './ukTime.js';

/**
 * How people use the website, so the team can see where they get stuck and
 * what to make easier (asked for on 7 October 2026). The site's pages
 * (assets/js/usage.js) and the family form and break study apps send, every
 * so often while a page is open and once more when it is left: which page,
 * how long it has been actively read, how far down it was scrolled, how long
 * each part (a section of a page, or a step of a form) was being read, the
 * links followed, and which fields a form said needed fixing. One record per
 * page view, in usage/{view}, where the view is a random number made for that
 * page load and kept nowhere else.
 *
 * Nothing in it identifies anyone: no cookies or anything else stored on the
 * device, no IP address (the rate limit keeps a hash of it in memory only),
 * nothing about the browser beyond phone, tablet or computer, no form
 * answers, and no participant IDs or reference codes (a link's query string
 * is cut down to a few known switches before it is sent, and again here).
 * Records are deleted after a year. Anyone can turn it off on the privacy
 * page, and browsers that send Global Privacy Control or Do Not Track send
 * nothing.
 */

const REGION = 'europe-west2';
export const USAGE_RETENTION_DAYS = 365;
const MAX_EVENTS = 300;
const MAX_SECONDS = 86_400;
const PART = /^[A-Za-z0-9>:_-]{1,60}$/;
const PATH = /^\/[A-Za-z0-9\-_/.]{0,119}$/;
const VIEW = /^[a-z0-9]{12,32}$/;
const LINK = /^(\/[A-Za-z0-9\-_/.]{0,119}(\?[A-Za-z0-9=&-]{0,80})?(#[A-Za-z0-9\-_]{0,60})?|#[A-Za-z0-9\-_]{1,60}|ext:[a-z0-9.-]{1,100}|mailto|tel)$/;
const FIELD = /^[A-Za-z0-9_-]{1,60}$/;
const VARIANT = /^[a-z-]{1,20}$/;
/** The only parts of a link's query string kept: switches that say which way into a form someone came, never codes or names. */
export const QUERY_KEYS: Record<string, RegExp> = {
  who: /^(parent|young)$/,
  school: /^[a-z0-9-]{1,30}$/,
  optout: /^1$/,
  finish: /^yes$/,
  flow: /^[a-z]{1,12}$/,
  phase: /^(pre|mid|post)$/,
  step: /^guide$/,
  at: /^lab$/,
  for: /^young$/,
};
const APPS = ['family', 'break'] as const;
const DEVICES = ['phone', 'tablet', 'computer'] as const;

export interface UsageEvent {
  /** Seconds after the page opened. */
  t: number;
  type: 'click' | 'errors' | 'save-failed';
  /** The part being read when it happened. */
  part: string | null;
  /** A link followed: a path on this site, #section, ext:host, mailto or tel. */
  to?: string;
  label?: string;
  /** The fields a form listed as needing fixing (their ids, never what was typed). */
  fields?: string[];
}

export interface UsageBatch {
  view: string;
  seq: number;
  final: boolean;
  page: string;
  query: Record<string, string>;
  ref: string;
  device: (typeof DEVICES)[number];
  app: (typeof APPS)[number] | null;
  variant: string | null;
  /** Seconds the page was being read (visible, and used in the last minute). */
  active: number;
  /** How far down the page was scrolled, 0 to 100. */
  scroll: number;
  /** Seconds each part was being read. */
  parts: Record<string, number>;
  /** The parts, in the order they were first read. */
  order: string[];
  events: UsageEvent[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const seconds = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_SECONDS ? Math.round(v * 10) / 10 : null);
const plainText = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : null);

/** Checks one batch from a page and returns the clean record, or what is wrong with it. */
export function validateUsage(input: unknown): { problems: string[]; data: UsageBatch | null } {
  const problems: string[] = [];
  if (!isObj(input) || input.v !== 1) return { problems: ['Not a usage record.'], data: null };
  const view = typeof input.view === 'string' && VIEW.test(input.view) ? input.view : null;
  if (!view) problems.push('The view is malformed.');
  const seq = Number.isInteger(input.seq) && (input.seq as number) >= 0 && (input.seq as number) <= 10_000 ? (input.seq as number) : null;
  if (seq === null) problems.push('The sequence number is malformed.');
  const page = typeof input.page === 'string' && PATH.test(input.page) ? input.page : null;
  if (!page) problems.push('The page is malformed.');

  const query: Record<string, string> = {};
  if (input.query !== undefined && !isObj(input.query)) problems.push('The query is malformed.');
  else if (isObj(input.query)) {
    for (const [key, value] of Object.entries(input.query)) {
      if (typeof value === 'string' && QUERY_KEYS[key]?.test(value)) query[key] = value;
    }
  }
  const ref = input.ref === '' || input.ref === undefined ? '' : typeof input.ref === 'string' && (PATH.test(input.ref) || /^ext:[a-z0-9.-]{1,100}$/.test(input.ref)) ? input.ref : null;
  if (ref === null) problems.push('The referrer is malformed.');
  const device = DEVICES.find((d) => d === input.device) ?? null;
  if (!device) problems.push('The device is malformed.');
  const app = input.app === null || input.app === undefined || input.app === '' ? null : (APPS.find((a) => a === input.app) ?? undefined);
  if (app === undefined) problems.push('Unknown app.');
  const variant = input.variant === null || input.variant === undefined || input.variant === '' ? null : typeof input.variant === 'string' && VARIANT.test(input.variant) ? input.variant : undefined;
  if (variant === undefined) problems.push('The variant is malformed.');
  const active = seconds(input.active);
  if (active === null) problems.push('The active time is malformed.');
  const scroll = typeof input.scroll === 'number' && Number.isFinite(input.scroll) && input.scroll >= 0 && input.scroll <= 100 ? Math.round(input.scroll) : null;
  if (scroll === null) problems.push('The scroll depth is malformed.');

  const parts: Record<string, number> = {};
  if (!isObj(input.parts) || Object.keys(input.parts).length > 60) problems.push('The parts are malformed.');
  else {
    for (const [key, value] of Object.entries(input.parts)) {
      const s = seconds(value);
      if (!PART.test(key) || s === null) {
        problems.push('A part is malformed.');
        break;
      }
      parts[key] = s;
    }
  }
  const order = Array.isArray(input.order) && input.order.length <= 80 && input.order.every((p) => typeof p === 'string' && PART.test(p)) ? Array.from(new Set(input.order as string[])) : null;
  if (!order) problems.push('The order is malformed.');

  const events: UsageEvent[] = [];
  if (!Array.isArray(input.events) || input.events.length > 50) problems.push('The events are malformed.');
  else {
    for (const e of input.events) {
      const t = isObj(e) ? seconds(e.t) : null;
      const part = isObj(e) && typeof e.part === 'string' && PART.test(e.part) ? e.part : null;
      if (!isObj(e) || t === null) {
        problems.push('An event is malformed.');
        break;
      }
      if (e.type === 'click' && typeof e.to === 'string' && LINK.test(e.to)) {
        events.push({ t, type: 'click', part, to: e.to, label: plainText(e.label, 60) ?? '' });
      } else if (e.type === 'errors' && Array.isArray(e.fields) && e.fields.length >= 1 && e.fields.length <= 20 && e.fields.every((f) => typeof f === 'string' && FIELD.test(f))) {
        events.push({ t, type: 'errors', part, fields: Array.from(new Set(e.fields as string[])) });
      } else if (e.type === 'save-failed') {
        events.push({ t, type: 'save-failed', part });
      } else {
        problems.push('An event is malformed.');
        break;
      }
    }
  }
  if (problems.length || !view || seq === null || !page || ref === null || !device || app === undefined || variant === undefined || active === null || scroll === null || !order) return { problems, data: null };
  return { problems: [], data: { view, seq, final: input.final === true, page, query, ref, device, app, variant, active, scroll, parts, order, events } };
}

/**
 * One page view's record after a batch: the first batch fixes the page, where
 * it came from and the device; later batches carry running totals, so the
 * larger of the old and new value is kept (batches can arrive out of order),
 * and each batch's events are added once.
 */
export function mergeUsage(existing: DocumentData | undefined, b: UsageBatch, now: Date): DocumentData {
  const tagged = b.events.map((e, i) => ({ ...e, k: `${b.seq}.${i}` }));
  if (!existing) {
    return { page: b.page, query: b.query, ref: b.ref, device: b.device, app: b.app, variant: b.variant, day: ukDate(now), startedAt: now, updatedAt: now, seq: b.seq, final: b.final, active: b.active, scroll: b.scroll, parts: b.parts, order: b.order, events: tagged.slice(0, MAX_EVENTS) };
  }
  const oldParts = (isObj(existing.parts) ? existing.parts : {}) as Record<string, number>;
  const parts: Record<string, number> = { ...oldParts };
  for (const [k, v] of Object.entries(b.parts)) parts[k] = Math.max(Number(parts[k] ?? 0), v);
  const oldOrder = Array.isArray(existing.order) ? (existing.order as string[]) : [];
  const order = [...oldOrder, ...b.order.filter((p) => !oldOrder.includes(p))].slice(0, 80);
  const oldEvents = Array.isArray(existing.events) ? (existing.events as { k?: string }[]) : [];
  const seen = new Set(oldEvents.map((e) => e.k));
  const events = [...oldEvents, ...tagged.filter((e) => !seen.has(e.k))].slice(0, MAX_EVENTS);
  return {
    ...existing,
    app: existing.app ?? b.app,
    variant: b.seq >= Number(existing.seq ?? 0) ? (b.variant ?? existing.variant ?? null) : (existing.variant ?? b.variant ?? null),
    updatedAt: now,
    seq: Math.max(Number(existing.seq ?? 0), b.seq),
    final: existing.final === true || b.final,
    active: Math.max(Number(existing.active ?? 0), b.active),
    scroll: Math.max(Number(existing.scroll ?? 0), b.scroll),
    parts,
    order,
    events,
  };
}

/** At most this many batches in ten minutes from one connection, per server instance: enough for anyone reading, not for a flood. */
const WINDOW_MS = 600_000;
const MAX_PER_WINDOW = 240;
const recent = new Map<string, { start: number; count: number }>();
function underLimit(key: string, now = Date.now()): boolean {
  const hit = recent.get(key);
  if (!hit || now - hit.start > WINDOW_MS) {
    if (recent.size > 5000) recent.clear();
    recent.set(key, { start: now, count: 1 });
    return true;
  }
  hit.count += 1;
  return hit.count <= MAX_PER_WINDOW;
}

function bodyOf(req: { body?: unknown; rawBody?: Buffer }): unknown {
  // navigator.sendBeacon posts text/plain (so the browser needs no preflight): the JSON arrives as text.
  if (isObj(req.body)) return req.body;
  const text = typeof req.body === 'string' ? req.body : req.rawBody ? req.rawBody.toString('utf8') : '';
  if (!text || text.length > 64_000) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const usage = onRequest({ region: REGION, cors: ALLOWED_ORIGINS, memory: '256MiB', timeoutSeconds: 20, maxInstances: 3 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  const origin = String(req.headers.origin ?? '');
  if (!ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).end();
    return;
  }
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || 'unknown';
  if (!underLimit(createHash('sha256').update(ip).digest('hex').slice(0, 24))) {
    res.status(429).end();
    return;
  }
  const { data } = validateUsage(bodyOf(req));
  if (!data) {
    res.status(400).end();
    return;
  }
  const db = getFirestore();
  const ref = db.collection('usage').doc(data.view);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    tx.set(ref, mergeUsage(snap.exists ? snap.data() : undefined, data, new Date()));
  });
  res.status(204).end();
});

/** Usage records go after a year. */
export const purgeUsage = onSchedule({ region: REGION, schedule: 'every day 03:30', timeZone: 'Europe/London' }, async () => {
  const db = getFirestore();
  const cutoff = addDays(ukDate(new Date()), -USAGE_RETENTION_DAYS);
  let removed = 0;
  for (;;) {
    const snap = await db.collection('usage').where('day', '<', cutoff).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += snap.size;
  }
  logger.info('Usage purge', { removed });
});

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
};
const top = (counts: Map<string, number>, n: number) =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);

export interface PartSummary {
  part: string;
  /** Page views that got to this part. */
  reached: number;
  /** Of all the page's views. */
  share: number;
  /** Median seconds on it, among the views that got to it. */
  medianSeconds: number | null;
  /** Views whose last part was this one (for a form: where they stopped, if they did not finish). */
  lastHere: number;
  /** Times a form listed fields to fix on this part, and which fields. */
  errorViews: number;
  errors: { field: string; count: number }[];
}

export interface PageSummary {
  page: string;
  app: string | null;
  variant: string | null;
  views: number;
  /** For a form: views that reached its last step. */
  finished: number | null;
  medianActive: number | null;
  medianScroll: number | null;
  saveFailures: number;
  parts: PartSummary[];
  clicks: { to: string; label: string; count: number }[];
  sources: { ref: string; count: number }[];
}

export interface UsageSummary {
  from: string;
  to: string;
  views: number;
  devices: Record<string, number>;
  byDay: { day: string; views: number }[];
  pages: PageSummary[];
}

/** The forms' last steps: getting there counts as finishing. */
const FINISH: Record<string, string> = { family: 'done', break: 'done' };

/** Sums the page views between two UK dates into what the staff page shows. */
export function summariseUsage(docs: DocumentData[], range: { from: string; to: string }): UsageSummary {
  const devices: Record<string, number> = { phone: 0, tablet: 0, computer: 0 };
  const byDay = new Map<string, number>();
  const groups = new Map<string, DocumentData[]>();
  for (const d of docs) {
    if (typeof d.page !== 'string') continue;
    devices[String(d.device)] = (devices[String(d.device)] ?? 0) + 1;
    byDay.set(String(d.day), (byDay.get(String(d.day)) ?? 0) + 1);
    const key = `${d.page}|${d.app ?? ''}|${d.variant ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const pages: PageSummary[] = [...groups.entries()].map(([key, views]) => {
    const [page, app, variant] = key.split('|');
    const partStats = new Map<string, { seconds: number[]; positions: number[]; lastHere: number; errorViews: number; errors: Map<string, number> }>();
    const stat = (p: string) => {
      if (!partStats.has(p)) partStats.set(p, { seconds: [], positions: [], lastHere: 0, errorViews: 0, errors: new Map() });
      return partStats.get(p)!;
    };
    const clicks = new Map<string, number>();
    const sources = new Map<string, number>();
    let saveFailures = 0;
    let finished = 0;
    for (const v of views) {
      const order: string[] = Array.isArray(v.order) ? v.order : [];
      const parts: Record<string, number> = isObj(v.parts) ? (v.parts as Record<string, number>) : {};
      order.forEach((p, i) => {
        const s = stat(p);
        s.positions.push(i);
        s.seconds.push(Number(parts[p] ?? 0));
      });
      const last = order[order.length - 1];
      if (last) stat(last).lastHere += 1;
      if (app && order.includes(FINISH[app])) finished += 1;
      sources.set(v.ref || '(direct)', (sources.get(v.ref || '(direct)') ?? 0) + 1);
      const errorParts = new Set<string>();
      for (const e of Array.isArray(v.events) ? v.events : []) {
        if (e.type === 'click') clicks.set(`${e.to}|${e.label ?? ''}`, (clicks.get(`${e.to}|${e.label ?? ''}`) ?? 0) + 1);
        if (e.type === 'save-failed') saveFailures += 1;
        if (e.type === 'errors' && Array.isArray(e.fields)) {
          const s = stat(typeof e.part === 'string' ? e.part : '(unknown)');
          errorParts.add(typeof e.part === 'string' ? e.part : '(unknown)');
          for (const f of e.fields) s.errors.set(String(f), (s.errors.get(String(f)) ?? 0) + 1);
        }
      }
      errorParts.forEach((p) => (stat(p).errorViews += 1));
    }
    const parts: PartSummary[] = [...partStats.entries()]
      .map(([part, s]) => ({
        part,
        reached: s.positions.length,
        share: views.length ? Math.round((s.positions.length / views.length) * 100) : 0,
        medianSeconds: median(s.seconds),
        lastHere: s.lastHere,
        errorViews: s.errorViews,
        errors: top(s.errors, 6).map(([field, count]) => ({ field, count })),
        position: s.positions.length ? s.positions.reduce((a, b) => a + b, 0) / s.positions.length : 99,
      }))
      // In the order people usually meet them: the journey, top to bottom.
      .sort((a, b) => a.position - b.position || b.reached - a.reached)
      .map(({ position: _p, ...rest }) => rest);
    return {
      page,
      app: app || null,
      variant: variant || null,
      views: views.length,
      finished: app ? finished : null,
      medianActive: median(views.map((v) => Number(v.active ?? 0))),
      medianScroll: median(views.map((v) => Number(v.scroll ?? 0))),
      saveFailures,
      parts,
      clicks: top(clicks, 12).map(([k, count]) => {
        const [to, ...label] = k.split('|');
        return { to, label: label.join('|'), count };
      }),
      sources: top(sources, 8).map(([ref, count]) => ({ ref, count })),
    };
  });
  pages.sort((a, b) => b.views - a.views || a.page.localeCompare(b.page));
  return {
    from: range.from,
    to: range.to,
    views: docs.length,
    devices,
    byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, views]) => ({ day, views })),
    pages,
  };
}

/** The last `days` days of usage (today included), for the staff page. */
export async function usageSummary(db: Firestore, days: number, now = new Date()): Promise<UsageSummary> {
  const span = Math.min(Math.max(Math.round(days) || 30, 1), USAGE_RETENTION_DAYS);
  const to = ukDate(now);
  const from = addDays(to, -(span - 1));
  const snap = await db.collection('usage').where('day', '>=', from).limit(20_000).get();
  return summariseUsage(
    snap.docs.map((d) => d.data()),
    { from, to },
  );
}
