import assert from 'node:assert/strict';
import { test } from 'node:test';
import { healthOf, healthText } from './health.js';

const now = new Date('2026-10-17T12:00:00Z');
const empty = { submissions: [], donations: [], participants: [], consents: [], assents: [], labParticipants: [], labConsents: [], labDonations: [], labStories: [], labStoryChats: [], labBookings: [], labSlots: [] };
const image = (uploadId: string, path = `donations/p1/${uploadId}.png`) => ({ uploadId, path });

test('records that hold what they say, with every file stored, check out', () => {
  const r = healthOf(
    {
      ...empty,
      submissions: [{ id: 'MPMB-A', data: { kind: 'consent', participantId: 'p1', consentId: 'c1', imageCount: 2, donationIds: ['d1'] } }],
      donations: [{ id: 'd1', data: { participantId: 'p1', images: [image('u1'), image('u2')] } }],
      participants: [{ id: 'p1', data: {} }],
      consents: [{ id: 'c1', data: {} }],
      labParticipants: [{ id: 'MP1', data: { consentId: 'lc1', archiveCount: 1, screenshotCount: 1, storyIds: ['s1'], storyCounts: { pre: 1 } } }],
      labConsents: [{ id: 'lc1', data: {} }],
      labDonations: [{ id: 'ld1', data: { participantCode: 'MP1', files: [{ uploadId: 'f1', kind: 'archive', path: 'lab/MP1/f1.zip' }, { uploadId: 'f2', kind: 'screenshot', path: 'lab/MP1/f2.png' }] } }],
      labStories: [{ id: 's1', data: { participantCode: 'MP1', phase: 'pre' } }],
      labSlots: [{ id: 't1', data: { booked: 1, capacity: 2 } }],
      labBookings: [{ id: 'b1', data: { participantCode: 'MP1', slotId: 't1', visit: 1, status: 'booked' } }],
    },
    new Set(['donations/p1/u1.png', 'donations/p1/u2.png', 'lab/MP1/f1.zip', 'lab/MP1/f2.png']),
    [],
    now,
  );
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.checked.screenshots, 2);
  assert.match(healthText(r), /Everything checks out/);
});

test('a missing file, a wrong count, a screenshot stored twice and an overbooked time are each reported, with what to do', () => {
  const r = healthOf(
    {
      ...empty,
      submissions: [{ id: 'MPMB-A', data: { kind: 'consent', participantId: 'p1', imageCount: 3, donationIds: ['d1', 'd2'] } }],
      donations: [
        { id: 'd1', data: { participantId: 'p1', images: [image('u1')] } },
        { id: 'd2', data: { participantId: 'p1', images: [image('u1')] } },
        { id: 'd3', data: { participantId: 'p9', images: [image('u3')] } },
      ],
      participants: [{ id: 'p1', data: {} }],
      labParticipants: [{ id: 'MP1', data: { storyIds: [], storyCounts: { post: 1 } } }],
      labStories: [{ id: 's1', data: { participantCode: 'MP1', phase: 'post' } }],
      labSlots: [{ id: 't1', data: { booked: 2, capacity: 1 } }],
      labBookings: [
        { id: 'b1', data: { participantCode: 'MP1', slotId: 't1', visit: 1, status: 'booked' } },
        { id: 'b2', data: { participantCode: 'MP1', slotId: 't1', visit: 1, status: 'booked' } },
      ],
    },
    new Set(['donations/p1/u1.png']),
    [{ name: 'quarantine/x/y', created: '2026-10-17T09:00:00Z' }, { name: 'quarantine/x/z', created: '2026-10-17T11:45:00Z' }],
    now,
  );
  const what = r.problems.map((p) => p.what);
  assert.equal(r.ok, false);
  assert.ok(what.includes('A screenshot on a record is not in storage'));
  assert.ok(what.includes('A record’s screenshot count does not match the screenshots it holds'));
  assert.ok(what.includes('The same screenshot is stored twice'));
  assert.ok(what.includes('A screenshot send is on no record'));
  assert.ok(what.includes('A participant’s MyStory stories and their record disagree'));
  assert.ok(what.includes('A lab time’s bookings do not match its count, or it is booked past its spaces'));
  assert.ok(what.includes('A participant has the same visit booked twice'));
  // Only uploads over an hour old are counted as never saved.
  assert.match(r.notes[0], /^1 upload was added on a phone but never saved/);
  assert.match(healthText(r), /PROBLEM \(schools study\): A screenshot on a record is not in storage: 1\.\nWhat to do:/);
});
