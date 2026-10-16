import type { DocumentData } from 'firebase-admin/firestore';
import { jsonFile, jsonlFile, textFile, tsvFile, type Doc, type OutFile, type Row } from './export.js';

/**
 * The website's anonymous usage counts (usage.ts) in the hourly export, a
 * folder of their own beside the studies' (16 October 2026):
 *
 *   website-usage/README.md
 *   website-usage/daily.tsv + .json        one row per day, page (and form and
 *                                          version), with views, devices, time
 *                                          read, how far down, forms finished,
 *                                          fields to fix, saves that failed
 *   website-usage/raw/usage_<YYYY-MM>.jsonl  every page view of that month (UK
 *                                          date) as stored
 *
 * Nothing in a record identifies anyone (usage.ts says what is kept: the
 * page, a few switches from the link, where it came from as a path or a
 * site, phone, tablet or computer, seconds read per part, links followed,
 * the ids of fields a form said to fix; the view id is a random number made
 * for that page load). The privacy page promises the counts are deleted
 * after a year, and purgeUsage deletes them; the export is a mirror, so a
 * month leaves this folder (and OneDrive) when its records are deleted. A
 * literal folder name, not built from export.ts's values: the two modules
 * import each other.
 */

export const USAGE_ROOT = 'website-usage';
const DEVICES = ['phone', 'tablet', 'computer'] as const;
/** The forms' last steps, as usage.ts counts finishing. */
const FINISH: Record<string, string> = { family: 'done', break: 'done' };

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
};

export const USAGE_DAILY_COLUMNS = ['day', 'page', 'app', 'variant', 'views', ...DEVICES, 'finished', 'median_active_seconds', 'median_scroll_percent', 'views_with_fields_to_fix', 'save_failures', 'links_followed'];

/** One row per UK day and page (with the form and its version, if any), in order. */
export function usageDailyTable(docs: Doc[]): Row[] {
  const groups = new Map<string, DocumentData[]>();
  for (const { data: d } of docs) {
    if (typeof d.page !== 'string') continue;
    const key = [String(d.day ?? ''), d.page, d.app ?? '', d.variant ?? ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, views]) => {
      const [day, page, app, variant] = key.split('|');
      const events = (v: DocumentData) => (Array.isArray(v.events) ? (v.events as { type?: string }[]) : []);
      const row: Row = { day: day || null, page, app: app || null, variant: variant || null, views: views.length };
      for (const device of DEVICES) row[device] = views.filter((v) => v.device === device).length;
      row.finished = app && FINISH[app] ? views.filter((v) => Array.isArray(v.order) && (v.order as string[]).includes(FINISH[app])).length : null;
      row.median_active_seconds = median(views.map((v) => Number(v.active ?? 0)));
      row.median_scroll_percent = median(views.map((v) => Number(v.scroll ?? 0)));
      row.views_with_fields_to_fix = views.filter((v) => events(v).some((e) => e.type === 'errors')).length;
      row.save_failures = views.reduce((n, v) => n + events(v).filter((e) => e.type === 'save-failed').length, 0);
      row.links_followed = views.reduce((n, v) => n + events(v).filter((e) => e.type === 'click').length, 0);
      return row;
    });
}

export function usageDailyDictionary(): Record<string, unknown> {
  return {
    day: { Description: 'The UK date the page was opened (YYYY-MM-DD)' },
    page: { Description: 'The page’s path on myphonemybrain.com' },
    app: { Description: 'The form on the page, if any', Levels: { family: 'The family form (consent, questions, screenshots)', break: 'The social media break study’s pages' } },
    variant: { Description: 'Which version or flow of the page or form (for example parent or young), as the page reported it' },
    views: { Description: 'Page views: one per page load' },
    phone: { Description: 'Views on a phone' },
    tablet: { Description: 'Views on a tablet' },
    computer: { Description: 'Views on a computer' },
    finished: { Description: 'For a form: views that reached its last step; n/a for other pages' },
    median_active_seconds: { Description: 'Median time the page was being read (visible and used in the last minute)', Units: 's' },
    median_scroll_percent: { Description: 'Median of how far down the page was scrolled', Units: 'percent' },
    views_with_fields_to_fix: { Description: 'Views in which a form listed fields needing fixing (which fields is in raw/, never what was typed)' },
    save_failures: { Description: 'Times a form could not save to the server' },
    links_followed: { Description: 'Links followed from the page' },
  };
}

const USAGE_README = `# How the website is used

Anonymous counts of how people use myphonemybrain.com, so the team can see
where people get stuck and what to make easier. Written every hour from the
website's database as a mirror; do not edit or add files here.

daily.tsv            one row per day and page (and form and its version):
                     views, phone, tablet or computer, median time read and
                     scroll depth, forms finished, fields to fix, saves that
                     failed, links followed; described by daily.json
raw/usage_<month>.jsonl   every page view of that month (UK date) as stored:
                     the page, a few switches from the link (which way into
                     a form, never codes or names), where it came from (a
                     path on the site or another site's name), phone, tablet
                     or computer, seconds read in each part of the page or
                     step of a form, in the order read, the links followed,
                     and the ids of fields a form said needed fixing

Nothing here identifies anyone: no cookies, no IP address, nothing typed,
no participant IDs or reference codes; the view id is a random number made
for that page load and kept nowhere else. Visitors can turn the counting off
on the privacy page, and browsers sending Global Privacy Control or Do Not
Track send nothing.

The privacy page promises the counts are deleted after a year, so they are:
each day's records are deleted from the database 365 days later, and the
export, a mirror, then drops them from daily.tsv and from their month's
file (a month's file goes when its last record does). Copies kept anywhere
else must follow the same promise.

Timestamps are ISO 8601 in UTC; days are UK dates. Missing values are n/a.
`;

/** The website-usage folder's files. */
export function usageExport(docs: Doc[]): { files: OutFile[]; counts: Record<string, number> } {
  const byMonth = new Map<string, Doc[]>();
  for (const d of [...docs].sort((a, b) => String(a.data.startedAt ?? '').localeCompare(String(b.data.startedAt ?? '')) || a.id.localeCompare(b.id))) {
    const day = typeof d.data.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.data.day) ? d.data.day : null;
    const month = day ? day.slice(0, 7) : 'undated';
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(d);
  }
  const files: OutFile[] = [
    textFile(`${USAGE_ROOT}/README.md`, USAGE_README, 'text/markdown; charset=utf-8'),
    tsvFile(`${USAGE_ROOT}/daily.tsv`, usageDailyTable(docs), USAGE_DAILY_COLUMNS),
    jsonFile(`${USAGE_ROOT}/daily.json`, usageDailyDictionary()),
  ];
  for (const [month, mine] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) files.push(jsonlFile(`${USAGE_ROOT}/raw/usage_${month}.jsonl`, mine));
  return { files, counts: { websiteViews: docs.length } };
}
