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
