import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storyChats } from './forms.js';
import { adaptPrompt, checkPrompt, unfaithful, withoutSentences, type CheckedSentence, cleanAdaptation, cosine, endedEarly, mockEmbedder, openAiEmbedder, revisePrompt, extractionPrompt, interviewerPrompt, matchesSchema, mockModel, openAiModel, safeguardingHits, scenarioPrompt, type ChatMessage, REASONING_ROOM, reasonsFirst
} from './storyPrompts.js';

test('each phase has its own chat protocol, read from its TOML file', () => {
  assert.deepEqual(
    (['pre', 'mid', 'post'] as const).map((p) => storyChats[p].key),
    ['np.sm_abstinence_pre', 'np.sm_abstinence_mid', 'np.sm_abstinence_post'],
  );
  for (const p of ['pre', 'mid', 'post'] as const) {
    const c = storyChats[p];
    assert.equal(c.model, 'gpt-6.1-sol');
    assert.ok(c.interview.questions.length >= 4);
    assert.ok(c.extractionKeys.length >= 10);
    assert.deepEqual(c.personas.map((x) => x.key), ['plain', 'casual', 'reflective']);
    assert.ok(c.screens.introAndConsent.includes("I'm Remi. I'm an AI bot"));
    assert.equal(c.screens.characterName, 'Remi');
    assert.ok(c.maxTurns >= 20 && c.maxTurns <= 40, 'MySelf allows 1 to 40 turns');
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

test('each persona writes from the answers given, and only those: no list of what was not said to fill or recite', () => {
  const c = storyChats.post;
  const p = scenarioPrompt(c, c.personas[2]!, Object.fromEntries(c.extractionKeys.map((k, i) => [k.key, i === 0 ? 'Sleeping better' : null])));
  assert.ok(p.system.startsWith(c.personas[2]!.text));
  assert.ok(p.system.includes('The scenario based on these responses:'), 'the one-shot example sets the register');
  assert.ok(p.messages[0]!.content.includes('Answer: Sleeping better'));
  assert.ok(!p.messages[0]!.content.includes('(they did not say)') && !p.messages[0]!.content.includes(c.extractionKeys[1]!.question), 'unanswered questions are left out');
  // The team's rules (protocols of 17 November 2026): only what they said, every question's answer in the story, in order.
  for (const persona of c.personas) {
    assert.ok(persona.text.includes('Use only what they actually said. Do not add feelings'), `${persona.key}: adds nothing`);
    assert.ok(persona.text.includes('check the story against every main question'), `${persona.key}: leaves no answer out`);
    assert.ok(persona.text.includes('Tell the story in this order'), `${persona.key}: in order`);
  }
  assert.ok(c.interview.topicRestriction.includes('Never ask for something they have already told you anywhere in the chat'));
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
  assert.equal(sent.model, 'gpt-6.1-sol');
  // A model that reasons first (18 November 2026): room for the reasoning, briefly, and the protocol's temperature.
  assert.equal(sent.max_completion_tokens, c.maxOutputTokens + REASONING_ROOM);
  assert.equal(sent.reasoning_effort, 'low');
  assert.ok(!('max_tokens' in sent));
  assert.equal(sent.temperature, c.temperature);
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
  const cut = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"sentences": [' }, finish_reason: 'length' }] }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(openAiModel('sk-test', cut)(checkPrompt([], 'A story.'), c), /cut off/, 'an answer cut off at the length limit is a failure, said as such');
  assert.equal(checkPrompt([], 'x').maxTokens, 3000, 'the check has room for every sentence');
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

test('a retelling is checked sentence by sentence against what was said; what is not is fixed, or cut', async () => {
  const c = storyChats.post;
  const transcript: ChatMessage[] = [{ role: 'assistant', content: 'How did it go?' }, { role: 'user', content: 'I slept better.' }];
  const story = 'I slept better. My HEALTHIER routine has lasted.';
  const check = checkPrompt(transcript, story);
  assert.ok(check.messages[0]!.content.includes('Human: I slept better.') && check.messages[0]!.content.includes('The story:\nI slept better.'));
  assert.equal(check.temperature, 0);
  const found = unfaithful((await mockModel<{ sentences: CheckedSentence[] }>(check, c)).output.sentences);
  assert.deepEqual(found.map((x) => [x.sentence, x.problem]), [['My HEALTHIER routine has lasted.', 'HEALTHIER']]);
  const revised = await mockModel<{ scenario: string }>(revisePrompt(story, found.map((x) => `"${x.sentence}": ${x.problem}`)), c);
  assert.equal(revised.output.scenario, 'I slept better. My routine has lasted.');
  assert.deepEqual(unfaithful((await mockModel<{ sentences: CheckedSentence[] }>(checkPrompt(transcript, revised.output.scenario), c)).output.sentences), []);
  assert.equal(withoutSentences('I slept better. It was GREAT and GREAT. Then I went out.', ['It was GREAT and GREAT.']), 'I slept better. Then I went out.');
});

test('similarity to their own words, measured as the original team did, by embedding', async () => {
  const [a, b, d] = await mockEmbedder(['I slept better and saw friends', 'I slept better and saw my friends', 'Pizza is round']);
  assert.ok(cosine(a!, b!) > cosine(a!, d!));
  assert.equal(cosine([1, 0], [1, 0]), 1);
  let sent: Record<string, unknown> = {};
  const fake = (async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await openAiEmbedder('sk-test', fake)(['x', 'y']), [[1, 0], [0, 1]], 'in the order sent');
  assert.equal(sent.model, 'text-embedding-3-small');
});

test('the control group’s chats before and after the 30 days never mention a break (6 November 2026)', async () => {
  const { storyChatsControl } = await import('./forms.js');
  for (const phase of ['pre', 'post'] as const) {
    const c = storyChatsControl[phase];
    // The one mention allowed is the interviewer's instruction never to bring it up.
    const everything = JSON.stringify(c).toLowerCase().replace('do not mention study groups, other participants or taking a break from social media.', '');
    for (const word of ['break', 'abstinence', 'off social media', 'stay off', 'slip']) assert.ok(!everything.includes(word), `control ${phase} mentions “${word}”`);
    assert.ok(c.interview.questions.length === (phase === 'pre' ? 7 : 8), `control ${phase} has the team's questions`);
    assert.ok(c.maxTurns >= 20 && c.maxTurns <= 40);
  }
});

test('the story writer sees the chat as well as the answers, so every main question can be checked (17 November 2026)', () => {
  const c = storyChats.pre;
  const transcript: ChatMessage[] = [{ role: 'assistant', content: 'What made you want to take part?' }, { role: 'user', content: 'My flatmate did it.' }];
  const p = scenarioPrompt(c, c.personas[0]!, { motivation_for_taking_part: 'Their flatmate did it' }, transcript);
  assert.ok(p.messages[0]!.content.includes('The chat:\nAI: What made you want to take part?\nHuman: My flatmate did it.'));
  assert.ok(p.messages[0]!.content.endsWith('Create a scenario based on these responses.'));
  assert.ok(!interviewerPrompt(c, []).system.includes('react to what they just said'), 'nothing in the template invites praise');
});


test('a model that refuses a temperature is asked again without it (18 November 2026)', async () => {
  const c = storyChats.post;
  const bodies: Record<string, unknown>[] = [];
  const fake = (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    if ('temperature' in bodies.at(-1)!) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'temperature' is not supported with this model." } }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: 'Hi', interviewDone: false, questionsCovered: [] }) }, finish_reason: 'stop' }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await openAiModel('sk-test', fake)<{ reply: string }>(interviewerPrompt(c, []), c);
  assert.equal(out.output.reply, 'Hi');
  assert.equal(bodies.length, 2);
  assert.ok(!('temperature' in bodies[1]!));
  assert.equal(reasonsFirst('gpt-4.1'), false);
  assert.equal(reasonsFirst('gpt-6.1-sol'), true);
});

test('each story style is shown its own example story when the protocol gives one (18 November 2026)', () => {
  for (const c of [storyChats.pre, storyChats.mid, storyChats.post]) {
    const by = (key: string) => scenarioPrompt(c, c.personas.find((p) => p.key === key)!, {}).system;
    assert.ok(by('plain').includes(c.example!.scenario), 'plain: the shared example');
    assert.ok(by('casual').includes(c.example!.byPersona!.casual!) && !by('casual').includes(c.example!.scenario), 'casual: its own');
    assert.ok(by('reflective').includes(c.example!.byPersona!.reflective!), 'diary: its own');
  }
});
