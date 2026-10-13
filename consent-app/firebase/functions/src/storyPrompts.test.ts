import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storyChats } from './forms.js';
import { adaptPrompt, cleanAdaptation, endedEarly, extractionPrompt, interviewerPrompt, matchesSchema, mockModel, openAiModel, safeguardingHits, scenarioPrompt, type ChatMessage } from './storyPrompts.js';

test('each phase has its own chat protocol, read from its TOML file', () => {
  assert.deepEqual(
    (['pre', 'mid', 'post'] as const).map((p) => storyChats[p].key),
    ['np.sm_abstinence_pre', 'np.sm_abstinence_mid', 'np.sm_abstinence_post'],
  );
  for (const p of ['pre', 'mid', 'post'] as const) {
    const c = storyChats[p];
    assert.equal(c.model, 'gpt-4o');
    assert.ok(c.interview.questions.length >= 4);
    assert.ok(c.extractionKeys.length >= 10);
    assert.deepEqual(c.personas.map((x) => x.key), ['plain', 'casual', 'reflective']);
    assert.ok(c.screens.introAndConsent.includes("I'm Remi. I'm an AI bot"));
    assert.equal(c.screens.characterName, 'Remi');
    assert.equal(c.maxTurns, 20);
  }
  assert.notEqual(storyChats.pre.interview.questions[0], storyChats.mid.interview.questions[0], 'different questions per phase');
});

test('the interviewer is told the persona, the numbered questions and when to stop, never by a word a participant can type', () => {
  const c = storyChats.mid;
  const opening = interviewerPrompt(c, []);
  assert.ok(opening.system.startsWith(c.interview.persona));
  assert.ok(opening.system.includes(`1. ${c.interview.questions[0]}`) && opening.system.includes(`4. ${c.interview.questions[3]}`));
  assert.ok(opening.system.includes(`Once you have collected answers to all ${c.interview.questions.length} questions, set interviewDone to true.`));
  assert.ok(opening.system.includes('Leeds Crisis Assessment Centre 0800 183 1485'), 'the team’s safeguarding instructions reach the interviewer');
  assert.ok(!opening.system.includes('{first_name}'), 'no name, and no placeholder, goes to the model');
  assert.ok(!opening.system.includes('FINISHED'));
  assert.deepEqual(opening.messages, [{ role: 'user', content: '(the participant is ready)' }]);
  const later = interviewerPrompt(c, [{ role: 'assistant', content: 'Q?' }, { role: 'user', content: 'A.' }]);
  assert.equal(later.messages.length, 2, 'the transcript travels as messages, not pasted into the system text');
});

test('extraction asks for the researcher’s keys, every one required and nullable, cold', () => {
  const c = storyChats.pre;
  const p = extractionPrompt(c, [{ role: 'assistant', content: 'What apps?' }, { role: 'user', content: 'TikTok.' }]);
  assert.ok(p.messages[0]!.content.includes('Human: TikTok.') && p.messages[0]!.content.includes('AI: What apps?'));
  assert.ok(p.system.includes('`gratifications`') && p.system.includes('`fear_of_missing_out`'));
  assert.deepEqual((p.schema.schema as { required: string[] }).required, c.extractionKeys.map((k) => k.key));
  assert.ok((p.temperature ?? 1) <= 0.1);
});

test('each persona writes from the extraction, told what was not said rather than left to fill the gap', () => {
  const c = storyChats.post;
  const p = scenarioPrompt(c, c.personas[2]!, Object.fromEntries(c.extractionKeys.map((k, i) => [k.key, i === 0 ? 'Sleeping better' : null])));
  assert.ok(p.system.startsWith(c.personas[2]!.text));
  assert.ok(p.system.includes('The scenario based on these responses:'), 'the one-shot example sets the register');
  assert.ok(p.messages[0]!.content.includes('Answer: Sleeping better') && p.messages[0]!.content.includes('Answer: (they did not say)'));
  assert.ok(p.messages[0]!.content.endsWith('Create a scenario based on these responses.'));
  assert.ok(adaptPrompt('The story.', 'Shorter').messages[0]!.content.includes('What they want changed:\nShorter'));
});

test('safeguarding words raise a flag for the team; ordinary words do not', () => {
  const c = storyChats.mid;
  assert.deepEqual(safeguardingHits(c, 'Honestly some days I want to die'), [{ rule: 'distress_lexicon', tier: 'safeguarding_review', matched: 'want to die' }]);
  assert.deepEqual(safeguardingHits(c, 'People kept leaving me out'), [{ rule: 'online_harm_lexicon', tier: 'team_notification', matched: 'leaving me out' }]);
  assert.deepEqual(safeguardingHits(c, 'It was a good week'), []);
});

