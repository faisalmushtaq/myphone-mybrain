import type { ChatProtocol } from './forms.js';

/**
 * MyStory's AI chat: the MySelf micro-narrative protocol (the KCL
 * "Micro-narratives" method: Skeggs et al., CHI 2025,
 * https://doi.org/10.1145/3706598.3713999), run by this site's own server.
 *
 * The four prompt templates and their output schemas are MySelf's
 * (packages/narrative/src/prompts.ts in the MySelf repository), reproduced
 * word for word: interviewer, extraction, persona retelling and adaptation.
 * Their wording is the method (reuse the participant's own words, no advice,
 * no diagnosis), so it is not to be improved upon here; change it in MySelf
 * and copy it across. Everything study-specific comes from the phase's TOML
 * file (src/lab/mystory/<phase>.toml).
 *
 * Nothing in this file touches the database, so the prompts and the model
 * call can be tested on their own.
 */

export type ChatRole = 'assistant' | 'user';
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export const INTERVIEWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'interviewDone', 'questionsCovered'],
  properties: {
    reply: {
      type: 'string',
      description:
        'What to say next, as a message in a chat. React briefly to what they just said first — a few words, warm and ' +
        'specific to their answer, never a compliment on the answer itself — and then ask. If their last answer was ' +
        'one or two words, do not move on: ask them to say a bit more about that same thing. Never advice, never a ' +
        'diagnosis, never a summary of what they have told you so far. When interviewDone is true this field is ' +
        'discarded without being shown, so nothing written there reaches anybody.',
    },
    interviewDone: {
      type: 'boolean',
      description:
        'True only when every question on the list has been genuinely answered. Setting this true ends the ' +
        'conversation immediately, so do not set it in the same turn as a question you want answered.',
    },
    questionsCovered: {
      type: 'array',
      items: { type: 'integer' },
      description: 'Indices of the questions answered so far, from the numbered list.',
    },
  },
} as const;

export const ADAPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['newScenario', 'changed'],
  properties: {
    newScenario: { type: 'string', description: 'The retelling, revised as the participant asked.' },
    changed: { type: 'boolean', description: 'False if the request could not be honoured from their words alone.' },
  },
} as const;

export const SCENARIO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenario', 'confidence'],
  properties: {
    scenario: { type: 'string', description: "The retelling, in this persona's voice." },
    confidence: {
      type: 'string',
      enum: ['clear', 'partly_clear', 'unclear'],
      description: "How clearly the participant's account supported this retelling.",
    },
  },
} as const;

/** Extraction returns the researcher's keys, each required and nullable: "did not say" is an answer. */
export function extractionSchema(keys: { key: string; question: string }[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: keys.map((k) => k.key),
    properties: Object.fromEntries(keys.map(({ key, question }) => [key, { type: ['string', 'null'], description: question }])),
  };
}

export const INTERVIEWER_SYSTEM = [
  '{persona}',
  '',
  'Your goal is to gather structured answers to the following questions:',
  '',
  '{questions}',
  'Ask each question one at a time.',
  '{language_style}',
  'Ensure you get at least a basic answer to each question before moving to the next.',
  'Talk like a person in a chat: react to what they just said before you ask the next thing.',
  'A one or two word answer is not a basic answer — ask them to say a bit more about that same thing before moving on.',
  'Never answer for the human. If you are unsure what the human meant, ask again.',
  '{topic_restriction}',
  '{collection_complete}, set interviewDone to true. Whatever you write in reply on that turn is discarded and ' +
    'never shown, so do not try to close the conversation: it is closed by the app, which says what happens next.',
].join('\n');

export const collectionComplete = (count: number): string =>
  count === 1 ? 'Once you have collected an answer to the question' : `Once you have collected answers to all ${count} questions`;

export const EXTRACTION_SYSTEM = [
  'You are an expert extraction algorithm.',
  'Only extract relevant information from the Human answers in the text.',
  'Use only the words and phrases that the text contains.',
  "If you do not know the value of an attribute asked to extract, return null for the attribute's value.",
  '',
  'You will output a JSON with {keys_string} keys.',
  '',
  '{questions}',
  'Remember, only extract text that is in the messages above and do not change it.',
].join('\n');

