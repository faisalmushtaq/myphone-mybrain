import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnquiry } from './enquiry.js';

const contact = { kind: 'contact', name: 'Priya Patel', email: 'priya@example.com', topic: 'Taking part', message: 'When does the study start at our school?', website: '' };
const school = { kind: 'school', name: 'Sam Lee', email: 'slee@school.example', role: 'Deputy head', school: 'Example High School', area: 'Bradford Council', pupils: '900', yearGroups: ['Year 8', 'Year 9'], canOfferSlots: true, message: '', website: '' };

test('accepts a contact message and fills in a default topic', () => {
  const r = validateEnquiry(contact);
  assert.deepEqual(r.problems, []);
  assert.equal(r.data?.topic, 'Taking part');
  assert.equal(validateEnquiry({ ...contact, topic: 'nonsense' }).data?.topic, 'Something else');
  assert.ok(validateEnquiry({ ...contact, message: '  ' }).problems.some((m) => m.includes('write your question')));
  assert.ok(validateEnquiry({ ...contact, email: 'nope' }).problems.some((m) => m.includes('email')));
});

test('a school must name two year groups and confirm the session slots', () => {
  assert.deepEqual(validateEnquiry(school).problems, []);
  assert.ok(validateEnquiry({ ...school, yearGroups: ['Year 8'] }).problems.some((m) => m.includes('two year groups')));
  assert.ok(validateEnquiry({ ...school, yearGroups: ['Year 8', 'Year 8'] }).problems.some((m) => m.includes('two year groups')));
  assert.ok(validateEnquiry({ ...school, canOfferSlots: false }).problems.some((m) => m.includes('two-hour')));
  assert.ok(validateEnquiry({ ...school, school: 'St' }).problems.some((m) => m.includes('school’s name')));
  assert.equal(validateEnquiry({ ...school, yearGroups: ['Year 8', 'Year 13', 'Year 10'] }).data?.yearGroups.length, 2);
});

test('rejects unknown forms, oversized text and bad shapes', () => {
  assert.ok(validateEnquiry({ ...contact, kind: 'other' }).problems.some((m) => m.includes('Unknown form')));
  assert.ok(validateEnquiry({ ...contact, message: 'x'.repeat(3001) }).problems.some((m) => m.includes('too long')));
  assert.ok(validateEnquiry('hello').problems.length === 1);
  assert.equal(validateEnquiry({ ...contact, website: 'http://spam.example' }).data?.website, 'http://spam.example');
});
