import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkInNumberNow, checkInShotsOf, checkInsDone, checkInsOf } from './checkIns.js';

const v1 = new Date('2026-10-14T09:00:00Z');
const on = (day: number) => new Date(v1.getTime() + day * 86_400_000);

test('weekly check-ins: which one is open, from the day of the break', () => {
  assert.equal(checkInNumberNow(null, on(3)), 1, 'no first visit: the first');
  assert.deepEqual([3, 8, 14, 15, 21, 22, 28, 29, 34].map((d) => checkInNumberNow(v1, on(d))), [1, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('a record from before weekly check-ins keeps its one check-in as the halfway one', () => {
  const legacy = { checkInIds: ['kold'], phaseCounts: { mid: { screenshots: 1 } }, storyCounts: { mid: 1 } };
  assert.deepEqual(checkInsOf(legacy), { 2: 'kold' });
  assert.equal(checkInShotsOf(legacy, 'kold'), 1);
  assert.deepEqual(checkInsDone(legacy), [2]);
});

test('complete: answers and a screenshot, and MyStory for the halfway one', () => {
  const p = { checkInByNumber: { '1': 'ka', '2': 'kb', '3': 'kc' }, checkInShots: { ka: 1, kb: 2 }, storyCounts: { mid: 0 } };
  assert.deepEqual(checkInsDone(p), [1], 'the halfway one waits for its story, the third for its screenshot');
  assert.deepEqual(checkInsDone({ ...p, storyCounts: { mid: 1 } }), [1, 2]);
});
