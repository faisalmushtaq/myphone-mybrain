import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimFrom, confirmTarget, countsFor, DEFAULT_SETTINGS, eligibilityFor, matchingSessions, mayDo, waitingFor, type Claim, type SessionLite } from './portalCore.js';

const today = '2026-11-04';
const sessions: SessionLite[] = [
  { id: 's1', kind: 'training', date: '2026-10-20', title: 'EEG set-up training', attendees: ['a'], role: 'eeg' },
  { id: 's2', kind: 'pilot', date: '2026-10-28', title: 'GSAL pilot', attendees: [] },
  { id: 's3', kind: 'training', date: '2026-11-20', title: 'Future training', attendees: [] },
  { id: 's4', kind: 'training', date: '2026-10-28', title: 'Co-production training', attendees: [] },
];
const claim = (over: Partial<Claim>): Claim => ({ id: 'c', uid: 'b', status: 'waiting', sessionId: null, kind: 'training', date: '2026-10-20', title: 'x', role: null, notes: '', ranBy: '', reason: '', ...over });

test('an RA logs a session the team recorded, always for themselves', () => {
  const r = claimFrom({ sessionId: 's1', uid: 'someone-else' }, 'b', today, sessions, []);
  assert.ok('claim' in r);
  assert.equal(r.claim.uid, 'b');
  assert.equal(r.claim.title, 'EEG set-up training');
  assert.equal(r.claim.role, 'eeg');
});

test('refuses future sessions, sessions already theirs and the same entry twice', () => {
  assert.match((claimFrom({ sessionId: 's3' }, 'b', today, sessions, []) as { error: string }).error, /not happened/);
  assert.match((claimFrom({ sessionId: 's1' }, 'a', today, sessions, []) as { error: string }).error, /already recorded/);
  assert.match((claimFrom({ sessionId: 's2' }, 'b', today, sessions, [claim({ sessionId: 's2' })]) as { error: string }).error, /already said/);
  assert.match((claimFrom({ kind: 'pilot', date: '2026-12-01', title: 'Later' }, 'b', today, sessions, []) as { error: string }).error, /future/);
  assert.match((claimFrom({ kind: 'pilot', date: '2026-10-01', title: 'x' }, 'b', today, sessions, []) as { error: string }).error, /Say what it was/);
  const dup = claim({ kind: 'pilot', date: '2026-10-01', title: 'School pilot' });
  assert.match((claimFrom({ kind: 'pilot', date: '2026-10-01', title: 'school  PILOT' }, 'b', today, sessions, [dup]) as { error: string }).error, /already logged/);
});

test('an RA describes a new session; a role only for training', () => {
  const r = claimFrom({ kind: 'pilot', date: '2026-10-28', title: 'Pilot at GSAL', role: 'eeg', ranBy: 'Sarmad' }, 'b', today, sessions, []);
  assert.ok('claim' in r);
  assert.equal(r.claim.sessionId, null);
  assert.equal(r.claim.role, null);
  assert.equal(r.claim.ranBy, 'Sarmad');
});

test('waiting entries are counted apart and never towards eligibility', () => {
  const claims = [claim({ kind: 'training' }), claim({ kind: 'pilot' }), claim({ kind: 'pilot', status: 'confirmed' }), claim({ uid: 'z' })];
  assert.deepEqual(waitingFor('b', claims), { training: 1, pilots: 1 });
  const counts = countsFor('b', sessions);
  assert.deepEqual([counts.training, counts.pilots], [0, 0]);
  const e = eligibilityFor('b', new Map(), [], counts, { ...DEFAULT_SETTINGS, minTraining: 1, minPilots: 1 }, today);
  assert.equal(e.eligible, false);
  // Once confirmed, the session carries them and they count.
  const after = sessions.map((s) => (s.id === 's2' ? { ...s, attendees: ['b'] } : s));
  assert.equal(countsFor('b', after).pilots, 1);
});

test('matching sessions: same kind and date, closest title first', () => {
  assert.deepEqual(matchingSessions({ kind: 'training', date: '2026-10-28', title: 'co-production' }, sessions), ['s4']);
  assert.deepEqual(matchingSessions({ kind: 'pilot', date: '2026-10-28', title: 'pilot GSAL' }, sessions), ['s2']);
  assert.deepEqual(matchingSessions({ kind: 'pilot', date: '2026-10-29', title: 'pilot' }, sessions), []);
});

test('where a confirmed entry goes', () => {
  assert.deepEqual(confirmTarget({ sessionId: 's1', kind: 'training' }, 'new', sessions), { sessionId: 's1' });
  assert.match(confirmTarget({ sessionId: 'gone', kind: 'training' }, undefined, sessions).error ?? '', /deleted/);
  assert.deepEqual(confirmTarget({ sessionId: null, kind: 'pilot' }, 'new', sessions), { sessionId: null });
  assert.deepEqual(confirmTarget({ sessionId: null, kind: 'pilot' }, 's2', sessions), { sessionId: 's2' });
  assert.match(confirmTarget({ sessionId: null, kind: 'pilot' }, 's4', sessions).error ?? '', /training session/);
});

test('who may log, see and confirm', () => {
  for (const a of ['my-training', 'claim-session', 'delete-claim']) {
    assert.equal(mayDo(a, 'ra', 'active'), true, a);
    assert.equal(mayDo(a, 'ra', 'pending'), false, a);
  }
  for (const a of ['training-claims', 'confirm-claims', 'decline-claim']) {
    assert.equal(mayDo(a, 'ra', 'active'), false, a);
    assert.equal(mayDo(a, 'researcher', 'active'), true, a);
    assert.equal(mayDo(a, 'pm', 'active'), true, a);
  }
});
