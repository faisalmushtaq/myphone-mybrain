import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeUsage, summariseUsage, validateUsage, type UsageBatch } from './usage.js';

const batch = (over: Record<string, unknown> = {}) => ({
  v: 1,
  view: 'k3j9x0a8b7c6d5e4',
  seq: 0,
  final: false,
  page: '/take-part/consent/',
  query: { who: 'parent', school: 'dua' },
  ref: '/dua/',
  device: 'phone',
  app: 'family',
  variant: 'parent',
  active: 42.4,
  scroll: 63,
  parts: { welcome: 10, 'child-details': 32.4 },
  order: ['welcome', 'child-details'],
  events: [{ t: 30, type: 'errors', part: 'child-details', fields: ['child-year-group', 'child-dob'] }],
  ...over,
});

test('accepts a page view batch and keeps only what is allowed', () => {
  const { problems, data } = validateUsage(batch({ query: { who: 'parent', code: 'MPABC123', finish: 'MPMB-ABCD-EF2', school: 'dua' } }));
  assert.deepEqual(problems, []);
  // Participant IDs and reference codes never get through, whatever the page sent.
  assert.deepEqual(data?.query, { who: 'parent', school: 'dua' });
  assert.equal(data?.active, 42.4);
  assert.deepEqual(data?.events[0], { t: 30, type: 'errors', part: 'child-details', fields: ['child-year-group', 'child-dob'] });
  const click = validateUsage(batch({ events: [{ t: 3, type: 'click', part: 'about', to: '/take-part/consent/?who=parent', label: '  Share screen\ntime online →  ' }] }));
  assert.deepEqual(click.data?.events[0], { t: 3, type: 'click', part: 'about', to: '/take-part/consent/?who=parent', label: 'Share screen time online →' });
});

test('refuses anything malformed rather than storing it', () => {
  assert.equal(validateUsage(null).data, null);
  assert.equal(validateUsage({ ...batch(), v: 2 }).data, null);
  assert.equal(validateUsage(batch({ view: 'short' })).data, null);
  assert.equal(validateUsage(batch({ page: 'https://elsewhere.example/' })).data, null);
  assert.equal(validateUsage(batch({ device: 'Mozilla/5.0' })).data, null);
  assert.equal(validateUsage(batch({ app: 'other' })).data, null);
  assert.equal(validateUsage(batch({ active: -1 })).data, null);
  assert.equal(validateUsage(batch({ scroll: 140 })).data, null);
  assert.equal(validateUsage(batch({ parts: { 'Kai Patel': 3 } })).data, null);
  assert.equal(validateUsage(batch({ order: ['ok', 'not ok'] })).data, null);
  assert.equal(validateUsage(batch({ events: [{ t: 1, type: 'typed', value: 'secret' }] })).data, null);
  assert.equal(validateUsage(batch({ events: [{ t: 1, type: 'click', to: 'https://elsewhere.example/?email=a@b.c' }] })).data, null);
  assert.equal(validateUsage(batch({ events: [{ t: 1, type: 'errors', fields: ['has space'] }] })).data, null);
  assert.equal(validateUsage(batch({ ref: '/dua/?code=MPABC' })).data, null);
  assert.ok(validateUsage(batch({ ref: 'ext:www.google.com' })).data);
});

