import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { createHash } from 'node:crypto';

/**
 * Messages from the public website: the contact form and the school form.
 * The site is static, so the browser posts JSON here. Each message is stored
 * in `enquiries/` (coordinators can read it) and queued in `mail/` for the
 * Trigger Email extension, which emails the team once it is installed.
 *
 * Spam control without making families do puzzles: an origin allow-list, a
 * hidden honeypot field, length limits, and at most ten messages an hour
 * from one connection (kept as a hashed address, never the address itself).
 */
export const ALLOWED_ORIGINS = ['https://myphonemybrain.com', 'https://www.myphonemybrain.com', 'http://localhost:4000', 'http://127.0.0.1:4000'];
const TEAM_EMAIL = 'brainpop@leeds.ac.uk';
export const YEAR_GROUPS = ['Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12/13'];
export const TOPICS = ['The study', 'Taking part', 'Taking part as a school', 'Something else'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;
const limits = { name: 100, email: 254, phone: 30, school: 150, role: 100, area: 60, pupils: 20, message: 3000 };
const MAX_PER_HOUR = 10;

export interface Enquiry {
  kind: 'contact' | 'school';
  name: string;
  email: string;
  message: string;
  topic: string | null;
  school: string | null;
  role: string | null;
  phone: string | null;
  area: string | null;
  pupils: string | null;
  yearGroups: string[];
  canOfferSlots: boolean;
  /** Honeypot: a field people never see. Anything in it means a bot. */
  website: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v.trim() : null);

/** Checks a form submission and returns the clean record, or the problems in plain English. */
export function validateEnquiry(input: unknown): { problems: string[]; data: Enquiry | null } {
  const problems: string[] = [];
  if (!isObj(input)) return { problems: ['The message is not in the expected form.'], data: null };
  const kind = input.kind === 'school' ? 'school' : input.kind === 'contact' ? 'contact' : null;
  if (!kind) problems.push('Unknown form.');
  const name = text(input.name, limits.name);
  if (!name) problems.push('Please give your name.');
  const email = text(input.email, limits.email);
  if (!email || !EMAIL.test(email)) problems.push('Please give an email address we can reply to.');
  const message = text(input.message, limits.message) ?? (typeof input.message === 'string' ? null : '');
  if (message === null) problems.push('The message is too long (3,000 characters at most).');
  if (kind === 'contact' && !message) problems.push('Please write your question.');
  const topic = kind === 'contact' ? (TOPICS.includes(String(input.topic)) ? String(input.topic) : 'Something else') : null;

  let school: string | null = null;
  let role: string | null = null;
  let area: string | null = null;
  let pupils: string | null = null;
  let yearGroups: string[] = [];
  let canOfferSlots = false;
  if (kind === 'school') {
    school = text(input.school, limits.school);
    if (!school || school.length < 3) problems.push('Please give the school’s name.');
    role = text(input.role, limits.role);
    if (!role) problems.push('Please give your role at the school.');
    area = text(input.area, limits.area) || null;
    pupils = text(input.pupils, limits.pupils) || null;
    yearGroups = Array.isArray(input.yearGroups) ? Array.from(new Set(input.yearGroups.filter((y): y is string => typeof y === 'string' && YEAR_GROUPS.includes(y)))) : [];
    if (yearGroups.length < 2) problems.push('Please choose at least two year groups: the study needs two or more year groups from each school.');
    canOfferSlots = input.canOfferSlots === true;
    if (!canOfferSlots) problems.push('Please confirm your school can offer two-hour session slots for groups of up to 30 pupils.');
  }
  const phone = text(input.phone, limits.phone) || null;
  if (phone && !PHONE.test(phone)) problems.push('The phone number does not look right.');
  const website = typeof input.website === 'string' ? input.website : '';

  if (problems.length || !kind || !name || !email) return { problems, data: null };
  return { problems, data: { kind, name, email, message: message ?? '', topic, school, role, phone, area, pupils, yearGroups, canOfferSlots, website } };
}

function summarise(e: Enquiry): string {
  const lines = e.kind === 'school'
    ? [
        `School: ${e.school}`,
        `Local authority: ${e.area ?? 'not given'}`,
        `Approximate pupils: ${e.pupils ?? 'not given'}`,
        `Year groups: ${e.yearGroups.join(', ')}`,
        `Two-hour slots for groups of up to 30: ${e.canOfferSlots ? 'yes' : 'no'}`,
        '',
        `Contact: ${e.name}, ${e.role}`,
        `Email: ${e.email}`,
        `Phone: ${e.phone ?? 'not given'}`,
        '',
        e.message ? `Message:\n${e.message}` : 'No message added.',
      ]
    : [`From: ${e.name}`, `Email: ${e.email}`, `Topic: ${e.topic}`, '', e.message];
  return lines.join('\n');
}

export const enquiry = onRequest({ region: 'europe-west2', cors: ALLOWED_ORIGINS, memory: '256MiB', timeoutSeconds: 30 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Use POST.' });
    return;
  }
  const { problems, data } = validateEnquiry(req.body);
  if (!data) {
    res.status(400).json({ ok: false, error: problems[0], problems });
    return;
  }
  if (data.website) {
    // A bot filled the hidden field. Say nothing useful and store nothing.
    res.json({ ok: true });
    return;
  }

  const db = getFirestore();
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || 'unknown';
  const key = createHash('sha256').update(ip).digest('hex').slice(0, 32);
  const overLimit = await db.runTransaction(async (tx) => {
    const ref = db.collection('ratelimits').doc(key);
    const snap = await tx.get(ref);
    const now = Date.now();
    const current = snap.data() as { windowStart?: number; count?: number } | undefined;
    const sameWindow = current?.windowStart !== undefined && now - current.windowStart < 3_600_000;
    const count = sameWindow ? (current?.count ?? 0) + 1 : 1;
    tx.set(ref, { windowStart: sameWindow ? current?.windowStart : now, count, updatedAt: FieldValue.serverTimestamp() });
    return count > MAX_PER_HOUR;
  });
  if (overLimit) {
    res.status(429).json({ ok: false, error: 'Too many messages from this connection in the last hour. Please try again later, or email us directly.' });
    return;
  }

  const receivedAt = new Date();
  const ref = db.collection('enquiries').doc();
  const { website: _hp, ...record } = data;
  const subject = data.kind === 'school' ? `School enquiry: ${data.school}` : `Website question: ${data.topic}`;
  const batch = db.batch();
  batch.set(ref, { ...record, status: 'new', receivedAt, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200), createdAt: FieldValue.serverTimestamp() });
  batch.set(db.collection('mail').doc(), {
    to: TEAM_EMAIL,
    replyTo: data.email,
    message: { subject: `MyPhone/MyBrain — ${subject}`, text: `${summarise(data)}\n\nReference: enquiries/${ref.id}` },
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  logger.info('Enquiry received', { kind: data.kind, id: ref.id });
  res.json({ ok: true, id: ref.id });
});
