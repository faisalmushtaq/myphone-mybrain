import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { reminderMessage, reminderPlan } from './familyReminders.js';

const now = Date.parse('2026-10-20T10:00:00Z');
const base = { kind: 'consent', referenceCode: 'MPMB-ABCD-EF2', imageCount: 0 };

test('a reminder only while the screen time could still come', () => {
  assert.deepEqual(reminderPlan({ ...base, phoneSource: 'parent' }, 'not-started', now)?.kind, 'screenshots');
  assert.deepEqual(reminderPlan({ ...base, phoneSource: 'child' }, 'not-started', now)?.kind, 'young-part');
  assert.deepEqual(reminderPlan({ ...base, phoneSource: 'child' }, 'deferred', now)?.kind, 'young-part');
  assert.deepEqual(reminderPlan({ ...base, phoneSource: 'child' }, 'completed', now)?.kind, 'young-part', 'agreed but sent nothing');
  assert.equal(reminderPlan({ ...base, phoneSource: 'child', imageCount: 2 }, 'completed', now), null, 'screenshots came');
  assert.equal(reminderPlan({ ...base, phoneSource: 'child' }, 'declined', now), null, 'never after the young person’s no');
  assert.equal(reminderPlan({ ...base, phoneSource: 'none' }, null, now), null, 'never after the parent’s no');
  assert.equal(reminderPlan({ ...base, phoneSource: 'no-phone' }, null, now), null);
  assert.equal(reminderPlan({ ...base, phoneSource: null }, null, now), null, 'stopped before the question: nothing a link can finish');
  assert.equal(reminderPlan({ ...base, phoneSource: 'child', selfConsent: true }, 'not-started', now), null, 'a young person deciding alone gave no contact details');
});

test('a week after "screen time isn’t turned on", the reminder says it is ready', () => {
  const off = (days: number) => ({ ...base, phoneSource: 'child', screenTimeOffAt: Timestamp.fromMillis(now - days * 86_400_000) });
  assert.equal(reminderPlan(off(7), 'completed', now)?.kind, 'screen-time-on');
  assert.equal(reminderPlan(off(2), 'completed', now)?.kind, 'young-part', 'not yet a week');
  assert.ok(reminderPlan(off(7), 'completed', now)?.link.endsWith('?finish=MPMB-ABCD-EF2&for=young'));
});

test('the words: one link, why it matters, and how to stop', () => {
  const words = reminderMessage({ kind: 'young-part', link: 'https://myphonemybrain.com/take-part/consent/?finish=MPMB-ABCD-EF2&for=young' }, 'Kai', false);
  assert.ok(words.sms.includes('Kai hasn’t done their part yet') && words.sms.includes('?finish=MPMB-ABCD-EF2&for=young'));
  assert.ok(words.text.includes('guesses are often wrong by hours') && words.text.includes('we won’t send another'));
  assert.ok(reminderMessage({ kind: 'young-part', link: 'x?for=young' }, 'Kai', true).sms.includes('Kai opened their link'));
  assert.ok(words.sms.length < 400, 'a short text');
});
