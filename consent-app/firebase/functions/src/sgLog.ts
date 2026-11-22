/**
 * The safeguarding log (22 November 2026). The procedure (portalCore.ts
 * SAFEGUARDING_VERSION, src/portal/safeguarding.tsx) says: "One safeguarding
 * log for the study, kept apart from the research data and open only to the PI
 * and the project coordinator." So:
 *
 * - anyone in the portal can report a concern into it, and sees their own
 *   reports (what they wrote, and whether it is open or closed), never anyone
 *   else's, nor what the log holders recorded;
 * - the log holders (the project manager, and the people the project manager
 *   names, the PI by default) see every record, record each action taken, and
 *   close a record with its outcome (or reopen it);
 * - nothing is ever deleted or changed: every step is added, with who and when;
 * - it is never in the Notebook, the export, the Sheet or the daily email. The
 *   log holders get an email that a concern was logged, with no details.
 *
 * Reporting here never replaces telling the school's DSL the same day: the form
 * says so first, and asks whether the DSL has been told.
 *
 * Pure: the rules and checks. sgLogStore.ts reads and writes Firestore.
 */

export const SG_SOURCES = ['session', 'data', 'other'] as const;
export type SgSource = (typeof SG_SOURCES)[number];
export const SG_SOURCE_LABEL: Record<SgSource, string> = { session: 'Told or seen at a session', data: 'Found later in the study’s data', other: 'Something else' };
export const SG_DSL = ['yes', 'not-yet', 'not-reachable', 'not-needed'] as const;
export type SgDsl = (typeof SG_DSL)[number];
export const SG_DSL_LABEL: Record<SgDsl, string> = { yes: 'Yes, the DSL (or deputy) has been told', 'not-yet': 'Not yet', 'not-reachable': 'The DSL could not be reached', 'not-needed': 'Not for the DSL (found later: for the PI to decide)' };
export const SG_HOW = ['in-person', 'phone', 'email', 'other'] as const;
export type SgHow = (typeof SG_HOW)[number];
export const SG_HOW_LABEL: Record<SgHow, string> = { 'in-person': 'In person', phone: 'By phone', email: 'By secure email', other: 'Other' };
export const SG_STATUS_LABEL = { open: 'Open', closed: 'Closed' } as const;
export type SgStatus = keyof typeof SG_STATUS_LABEL;
export const SG_STEP_LABEL = { action: 'Action taken', note: 'Note', addendum: 'Added by the reporter', closed: 'Closed', reopened: 'Reopened' } as const;
export type SgStepKind = keyof typeof SG_STEP_LABEL;

export interface SgStep {
  id: string;
  at: string;
  by: string;
  byName: string;
  kind: SgStepKind;
  text: string;
}
export interface SgRecord {
  id: string;
  uid: string;
  reporterName: string;
  reporterRole: string;
  /** When it happened or was found, by the reporter's device (as they set it). */
  occurredAt: string;
  receivedAt: string;
  source: SgSource;
  visitId: string | null;
  schoolId: string | null;
  /** Who it is about, as the reporter knows them; a study ID when found in the data. */
  about: string;
  yearGroup: string;
  /** What was said or seen, in the young person's words where possible. */
  account: string;
  /** What the reporter did straight away (who else they told, a teacher, 999). */
  immediate: string;
  immediateDanger: boolean;
  dsl: SgDsl;
  dslName: string;
  dslAt: string | null;
  dslHow: SgHow | null;
  status: SgStatus;
  outcome: string;
  steps: SgStep[];
}

export type Role = 'pm' | 'researcher' | 'ra';
export interface SgViewer {
  uid: string;
  email: string;
  role: Role | null;
}
export interface SgSettings {
  /** Who else holds the log, besides the project manager(s): the PI by default. */
  holders: string[];
}
export const DEFAULT_SG_SETTINGS: SgSettings = { holders: ['f.mushtaq@leeds.ac.uk'] };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function sgSettingsOf(v: unknown): SgSettings {
  const o = (v ?? {}) as Record<string, unknown>;
  if (!Array.isArray(o.holders)) return DEFAULT_SG_SETTINGS;
  const seen = new Set<string>();
  return { holders: o.holders.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL.test(e) && !seen.has(e) && Boolean(seen.add(e))).slice(0, 6) };
}

/** The project manager, and anyone the setting names, hold the log. */
export const isHolder = (v: SgViewer, s: SgSettings) => v.role === 'pm' || (v.role !== null && s.holders.includes(v.email.trim().toLowerCase()));

export const SG_ID = /^[A-Za-z0-9-]{8,64}$/;
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const when = (v: unknown, now: Date): string | null | 'bad' => {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(String(v));
  if (!Number.isFinite(t) || t > now.getTime() + 10 * 60_000 || t < now.getTime() - 400 * 86_400_000) return 'bad';
  return new Date(t).toISOString();
};

export type SgInput = Pick<SgRecord, 'id' | 'occurredAt' | 'source' | 'visitId' | 'about' | 'yearGroup' | 'account' | 'immediate' | 'immediateDanger' | 'dsl' | 'dslName' | 'dslAt' | 'dslHow'>;

