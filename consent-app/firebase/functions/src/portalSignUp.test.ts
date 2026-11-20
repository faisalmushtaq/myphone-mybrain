import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { leadingZeroBits, POW_BITS, proofOk, signUpInput } from './portalSignUp.js';

const solve = (email: string, ts: number, bits: number) => {
  for (let i = 0; ; i++) {
    const nonce = i.toString(36);
    if (leadingZeroBits(createHash('sha256').update(`${email}|${ts}|${nonce}`).digest()) >= bits) return nonce;
  }
};

test('leading zero bits are counted across bytes', () => {
  assert.equal(leadingZeroBits(Buffer.from([0x80, 0])), 0);
  assert.equal(leadingZeroBits(Buffer.from([0x01, 0xff])), 7);
  assert.equal(leadingZeroBits(Buffer.from([0, 0x10])), 11);
  assert.equal(leadingZeroBits(Buffer.from([0, 0])), 16);
});

test('a sign-up needs a recent proof of work for its own address', () => {
  const ts = 1_800_000_000_000;
  const nonce = solve('ra@leeds.ac.uk', ts, POW_BITS);
  assert.ok(proofOk('ra@leeds.ac.uk', ts, nonce, ts + 1000));
  assert.ok(!proofOk('other@leeds.ac.uk', ts, nonce, ts + 1000), 'another address');
  assert.ok(!proofOk('ra@leeds.ac.uk', ts, nonce, ts + 11 * 60_000), 'too old');
  assert.ok(!proofOk('ra@leeds.ac.uk', ts + 1, nonce, ts + 1000), 'another time');
  assert.ok(!proofOk('ra@leeds.ac.uk', ts, 'NOT VALID', ts));
  assert.ok(!proofOk('ra@leeds.ac.uk', NaN, nonce, ts));
});

test('sign-up input: address, password and the hidden field', () => {
  assert.equal(typeof signUpInput({ email: 'nope', password: 'longenough1' }), 'string');
  assert.equal(typeof signUpInput({ email: 'a@b.com', password: 'short' }), 'string');
  const ok = signUpInput({ email: ' RA@Leeds.ac.uk ', password: 'longenough1', ts: 5, nonce: 'ab' });
  assert.deepEqual(ok, { email: 'ra@leeds.ac.uk', password: 'longenough1', ts: 5, nonce: 'ab', bot: false });
  const bot = signUpInput({ email: 'a@b.com', password: 'longenough1', website: 'http://spam' });
  assert.ok(typeof bot !== 'string' && bot.bot);
});
