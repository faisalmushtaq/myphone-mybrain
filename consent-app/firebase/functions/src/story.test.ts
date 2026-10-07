import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storyStructures } from './forms.js';
import { tidyTriad, validateLabStoryPayload } from './story.js';

const client = { userAgent: 'test', submittedAt: new Date().toISOString(), timezoneOffset: 0 };

function story(over: Record<string, unknown> = {}) {
  const s = storyStructures.mid;
  return {
    participantCode: 'MP2670FF90A5F2',
    phase: 'mid',
    structureId: s.id,
    structureVersion: s.version,
    promptId: s.prompts[0].id,
    title: 'The bus',
    story: 'I reached for my phone on the bus and remembered Brick had blocked it.',
    answers: { pull: { a: 0.6, b: 0.3, c: 0.1 }, hard: 70, afterwards: 'na', where: 'travelling' },
    source: 'checkin',
    checkInId: null,
    client,
    ...over,
  };
}

test('each phase has its own structure, with prompts and signifiers', () => {
  for (const phase of ['pre', 'mid', 'post'] as const) {
    const s = storyStructures[phase];
    assert.equal(s.phase, phase);
    assert.ok(s.prompts.length >= 2);
    assert.ok(s.signifiers.some((x) => x.type === 'triad'));
    assert.equal(new Set(s.signifiers.map((x) => x.id)).size, s.signifiers.length, 'signifier ids are unique');
  }
  assert.notEqual(storyStructures.pre.id, storyStructures.post.id);
});

test('a story is accepted with any signifiers left out or answered "not sure"', () => {
  assert.deepEqual(validateLabStoryPayload(story()), []);
  assert.deepEqual(validateLabStoryPayload(story({ answers: {} })), []);
  assert.deepEqual(validateLabStoryPayload(story({ answers: { pull: 'na', hard: 'na' } })), []);
});

test('a story is refused when it does not fit its phase’s structure', () => {
  const problems = (over: Record<string, unknown>) => validateLabStoryPayload(story(over)).join(' | ');
  assert.match(problems({ phase: 'later' }), /phase/);
  assert.match(problems({ structureVersion: '0.0' }), /must use mystory-mid/);
  assert.match(problems({ phase: 'pre' }), /must use mystory-pre/);
  assert.match(problems({ promptId: 'other' }), /Choose one of the questions/);
  assert.match(problems({ title: '   ' }), /title/);
  assert.match(problems({ story: 'Too short' }), /at least a sentence/);
  assert.match(problems({ story: 'x'.repeat(6000) }), /under 5000/);
  assert.match(problems({ answers: { nope: 1 } }), /Unknown question "nope"/);
  assert.match(problems({ answers: { pull: { a: 0.6, b: 0.6, c: 0.1 } } }), /do not add up/);
  assert.match(problems({ answers: { pull: { a: 1, b: 0 } } }), /not three shares/);
  assert.match(problems({ answers: { hard: 101 } }), /between 0 and 100/);
  assert.match(problems({ answers: { where: 'moon' } }), /not one of its options/);
  assert.match(problems({ source: 'elsewhere' }), /page the story came from/);
});

test('triangle answers are stored as three shares that still add up to 1', () => {
  const t = tidyTriad({ a: 1, b: 1, c: 1 });
  assert.deepEqual(t, { a: 0.333, b: 0.333, c: 0.334 });
  assert.equal(Math.round((t.a + t.b + t.c) * 1000), 1000);
});