export const SCENARIO_SYSTEM = ['{persona}', '{one_shot}', 'Your task:', 'Create a scenario based on the following answers:'].join('\n');
export const SCENARIO_CLOSE = 'Create a scenario based on these responses.';

export const ADAPT_SYSTEM = [
  "You're a helpful assistant, helping a participant adapt a scenario to their liking.",
  'Suggest an alternative version of the scenario.',
  "Keep the language and content as similar as possible, while fulfilling the participant's request.",
  'You may only use what they have said, here or earlier. If their request cannot be honoured from their own',
  'words, return the scenario unchanged and set changed to false.',
].join('\n');

export const numberedQuestions = (questions: string[]): string => questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

export function keysString(keys: string[]): string {
  const quoted = keys.map((k) => `\`${k}\``);
  if (quoted.length === 0) return '';
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted[quoted.length - 1]}`;
}

export function keyQuestions(keys: { question: string }[]): string {
  const heading = `These correspond to the following question${keys.length === 1 ? '' : 's'}:`;
  return [heading, ...keys.map((k, i) => `${i + 1}: ${k.question}`)].join('\n');
}

export function oneShot(protocol: ChatProtocol): string {
  const example = protocol.example;
  if (!example) return '';
  return ['', 'Example:', example.conversation.trim(), '', 'The scenario based on these responses:', `"${example.scenario.trim()}"`, ''].join('\n');
}

/* ── The four prompts, assembled for one protocol ───────────────────────── */

export interface Prompt {
  key: string;
  system: string;
  messages: ChatMessage[];
  schema: { name: string; schema: Record<string, unknown> };
  /** Extraction runs cold, as in the original. */
  temperature?: number;
}

export function interviewerPrompt(protocol: ChatProtocol, transcript: ChatMessage[]): Prompt {
  const i = protocol.interview;
  const system = INTERVIEWER_SYSTEM.replace('{persona}', i.persona)
    .replace('{language_style}', i.languageStyle)
    .replace('{topic_restriction}', i.topicRestriction)
    .replace('{questions}', numberedQuestions(i.questions))
    .replace('{collection_complete}', collectionComplete(i.questions.length));
  return {
    key: 'pt.interviewer',
    system,
    messages: transcript.length > 0 ? [...transcript] : [{ role: 'user', content: '(the participant is ready)' }],
    schema: { name: 'interviewer_turn', schema: INTERVIEWER_SCHEMA as unknown as Record<string, unknown> },
  };
}

export function extractionPrompt(protocol: ChatProtocol, transcript: ChatMessage[]): Prompt {
  const keys = protocol.extractionKeys;
  const conversation = transcript.map((m) => `${m.role === 'user' ? 'Human' : 'AI'}: ${m.content}`).join('\n');
  return {
    key: 'pt.extraction',
    system: EXTRACTION_SYSTEM.replace('{keys_string}', keysString(keys.map((k) => k.key))).replace('{questions}', keyQuestions(keys)),
    messages: [{ role: 'user', content: `Message to date:\n${conversation}` }],
    schema: { name: 'extraction', schema: extractionSchema(keys) },
    temperature: Math.min(protocol.temperature, 0.1),
  };
}

export function scenarioPrompt(protocol: ChatProtocol, persona: { key: string; text: string }, extraction: Record<string, string | null>): Prompt {
  const answers =
    protocol.extractionKeys.map(({ key, question }) => `Question: ${question}\nAnswer: ${extraction[key] ?? '(they did not say)'}`).join('\n') + `\n\n${SCENARIO_CLOSE}`;
  return {
    key: `pt.scenario.${persona.key}`,
    system: SCENARIO_SYSTEM.replace('{persona}', persona.text).replace('{one_shot}', oneShot(protocol)),
    messages: [{ role: 'user', content: answers }],
    schema: { name: 'scenario', schema: SCENARIO_SCHEMA as unknown as Record<string, unknown> },
  };
}

export function adaptPrompt(scenario: string, request: string): Prompt {
  return {
    key: 'pt.adaptation',
    system: ADAPT_SYSTEM,
    messages: [{ role: 'user', content: `The account:\n${scenario}\n\nWhat they want changed:\n${request}` }],
    schema: { name: 'adaptation', schema: ADAPT_SCHEMA as unknown as Record<string, unknown> },
  };
}

/* ── Safeguarding: lexicon rules raise a flag for the team, nothing more ── */

export function safeguardingHits(protocol: ChatProtocol, text: string): { rule: string; tier: string; matched: string }[] {
  const lower = text.toLowerCase();
  const hits: { rule: string; tier: string; matched: string }[] = [];
  for (const rule of protocol.safeguarding) {
    const matched = rule.terms.find((t) => lower.includes(t));
    if (matched) hits.push({ rule: rule.key, tier: rule.tier, matched });
  }
  return hits;
}

/* ── The model: OpenAI's chat completions, with structured output ───────── */

export interface ModelResult<T> {
  output: T;
  raw: string;
  model: string;
  usage: { input: number; output: number };
}

export class ModelError extends Error {
  constructor(
    readonly kind: 'transport' | 'timeout' | 'rate_limit' | 'auth' | 'safety_block' | 'malformed_output' | 'unknown',
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

export type ModelCall = <T>(prompt: Prompt, protocol: ChatProtocol) => Promise<ModelResult<T>>;

/** Calls OpenAI with the protocol's model settings, retrying what is worth retrying. */
export function openAiModel(apiKey: string, fetchImpl: typeof fetch = fetch): ModelCall {
  return async <T>(prompt: Prompt, protocol: ChatProtocol): Promise<ModelResult<T>> => {
    let last: ModelError | null = null;
    for (let attempt = 1; attempt <= protocol.maxAttempts; attempt += 1) {
      try {
        return await callOnce<T>(apiKey, prompt, protocol, fetchImpl);
      } catch (error) {
        last = error instanceof ModelError ? error : new ModelError('unknown', String(error), false);
        if (!last.retryable || attempt === protocol.maxAttempts) break;
        await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)));
      }
    }
    throw last ?? new ModelError('unknown', 'no attempt was made', false);
  };
}

async function callOnce<T>(apiKey: string, prompt: Prompt, protocol: ChatProtocol, fetchImpl: typeof fetch): Promise<ModelResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), protocol.timeoutSeconds * 1000);
  let response: Response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: protocol.model,
        temperature: prompt.temperature ?? protocol.temperature,
        max_tokens: protocol.maxOutputTokens,
        messages: [{ role: 'system', content: prompt.system }, ...prompt.messages],
        response_format: { type: 'json_schema', json_schema: { name: prompt.schema.name, schema: prompt.schema.schema, strict: true } },
        store: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw controller.signal.aborted ? new ModelError('timeout', `no response within ${protocol.timeoutSeconds}s`) : new ModelError('transport', String(error));
  } finally {
    clearTimeout(timer);
  }
  const data = (await response.json().catch(() => ({}))) as {
    model?: string;
    choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (!response.ok) {
    const message = data.error?.message ?? `HTTP ${response.status}`;
    if (response.status === 401 || response.status === 403) throw new ModelError('auth', message, false);
    if (response.status === 429) throw new ModelError('rate_limit', message);
    if (response.status >= 500) throw new ModelError('transport', message);
    throw new ModelError('unknown', message, false);
  }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) throw new ModelError('safety_block', 'the provider refused to answer this prompt', false);
  const raw = choice?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) throw new ModelError('malformed_output', 'the model returned nothing', false);
  let output: T;
  try {
    output = JSON.parse(raw) as T;
  } catch {
    throw new ModelError('malformed_output', 'the model did not return JSON', false);
  }
  if (!matchesSchema(output, prompt.schema.schema)) throw new ModelError('malformed_output', 'the model output did not match the schema', false);
  return { output, raw, model: data.model ?? protocol.model, usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 } };
}

/** Checks the output against the schema it was asked for: the keys, and each value's type. */
export function matchesSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const props = (schema.properties ?? {}) as Record<string, { type?: string | string[]; enum?: string[] }>;
  const required = (schema.required ?? []) as string[];
  const v = value as Record<string, unknown>;
  if (!required.every((k) => k in v)) return false;
  if (Object.keys(v).some((k) => !(k in props))) return false;
  for (const [k, spec] of Object.entries(props)) {
    if (!(k in v)) continue;
    const types = Array.isArray(spec.type) ? spec.type : [spec.type];
    const x = v[k];
    const ok = types.some((t) => (t === 'null' ? x === null : t === 'array' ? Array.isArray(x) : t === 'integer' ? Number.isInteger(x) : typeof x === t));
    if (!ok) return false;
    if (spec.enum && !spec.enum.includes(x as string)) return false;
  }
  return true;
}

/**
 * A stand-in for the model, for the emulator and the tests: asks the
 * protocol's questions in order, extracts the answers as given, and writes
 * each persona's retelling from them. Deterministic, costs nothing, and never
 * leaves the machine.
 */
/**
 * Whether an interview the model closed has ended early: the participant
 * asked to stop, or said something the team must review, before the
 * questions were answered. Writing a story from half a conversation, or from
 * a disclosure, and asking them to choose and rate it is the wrong thing to
 * do: the chat stops gently instead, and their own words are kept.
 */
export function endedEarly(protocol: ChatProtocol, questionsCovered: unknown, distressFlagged: boolean): boolean {
  const total = protocol.interview.questions.length;
  const covered = Array.isArray(questionsCovered) ? new Set(questionsCovered.filter((n) => Number.isInteger(n) && n >= 1 && n <= total)).size : 0;
  if (covered >= total) return false;
  return distressFlagged || covered < Math.ceil(total / 2);
}

/** The adaptation sometimes comes back headed with the label it was given ("The account:"); the story is what follows. */
export function cleanAdaptation(text: string): string {
  return text.replace(/^\s*(?:the\s+)?(?:account|new scenario|scenario)\s*:\s*/i, '').trim();
}

export const mockModel: ModelCall = async <T>(prompt: Prompt, protocol: ChatProtocol): Promise<ModelResult<T>> => {
  const said = prompt.messages.filter((m) => m.role === 'user' && m.content !== '(the participant is ready)').map((m) => m.content);
  let output: unknown;
  if (prompt.key === 'pt.interviewer') {
    const n = said.length;
    const questions = protocol.interview.questions;
    // Asking to stop ends the interview where it is, as the protocol tells the real model to.
    if (n && /\bstop here\b/i.test(said[n - 1]!)) output = { reply: '', interviewDone: true, questionsCovered: questions.slice(0, n - 1).map((_, i) => i + 1) };
    else output = n >= questions.length ? { reply: '', interviewDone: true, questionsCovered: questions.map((_, i) => i + 1) } : { reply: `${n ? 'Thanks for telling me that. ' : ''}${questions[n]}`, interviewDone: false, questionsCovered: questions.slice(0, n).map((_, i) => i + 1) };
  } else if (prompt.key === 'pt.extraction') {
    const humans = (prompt.messages[0]?.content ?? '').split('\n').filter((l) => l.startsWith('Human: ')).map((l) => l.slice(7));
    output = Object.fromEntries(protocol.extractionKeys.map((k, i) => [k.key, humans[i] ?? null]));
  } else if (prompt.key.startsWith('pt.scenario.')) {
    const persona = prompt.key.slice('pt.scenario.'.length);
    const answers = (prompt.messages[0]?.content ?? '').split('\n').filter((l) => l.startsWith('Answer: ') && !l.includes('(they did not say)')).map((l) => l.slice(8));
    output = { scenario: `(${persona}) ${answers.join(' ')}`.trim(), confidence: 'clear' };
  } else if (prompt.key === 'pt.adaptation') {
    const [, account = '', request = ''] = /The account:\n([\s\S]*)\n\nWhat they want changed:\n([\s\S]*)/.exec(prompt.messages[0]?.content ?? '') ?? [];
    output = { newScenario: `${account} ${request}`.trim(), changed: true };
  } else output = {};
  return { output: output as T, raw: JSON.stringify(output), model: 'mock', usage: { input: 0, output: 0 } };
};