/** A report as the browser sent it, checked. */
export function sgInput(raw: Record<string, unknown>, now = new Date()): { ok: true; value: SgInput } | { ok: false; problem: string } {
  const id = clip(raw.id, 64);
  if (!SG_ID.test(id)) return { ok: false, problem: 'The report has no id.' };
  const occurredAt = when(raw.occurredAt, now);
  if (!occurredAt || occurredAt === 'bad') return { ok: false, problem: 'Check the time it happened.' };
  const source = SG_SOURCES.includes(raw.source as SgSource) ? (raw.source as SgSource) : null;
  if (!source) return { ok: false, problem: 'Say how the concern came up.' };
  const about = clip(raw.about, 120);
  if (!about) return { ok: false, problem: 'Say who it is about (their name, or the study ID if found in the data).' };
  const account = clip(raw.account, 8000);
  if (account.length < 10) return { ok: false, problem: 'Write down what was said or seen.' };
  const dsl = SG_DSL.includes(raw.dsl as SgDsl) ? (raw.dsl as SgDsl) : null;
  if (!dsl) return { ok: false, problem: 'Say whether the school’s DSL has been told.' };
  const dslAt = dsl === 'yes' ? when(raw.dslAt, now) : null;
  if (dslAt === 'bad') return { ok: false, problem: 'Check when the DSL was told.' };
  const dslName = dsl === 'yes' ? clip(raw.dslName, 120) : '';
  if (dsl === 'yes' && !dslName) return { ok: false, problem: 'Give the name of the DSL (or deputy) you told.' };
  const dslHow = dsl === 'yes' && SG_HOW.includes(raw.dslHow as SgHow) ? (raw.dslHow as SgHow) : null;
  const visitId = typeof raw.visitId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw.visitId) ? raw.visitId : null;
  return { ok: true, value: { id, occurredAt, source, visitId, about, yearGroup: clip(raw.yearGroup, 40), account, immediate: clip(raw.immediate, 4000), immediateDanger: raw.immediateDanger === true, dsl, dslName, dslAt, dslHow } };
}

/** A step added to a record: who may add which. */
export function mayAddStep(r: Pick<SgRecord, 'uid' | 'status'>, kind: SgStepKind, v: SgViewer, s: SgSettings): boolean {
  if (kind === 'addendum') return r.uid === v.uid || isHolder(v, s);
  if (!isHolder(v, s)) return false;
  if (kind === 'closed') return r.status === 'open';
  if (kind === 'reopened') return r.status === 'closed';
  return true;
}

/** The record with a step added: closing needs the outcome, which is kept on the record too. */
export function withStep(r: SgRecord, step: SgStep): Pick<SgRecord, 'status' | 'outcome' | 'steps'> {
  const status: SgStatus = step.kind === 'closed' ? 'closed' : step.kind === 'reopened' ? 'open' : r.status;
  return { status, outcome: step.kind === 'closed' ? step.text : r.outcome, steps: [...r.steps, step] };
}

/** What the reporter sees of their own report: what they wrote and whether it is open, not what the log holders recorded. */
export function reporterView(r: SgRecord) {
  return { ...r, outcome: '', steps: r.steps.filter((x) => x.kind === 'addendum' && x.by === r.uid) };
}

/** The email to the log holders: that there is something to read, nothing more. */
export function sgAlert(r: Pick<SgRecord, 'reporterName' | 'occurredAt' | 'immediateDanger' | 'dsl'>, link: string): { subject: string; text: string; html: string } {
  const at = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(r.occurredAt));
  const dsl = r.dsl === 'yes' ? 'The reporter says the school’s DSL has been told.' : r.dsl === 'not-needed' ? 'Found later in the data: for the PI to decide within two working days.' : 'The reporter says the school’s DSL has NOT been told yet.';
  const subject = `Safeguarding concern logged${r.immediateDanger ? ' (immediate danger)' : ''}`;
  const text = [`${r.reporterName} logged a safeguarding concern (${at}).`, dsl, r.immediateDanger ? 'They marked it as immediate danger.' : '', '', `Read it in the portal: ${link}`, '', 'The details are only in the portal’s safeguarding log, not in this email.'].filter((l, i, a) => l || a[i - 1]).join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#113b3f;"><p><strong>${esc(r.reporterName)}</strong> logged a safeguarding concern (${esc(at)}).</p><p${r.dsl === 'yes' ? '' : ' style="color:#bb1e50;font-weight:700;"'}>${esc(dsl)}</p>${r.immediateDanger ? '<p style="color:#bb1e50;font-weight:700;">They marked it as immediate danger.</p>' : ''}<p><a href="${esc(link)}">Read it in the portal</a>.</p><p style="color:#4c6669;font-size:13px;">The details are only in the portal’s safeguarding log, not in this email.</p></div>`;
  return { subject, text, html };
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The portal actions: reporting and one's own reports for everyone; the store checks who holds the log for the rest. */
export const SG_SELF_ACTIONS = ['sg-report', 'sg-mine', 'sg-step', 'sg-list', 'sg-holder'];
export const SG_PM_ACTIONS = ['sg-settings', 'sg-save-settings'];
