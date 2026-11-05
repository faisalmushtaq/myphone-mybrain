import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PAUSED_MESSAGE, recruitmentFrom } from './recruitment.js';

test('recruitment is open until the team pauses it, with the default message when none was typed', () => {
  assert.deepEqual(recruitmentFrom(undefined), { break: { paused: false, message: DEFAULT_PAUSED_MESSAGE, changedAt: null }, control: { paused: false, message: DEFAULT_PAUSED_MESSAGE, changedAt: null } });
  const r = recruitmentFrom({ break: { paused: true, message: '  Full until January.  ', changedAt: '2026-11-05T18:00:00.000Z' }, control: { paused: 'yes', message: '' } });
  assert.equal(r.break.paused, true);
  assert.equal(r.break.message, 'Full until January.');
  assert.equal(r.control.paused, false, 'only true pauses');
  assert.equal(r.control.message, DEFAULT_PAUSED_MESSAGE);
  assert.equal(recruitmentFrom({ break: { paused: true, message: 'x'.repeat(900) } }).break.message.length, 400);
});

test('the waiting list takes one valid email address per group, and spots the hidden bot field', async () => {
  const { waitlistEntry, waitlistId, reopenEmail } = await import('./recruitment.js');
  assert.equal(waitlistEntry({ email: 'not an email' }), 'Please enter a valid email address.');
  assert.deepEqual(waitlistEntry({ email: '  Sam@Example.ac.uk ' }), { email: 'sam@example.ac.uk', group: 'break', bot: false });
  assert.deepEqual(waitlistEntry({ email: 'a@b.co', group: 'control', website: 'spam' }), { email: 'a@b.co', group: 'control', bot: true });
  assert.equal(waitlistId('a@b.co', 'break'), waitlistId('a@b.co', 'break'), 'the same address twice is one row');
  assert.notEqual(waitlistId('a@b.co', 'break'), waitlistId('a@b.co', 'control'));
  const mail = reopenEmail('break');
  assert.ok(mail.subject.includes('open again'));
  assert.ok(mail.text.includes('https://myphonemybrain.com/break/'));
  assert.ok(mail.text.includes('deleted from our list'));
});
