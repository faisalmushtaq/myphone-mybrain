import assert from 'node:assert/strict';
import { test } from 'node:test';
import { perDay, summarise } from './dashboard.js';

const now = new Date('2026-10-16T12:00:00Z');
const sub = (id: string, d: Record<string, unknown>) => ({ id, data: { kind: 'consent', participantId: `p-${id}`, createdAt: '2026-10-15T10:00:00Z', ...d } });

test('the schools study: saved, yes to sharing, sent, and the rest', () => {
  const out = summarise(
    {
      submissions: [
        sub('a', { phoneSource: 'parent', imageCount: 2, surveyId: 's1' }),
        sub('b', { phoneSource: 'child', imageCount: 0, assentId: 'x1' }),
        sub('c', { phoneSource: 'child', imageCount: 0, assentId: 'x2' }),
        sub('d', { phoneSource: 'none' }),
        sub('e', { phoneSource: null }),
        { id: 'lab', data: { kind: 'lab' } },
      ],
      participants: new Map([['p-a', { schoolId: 'DUA' }], ['p-b', { schoolId: 'DUA' }], ['p-c', { schoolId: 'GSAL' }]]),
      assents: new Map([['x1', { status: 'completed' }], ['x2', { status: 'declined' }]]),
      surveys: new Map([['s1', { status: 'completed' }]]),
      donationTimes: ['2026-10-16T09:00:00Z'],
      labParticipants: [],
      labBookings: [],
    },
    now,
  );
  assert.deepEqual(out.schools.stages.map((s) => s.n), [5, 3, 1]);
  assert.deepEqual(out.schools.other, { questionsAnswered: 1, youngAgreed: 1, saidNo: 1, noPhone: 0, youngSaidNo: 1, waiting: 1, screenshots: 2 });
  assert.equal(out.schools.bySchool.find((s) => s.id === 'DUA')?.sent, 1);
  assert.equal(out.schools.daily.started.at(-2)?.n, 5, 'yesterday');
  assert.equal(out.schools.daily.sent.at(-1)?.n, 1, 'today');
});

test('the break study leaves out the test accounts', () => {
  const out = summarise(
    {
      submissions: [],
      participants: new Map(),
      assents: new Map(),
      surveys: new Map(),
      donationTimes: [],
      labParticipants: [
        { id: 'MP1', data: { consentId: 'c', consentedAt: '2026-10-10T10:00:00Z', phaseCounts: { pre: { archives: 1, screenshots: 1 } }, checkInCount: 1, storyCounts: { pre: 1 } } },
        { id: 'MP2', data: { consentId: 'c', consentedAt: '2026-10-11T10:00:00Z' } },
        { id: 'MP9C78C162BB9F', data: { consentId: 'c', storyCounts: { pre: 5 } } },
      ],
      labBookings: [
        { participantCode: 'MP1', visit: 1, status: 'attended' },
        { participantCode: 'MP9C78C162BB9F', visit: 1, status: 'attended' },
      ],
    },
    now,
  );
  assert.deepEqual(out.breakStudy.stages.map((s) => s.n), [2, 1, 1, 1, 0, 0]);
  assert.deepEqual(out.breakStudy.stories, { pre: 1, mid: 0, post: 0 });
});

test('thirty UK days, oldest first', () => {
  const days = perDay(['2026-10-16T23:30:00Z'], now);
  assert.equal(days.length, 30);
  assert.equal(days.at(-1)?.day, '2026-10-16');
  assert.equal(days.reduce((n, d) => n + d.n, 0), 0, 'half past midnight UK time is tomorrow');
});