test('later batches keep the running totals and add each event once', () => {
  const first = validateUsage(batch()).data as UsageBatch;
  const t0 = new Date('2026-10-07T10:00:00Z');
  const created = mergeUsage(undefined, first, t0);
  assert.equal(created.day, '2026-10-07');
  assert.equal(created.events.length, 1);
  const second = validateUsage(batch({ seq: 1, final: true, active: 80, scroll: 60, parts: { welcome: 10, 'child-details': 40, 'parent-details': 30 }, order: ['welcome', 'child-details', 'parent-details'], events: [{ t: 70, type: 'save-failed', part: 'parent-details' }] })).data as UsageBatch;
  const merged = mergeUsage(created, second, new Date('2026-10-07T10:02:00Z'));
  assert.equal(merged.active, 80);
  assert.equal(merged.scroll, 63, 'the deepest scroll is kept');
  assert.deepEqual(merged.order, ['welcome', 'child-details', 'parent-details']);
  assert.equal(merged.parts['child-details'], 40);
  assert.equal(merged.final, true);
  assert.equal(merged.events.length, 2);
  // The same batch arriving twice (a retried beacon) adds nothing, and an older one cannot lower the totals.
  assert.equal(mergeUsage(merged, second, new Date()).events.length, 2);
  const late = mergeUsage(merged, first, new Date());
  assert.equal(late.active, 80);
  assert.equal(late.seq, 1);
  assert.equal(late.day, '2026-10-07', 'the day the view started stays');
});

test('the summary shows each form step, where people stopped and what they had to fix', () => {
  const finishedView = { page: '/take-part/consent/', app: 'family', variant: 'parent', device: 'phone', day: '2026-10-07', ref: '/dua/', active: 300, scroll: 90, order: ['welcome', 'child-details', 'parent-details', 'parent-consent', 'done'], parts: { welcome: 10, 'child-details': 40, 'parent-details': 60, 'parent-consent': 90, done: 5 }, events: [{ type: 'errors', part: 'child-details', fields: ['child-year-group'] }] };
  const stoppedView = { page: '/take-part/consent/', app: 'family', variant: 'parent', device: 'computer', day: '2026-10-07', ref: '', active: 120, scroll: 70, order: ['welcome', 'child-details', 'parent-details'], parts: { welcome: 20, 'child-details': 30, 'parent-details': 70 }, events: [{ type: 'errors', part: 'parent-details', fields: ['parent-postcode'] }, { type: 'errors', part: 'parent-details', fields: ['parent-postcode', 'parent-address'] }, { type: 'save-failed', part: 'parent-details' }] };
  const infoView = { page: '/information/', app: null, variant: null, device: 'phone', day: '2026-10-06', ref: 'ext:www.google.com', active: 95, scroll: 40, order: ['about', 'share', 'taking-part'], parts: { about: 30, share: 25, 'taking-part': 40 }, events: [{ type: 'click', part: 'share', to: '/take-part/consent/?who=parent', label: 'Share screen time online →' }] };
  const s = summariseUsage([finishedView, stoppedView, infoView], { from: '2026-10-01', to: '2026-10-07' });
  assert.equal(s.views, 3);
  assert.deepEqual(s.devices, { phone: 2, tablet: 0, computer: 1 });
  assert.deepEqual(s.byDay, [{ day: '2026-10-06', views: 1 }, { day: '2026-10-07', views: 2 }]);
  const form = s.pages.find((p) => p.app === 'family')!;
  assert.equal(form.views, 2);
  assert.equal(form.finished, 1);
  assert.equal(form.saveFailures, 1);
  assert.deepEqual(form.parts.map((p) => p.part), ['welcome', 'child-details', 'parent-details', 'parent-consent', 'done']);
  const details = form.parts.find((p) => p.part === 'parent-details')!;
  assert.equal(details.reached, 2);
  assert.equal(details.share, 100);
  assert.equal(details.medianSeconds, 65);
  assert.equal(details.lastHere, 1, 'one family stopped on the parent details');
  assert.equal(details.errorViews, 1);
  assert.deepEqual(details.errors, [{ field: 'parent-postcode', count: 2 }, { field: 'parent-address', count: 1 }]);
  const info = s.pages.find((p) => p.page === '/information/')!;
  assert.equal(info.finished, null);
  assert.deepEqual(info.clicks, [{ to: '/take-part/consent/?who=parent', label: 'Share screen time online →', count: 1 }]);
  assert.deepEqual(info.sources, [{ ref: 'ext:www.google.com', count: 1 }]);
});
