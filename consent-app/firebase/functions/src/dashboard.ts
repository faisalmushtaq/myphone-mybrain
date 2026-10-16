import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { TEST_PARTICIPANTS } from './exportLab.js';
import { schools } from './forms.js';
import { phaseCountsOf, toIso } from './lab.js';
import { ukDate } from './ukTime.js';

/**
 * The staff page's dashboard (16 October 2026): how both studies are going,
 * at a glance. Counts only, nothing identifying, worked out from the records
 * each time the tab opens. The break study leaves out the team's test
 * accounts, as the export does.
 */

export interface Stage {
  id: string;
  label: string;
  n: number;
}

export interface DayCount {
  day: string;
  n: number;
}

export interface Dashboard {
  generatedAt: string;
  schools: {
    stages: Stage[];
    other: { questionsAnswered: number; youngAgreed: number; saidNo: number; noPhone: number; youngSaidNo: number; waiting: number; screenshots: number };
    bySchool: { id: string; name: string; started: number; yes: number; sent: number }[];
    daily: { started: DayCount[]; sent: DayCount[] };
  };
  breakStudy: {
    stages: Stage[];
    stories: { pre: number; mid: number; post: number };
    daily: { signedUp: DayCount[] };
  };
}

const DAYS = 30;

/** The last DAYS UK dates, oldest first, each with how many of the given times fall on it. */
export function perDay(times: (string | null)[], now: Date, days = DAYS): DayCount[] {
  const out: DayCount[] = [];
  const today = ukDate(now);
  const index = new Map<string, number>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    index.set(day, out.length);
    out.push({ day, n: 0 });
  }
  for (const t of times) {
    if (!t) continue;
    const i = index.get(ukDate(new Date(t)));
    if (i !== undefined) out[i].n += 1;
  }
  return out;
}

export interface Records {
  submissions: { id: string; data: DocumentData }[];
  participants: Map<string, DocumentData>;
  assents: Map<string, DocumentData>;
  surveys: Map<string, DocumentData>;
  donationTimes: (string | null)[];
  labParticipants: { id: string; data: DocumentData }[];
  labBookings: DocumentData[];
}

/** The counts, from the records (a pure function, so it can be tested). */
export function summarise(r: Records, now = new Date()): Dashboard {
  // The schools study: every family record saved (from the moment the parent signs, or a young person of 16 or over agrees).
  const subs = r.submissions.filter((s) => s.data.kind === 'consent');
  const assentOf = (s: DocumentData) => (s.assentId ? r.assents.get(String(s.assentId))?.status : undefined);
  const answered = (s: DocumentData) => ['completed', 'in-progress'].includes(String(r.surveys.get(String(s.surveyId))?.status ?? ''));
  const yes = subs.filter((s) => s.data.phoneSource === 'parent' || s.data.phoneSource === 'child');
  const sent = subs.filter((s) => Number(s.data.imageCount ?? 0) > 0);
  const bySchool = new Map<string, { started: number; yes: number; sent: number }>();
  for (const s of subs) {
    const id = String(r.participants.get(String(s.data.participantId))?.schoolId ?? s.data.schoolId ?? 'unknown');
    const row = bySchool.get(id) ?? { started: 0, yes: 0, sent: 0 };
    row.started += 1;
    if (s.data.phoneSource === 'parent' || s.data.phoneSource === 'child') row.yes += 1;
    if (Number(s.data.imageCount ?? 0) > 0) row.sent += 1;
    bySchool.set(id, row);
  }

  // The break study, without the test accounts.
  const lab = r.labParticipants.filter((p) => !TEST_PARTICIPANTS.has(p.id) && p.data.consentId);
  const sentIn = (p: DocumentData, phase: 'pre' | 'mid' | 'post') => {
    const c = phaseCountsOf(p)[phase];
    return c.archives + c.screenshots > 0;
  };
  const attended = (visit: number) => new Set(r.labBookings.filter((b) => b.status === 'attended' && Number(b.visit) === visit && !TEST_PARTICIPANTS.has(String(b.participantCode))).map((b) => String(b.participantCode))).size;
  const stories = { pre: 0, mid: 0, post: 0 };
  for (const p of lab) for (const phase of ['pre', 'mid', 'post'] as const) stories[phase] += Number(p.data.storyCounts?.[phase] ?? 0);

  return {
    generatedAt: now.toISOString(),
    schools: {
      stages: [
        { id: 'started', label: 'Form saved (permission signed)', n: subs.length },
        { id: 'yes', label: 'Said yes to sharing the screen time', n: yes.length },
        { id: 'sent', label: 'Screen time sent', n: sent.length },
      ],
      other: {
        questionsAnswered: subs.filter((s) => answered(s.data)).length,
        youngAgreed: subs.filter((s) => assentOf(s.data) === 'completed').length,
        youngSaidNo: subs.filter((s) => assentOf(s.data) === 'declined').length,
        saidNo: subs.filter((s) => s.data.phoneSource === 'none').length,
        noPhone: subs.filter((s) => s.data.phoneSource === 'no-phone').length,
        waiting: yes.filter((s) => Number(s.data.imageCount ?? 0) === 0 && assentOf(s.data) !== 'declined').length,
        screenshots: subs.reduce((n, s) => n + Number(s.data.imageCount ?? 0), 0),
      },
      bySchool: Array.from(bySchool.entries())
        .map(([id, v]) => ({ id, name: schools.find((x) => x.id === id)?.name ?? id, ...v }))
        .sort((a, b) => b.started - a.started),
      daily: { started: perDay(subs.map((s) => toIso(s.data.createdAt)), now), sent: perDay(r.donationTimes, now) },
    },
    breakStudy: {
      stages: [
        { id: 'signed-up', label: 'Signed up', n: lab.length },
        { id: 'pre', label: 'Data sent before the break', n: lab.filter((p) => sentIn(p.data, 'pre')).length },
        { id: 'visit1', label: 'First lab visit attended', n: attended(1) },
        { id: 'checkin', label: 'Mid-break check-in done', n: lab.filter((p) => Number(p.data.checkInCount ?? 0) > 0 || sentIn(p.data, 'mid')).length },
        { id: 'post', label: 'Data sent after the break', n: lab.filter((p) => sentIn(p.data, 'post')).length },
        { id: 'visit2', label: 'Second lab visit attended', n: attended(2) },
      ],
      stories,
      daily: { signedUp: perDay(lab.map((p) => toIso(p.data.consentedAt)), now) },
    },
  };
}

export async function dashboardOf(db: Firestore): Promise<Dashboard> {
  const [subs, people, assents, surveys, donations, labPeople, bookings] = await Promise.all([
    db.collection('submissions').where('kind', '==', 'consent').get(),
    db.collection('participants').get(),
    db.collection('assents').get(),
    db.collection('surveys').get(),
    db.collection('donations').select('receivedAt').get(),
    db.collection('labParticipants').get(),
    db.collection('labBookings').get(),
  ]);
  return summarise({
    submissions: subs.docs.map((d) => ({ id: d.id, data: d.data() })),
    participants: new Map(people.docs.map((d) => [d.id, d.data()])),
    assents: new Map(assents.docs.map((d) => [d.id, d.data()])),
    surveys: new Map(surveys.docs.map((d) => [d.id, d.data()])),
    donationTimes: donations.docs.map((d) => toIso(d.data().receivedAt)),
    labParticipants: labPeople.docs.map((d) => ({ id: d.id, data: d.data() })),
    labBookings: bookings.docs.map((d) => d.data()),
  });
}