test('the stand-in model walks the whole protocol: questions in order, then retellings from the answers', async () => {
  const c = storyChats.mid;
  const transcript: ChatMessage[] = [];
  for (let i = 0; i < c.interview.questions.length; i += 1) {
    const turn = await mockModel<{ reply: string; interviewDone: boolean }>(interviewerPrompt(c, transcript), c);
    assert.equal(turn.output.interviewDone, false);
    assert.ok(turn.output.reply.endsWith(c.interview.questions[i]!));
    transcript.push({ role: 'assistant', content: turn.output.reply }, { role: 'user', content: `answer ${i + 1}` });
  }
  const last = await mockModel<{ interviewDone: boolean }>(interviewerPrompt(c, transcript), c);
  assert.equal(last.output.interviewDone, true);
  const ex = await mockModel<Record<string, string | null>>(extractionPrompt(c, transcript), c);
  assert.equal(ex.output.how_its_going, 'answer 1');
  assert.equal(ex.output[c.extractionKeys[c.interview.questions.length]!.key], null, 'more keys than answers: the rest are null, not invented');
  const sc = await mockModel<{ scenario: string }>(scenarioPrompt(c, c.personas[0]!, ex.output), c);
  assert.ok(sc.output.scenario.includes('answer 2'));
});

test('the OpenAI call sends the protocol’s model, structured output and no storage, and checks what comes back', async () => {
  const c = storyChats.pre;
  let sent: Record<string, unknown> = {};
  const fake = (async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: 'gpt-4o-2024-08-06', choices: [{ message: { content: JSON.stringify({ reply: 'Hi! Which apps?', interviewDone: false, questionsCovered: [] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await openAiModel('sk-test', fake)<{ reply: string }>(interviewerPrompt(c, []), c);
  assert.equal(out.output.reply, 'Hi! Which apps?');
  assert.equal(sent.model, 'gpt-4o');
  assert.equal(sent.store, false);
  assert.equal((sent.response_format as { type: string }).type, 'json_schema');
  assert.equal(out.usage.output, 5);

  const wrong = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"reply": 3}' } }] }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(openAiModel('sk-test', wrong)(interviewerPrompt(c, []), c), /schema/);
  let calls = 0;
  const refused = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
  }) as unknown as typeof fetch;
  await assert.rejects(openAiModel('sk-test', refused)(interviewerPrompt(c, []), c), /bad key/);
  assert.equal(calls, 1, 'a refused key is not retried');
});

test('schema check: required keys, no extras, the right types', () => {
  const schema = { required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: ['string', 'null'] } } };
  assert.equal(matchesSchema({ a: 'x', b: null }, schema), true);
  assert.equal(matchesSchema({ a: 'x' }, schema), false);
  assert.equal(matchesSchema({ a: 'x', b: 'y', c: 1 }, schema), false);
  assert.equal(matchesSchema({ a: 1, b: 'y' }, schema), false);
});

test('an interview that ends early is not retold: stopping partway, or after a disclosure, before the questions are done', async () => {
  const c = storyChats.mid;
  const all = c.interview.questions.map((_, i) => i + 1);
  assert.equal(endedEarly(c, all, true), false, 'every question answered: retold as normal, flag or not');
  assert.equal(endedEarly(c, [1], false), true, 'most questions unanswered');
  assert.equal(endedEarly(c, all.slice(0, -1), true), true, 'a disclosure and a question still to go');
  assert.equal(endedEarly(c, all.slice(0, -1), false), false, 'nearly done, nothing worrying: retold');
  assert.equal(endedEarly(c, undefined, false), true, 'nothing said about coverage counts as nothing covered');
  const turn = await mockModel<{ interviewDone: boolean; questionsCovered: number[] }>(interviewerPrompt(c, [{ role: 'assistant', content: 'Q1?' }, { role: 'user', content: 'Can we stop here please' }]), c);
  assert.equal(turn.output.interviewDone, true);
  assert.deepEqual(turn.output.questionsCovered, []);
});

test('the adaptation’s label is not kept as part of the story', () => {
  assert.equal(cleanAdaptation('The account:\nI slept better.'), 'I slept better.');
  assert.equal(cleanAdaptation('account: I slept better.'), 'I slept better.');
  assert.equal(cleanAdaptation('I slept better. The account: was fine.'), 'I slept better. The account: was fine.');
});
