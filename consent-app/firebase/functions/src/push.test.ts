import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliver, subscriptionId, subscriptionOf, type PushSend } from './push.js';
import { announcementFor, announcementMessage, answersAfterChange, canvassSummary, datesShort, notifyPrefsOf, planOffers, validateCanvass, visitStatusAfter, type VisitDay } from './portalCore.js';

const sub = (n: number) => ({ id: `s${n}`, subscription: { endpoint: `https://push.example.org/${n}`, keys: { p256dh: 'p', auth: 'a' } } });

test('push: each device gets it; one the push service says is gone (404 or 410) is marked for deletion; other failures are kept', async () => {
  const seen: string[] = [];
  const send: PushSend = async (s, body) => {
    seen.push(`${s.endpoint} ${JSON.parse(body).title}`);
    if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    if (s.endpoint.endsWith('/3')) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    if (s.endpoint.endsWith('/4')) throw Object.assign(new Error('Server error'), { statusCode: 500 });
  };
  const r = await deliver([sub(1), sub(2), sub(3), sub(4)], { title: 'New dates', body: 'x', link: '#offers' }, send);
  assert.equal(seen.length, 4);
  assert.deepEqual(r, { sent: 1, gone: ['s2', 's3'], failed: 1 });
});

test('push subscriptions: only a real https endpoint with keys; a stable id per endpoint', () => {
  assert.deepEqual(subscriptionOf({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BP', auth: 'au' }, expirationTime: null }), { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BP', auth: 'au' } });
  assert.equal(subscriptionOf({ endpoint: 'http://insecure.example', keys: { p256dh: 'a', auth: 'b' } }), null);
  assert.equal(subscriptionOf({ endpoint: 'https://push.example.org/x' }), null);
  assert.equal(subscriptionId('https://a.example/1'), subscriptionId('https://a.example/1'));
  assert.notEqual(subscriptionId('https://a.example/1'), subscriptionId('https://a.example/2'));
  assert.match(subscriptionId('https://a.example/1'), /^[A-Za-z0-9]+$/);
});

const day = (date: string, on = true, start = '08:30', end = '15:00'): VisitDay => ({ date, on, start, end });
const two = [day('2026-11-20'), day('2026-11-23', false), day('2026-11-24')];

test('announcements: provisional dates, published dates, confirmed or cancelled provisional dates, changed provisional dates, days added', () => {
  assert.equal(announcementFor({ status: 'draft', days: two }, { status: 'provisional', days: two })?.kind, 'provisional');
  assert.equal(announcementFor({ status: 'draft', days: two }, { status: 'staffing', days: two })?.kind, 'new-dates');
  assert.equal(announcementFor({ status: 'provisional', days: two }, { status: 'staffing', days: two })?.kind, 'confirmed');
  assert.equal(announcementFor({ status: 'provisional', days: two }, { status: 'cancelled', days: two })?.kind, 'cancelled-provisional');
  assert.equal(announcementFor({ status: 'provisional', days: two }, { status: 'provisional', days: [day('2026-11-20', true, '09:00'), ...two.slice(1)] })?.kind, 'provisional-changed');
  assert.equal(announcementFor({ status: 'provisional', days: two }, { status: 'provisional', days: two }), null, 'nothing changed: nothing sent');
  const added = announcementFor({ status: 'staffing', days: two }, { status: 'staffing', days: [...two, day('2026-11-25')] });
  assert.deepEqual([added?.kind, added?.days.map((d) => d.date)], ['days-added', ['2026-11-25']]);
  assert.equal(announcementFor({ status: 'staffing', days: two }, { status: 'locked', days: two }), null, 'fully staffed: nothing to announce');
  assert.equal(announcementFor({ status: 'draft', days: two }, { status: 'draft', days: two }), null, 'drafts stay with the team');
});

test('announcement words: provisional dates say so; the push carries only the school and the dates', () => {
  const m = announcementMessage('provisional', 'The Grammar School at Leeds', two, 'Main reception', 'https://myphonemybrain.com/portal/#offers', 'Sam');
  assert.equal(m.push.body, 'Possible school dates (not yet confirmed): The Grammar School at Leeds, Fri 20 Nov, Tue 24 Nov. Tell us if you could do them.');
  assert.equal(m.note.link, '#offers');
  assert.match(m.email.body, /Hello Sam,[\s\S]*provisional[\s\S]*not yet confirmed[\s\S]*Where: Main reception[\s\S]*#offers/);
  assert.equal(announcementMessage('new-dates', 'GSAL', two, '', 'x#a').push.body, 'New school dates: GSAL, Fri 20 Nov, Tue 24 Nov. Mark your availability.');
  assert.doesNotMatch(JSON.stringify(m.push), /Sam/);
  assert.equal(datesShort([day('2026-11-16'), day('2026-11-17'), day('2026-11-18'), day('2026-11-19')]), 'Mon 16 Nov to Thu 19 Nov (4 days)');
});

test('provisional answers: per day it runs, can do, maybe or can’t do; only while provisional', () => {
  assert.deepEqual(validateCanvass({ '2026-11-20': 'yes', '2026-11-24': 'maybe' }, two, 'provisional'), { answers: { '2026-11-20': 'yes', '2026-11-24': 'maybe' }, problems: [] });
  assert.match(validateCanvass({ '2026-11-23': 'yes' }, two, 'provisional').problems.join(' '), /not one of the visit's days/);
  assert.match(validateCanvass({ '2026-11-20': 'often' }, two, 'provisional').problems.join(' '), /can do, maybe or can't do/);
  assert.match(validateCanvass({ '2026-11-20': 'yes' }, two, 'staffing').problems.join(' '), /no longer provisional/);
  const summary = canvassSummary(two, [{ uid: 'a', name: 'Sam', answers: { '2026-11-20': 'yes', '2026-11-24': 'no' } }, { uid: 'b', name: 'Alex', answers: { '2026-11-20': 'maybe' } }], [{ uid: 'a', name: 'Sam' }, { uid: 'b', name: 'Alex' }, { uid: 'c', name: 'Jo' }]);
  assert.deepEqual(summary.map((d) => [d.date, d.yes, d.maybe, d.no, d.noAnswer]), [
    ['2026-11-20', ['Sam'], ['Alex'], [], ['Jo']],
    ['2026-11-24', [], [], ['Sam'], ['Alex', 'Jo']],
  ]);
  assert.deepEqual(answersAfterChange({ '2026-11-20': 'yes', '2026-11-24': 'no' }, two, [day('2026-11-20'), day('2026-11-24', true, '09:00')]), { '2026-11-20': 'yes' }, 'a day whose times changed is asked again');
});

test('provisional visits: no offers; the status holds while answers come in', () => {
  const base = { needed: 1, assignments: [], active: new Set(['a']), eligible: new Map([['a', { eligible: true, reasons: [] }]]), overrides: {}, mayOverride: true, visitStatus: 'provisional' as const };
  assert.match(planOffers(['a'], base).problems.join(' '), /provisional/);
  assert.equal(visitStatusAfter('provisional', 1, []), 'provisional');
});

test('notification choices: new dates by push and by email unless switched off', () => {
  assert.deepEqual(notifyPrefsOf(undefined), { newDatesPush: true, newDatesEmail: true });
  assert.deepEqual(notifyPrefsOf({ newDatesPush: false }), { newDatesPush: false, newDatesEmail: true });
});
