// Writes src/generated/forms.ts from the app's own configuration
// (consent-app/src/config/statements.ts, questions.ts, copy.ts and study.ts, the
// social media break study's src/lab/config.ts, cleaner.ts, booking.ts and
// mystory.ts, and the website's _data/schools.json), so the
// statement ids, versions, wording, answer options and file allow-lists live
// in one place and the server, the validation and the export's data
// dictionaries follow. Runs as part of `npm run build`. Do not edit the
// generated file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { parse as parseToml } from 'smol-toml';

const here = path.dirname(new URL(import.meta.url).pathname);
const appSrc = path.resolve(here, '../../../src');
const outFile = path.resolve(here, '../src/generated/forms.ts');

/** Loads one of the app's modules (plain TypeScript with no runtime imports) by transpiling it on the fly. */
async function load(name) {
  const source = fs.readFileSync(path.join(appSrc, `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const tmp = path.join(os.tmpdir(), `mpmb-config-${name.replace(/[\\/]/g, '-')}-${process.pid}.mjs`);
  fs.writeFileSync(tmp, outputText);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.unlinkSync(tmp);
  }
}

const [statements, questions, copy, studyConfig, lab, cleaner, booking, mystory] = await Promise.all([load('config/statements'), load('config/questions'), load('config/copy'), load('config/study'), load('lab/config'), load('lab/cleaner'), load('lab/booking'), load('lab/mystory')]);
// The participating schools: the website's own list (the app imports it as JSON, so it is read here directly).
const schools = JSON.parse(fs.readFileSync(path.resolve(here, '../../../../_data/schools.json'), 'utf8'));

const form = (f) => ({
  id: f.id,
  version: f.version,
  statements: f.statements.map((s) => ({ id: s.id, version: s.version, kind: s.kind, label: s.label, text: s.text, coveredBySignature: Boolean(s.coveredBySignature), underSelfConsentAge: Boolean(s.underSelfConsentAge) })),
});
const questionForm = (f) => ({
  id: f.id,
  version: f.version,
  questions: f.questions.map((q) =>
    q.type === 'choice' || q.type === 'multi'
      ? { id: q.id, version: q.version, type: q.type, label: q.label, topic: q.topic ?? null, text: q.text, options: q.options.map((o) => ({ value: o.value, label: o.label })) }
      : { id: q.id, version: q.version, type: 'text', label: q.label, topic: q.topic ?? null, text: q.text, maxLength: q.maxLength },
  ),
});

/** A lab consent form as the server checks it. */
const consentFormOf = (f) => ({ id: f.id, version: f.version, title: f.title, statements: f.statements.map((s) => ({ id: s.id, version: s.version, kind: s.kind, label: s.label, text: s.text })) });

/** A check-in form as the server checks it and the export describes it. */
const checkInFormOf = (f) => ({
  id: f.id,
  version: f.version,
  questions: f.questions.map((q) =>
    q.type === 'choice'
      ? { id: q.id, version: q.version, type: 'choice', required: q.required, label: q.label, text: q.text, options: q.options.map((o) => ({ value: o.value, label: o.label })) }
      : { id: q.id, version: q.version, type: 'text', required: q.required, label: q.label, text: q.text, maxLength: q.maxLength },
  ),
});

/**
 * One phase's MyStory chat protocol, read from its TOML file (the MySelf /
 * KCL micro-narratives format) into what the server needs. Anything the chat
 * cannot run without is checked here, so a broken file stops the build rather
 * than a participant's conversation.
 */
function chatProtocol(phase, name = phase) {
  const file = path.resolve(here, `../../../src/lab/mystory/${name}.toml`);
  const t = parseToml(fs.readFileSync(file, 'utf8'));
  const m = t.myself ?? {};
  const fail = (what) => {
    throw new Error(`${path.relative(process.cwd(), file)}: ${what}`);
  };
  const text = (v, what, required = true) => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (required) fail(`${what} is missing`);
    return '';
  };
  const questions = t.collection?.questions;
  if (!Array.isArray(questions) || !questions.length || !questions.every((q) => typeof q === 'string' && q.trim())) fail('[collection] questions must be a list of questions');
  const keys = Object.entries(t.summaries?.questions ?? {});
  if (!keys.length || !keys.every(([k, q]) => /^[a-z][a-z0-9_]*$/.test(k) && typeof q === 'string')) fail('[summaries.questions] must map snake_case keys to questions');
  const personas = Object.entries(t.summaries?.personas ?? {});
  if (!personas.length || !personas.every(([k, v]) => /^[a-z][a-z0-9_]*$/.test(k) && typeof v === 'string' && v.trim())) fail('[summaries.personas] must map names to persona text');
  // Nothing sent to the model may carry a placeholder: as in MySelf, a name is resolved on the participant's device, for the screen only.
  const promptText = [['persona', t.collection?.persona], ['language_type', t.collection?.language_type], ['topic_restriction', t.collection?.topic_restriction], ...questions.map((q, i) => [`question ${i + 1}`, q]), ...keys.map(([k, q]) => [`[summaries.questions] ${k}`, q]), ...personas.map(([k, v]) => [`[summaries.personas] ${k}`, v]), ['[example]', `${t.example?.conversation ?? ''} ${t.example?.scenario ?? ''}`]];
  for (const [where, v] of promptText) {
    if (/\{[a-z_]+\}/.test(String(v ?? ''))) fail(`${where} uses a {placeholder}; nothing sent to the model may`);
  }
  // On screen, {first_name} only, filled in on the participant's device (or left out when it is not known).
  const screenText = [t.consent?.intro_and_consent, t.collection?.intro, m.outro, m.select_text, m.select_lede, m.rate_text, m.rate_lede, m.adapt_text, m.adapt_lede, m.debrief_text, m.debrief_lede, m.fallback_text];
  for (const v of screenText) {
    const other = String(v ?? '').match(/\{(?!first_name\})[a-z_]+\}/);
    if (other) fail(`${other[0]} on screen: the website fills in {first_name} only`);
  }
  const num = (v, fallback, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  return {
    phase,
    key: text(m.key, '[myself] key'),
    version: text(m.version, '[myself] version'),
    name: text(m.name, '[myself] name', false),
    approvalStatus: text(m.approval_status, '[myself] approval_status', false) || 'draft',
    model: text(t.model, 'model'),
    temperature: num(m.temperature, 0.7, 0, 1.5),
    maxOutputTokens: num(m.max_output_tokens, 400, 50, 2000),
    timeoutSeconds: num(m.timeout_seconds, 30, 5, 60),
    maxAttempts: num(m.max_attempts, 3, 1, 5),
    maxTurns: num(m.max_turns, 14, 2, 30),
    minChars: num(m.min_chars, 2, 1, 50),
    maxChars: num(m.max_chars, 2000, 100, 5000),
    adaptBelowRating: num(m.adapt_below_rating, 10, 0, 10),
    interview: {
      persona: text(t.collection?.persona, '[collection] persona'),
      languageStyle: text(t.collection?.language_type, '[collection] language_type', false),
      topicRestriction: text(t.collection?.topic_restriction, '[collection] topic_restriction', false),
      questions: questions.map((q) => q.trim()),
    },
    extractionKeys: keys.map(([key, question]) => ({ key, question: question.trim() })),
    personas: personas.map(([key, value]) => ({ key, text: value.trim() })),
    example: t.example?.conversation && t.example?.scenario ? { conversation: String(t.example.conversation).trim(), scenario: String(t.example.scenario).trim() } : null,
    screens: {
      introAndConsent: text(t.consent?.intro_and_consent, '[consent] intro_and_consent'),
      intro: text(t.collection?.intro, '[collection] intro'),
      outro: text(m.outro, '[myself] outro', false) || 'Great, I think I have what I need. Let me check I understood you.',
      selectText: text(m.select_text, '[myself] select_text', false) || 'Pick the one that fits you best.',
      selectLede: text(m.select_lede, '[myself] select_lede', false),
      rateText: text(m.rate_text, '[myself] rate_text', false) || 'How close is this to what you want to say?',
      rateLede: text(m.rate_lede, '[myself] rate_lede', false),
      adaptText: text(m.adapt_text, '[myself] adapt_text', false) || 'What would you change about it?',
      adaptLede: text(m.adapt_lede, '[myself] adapt_lede', false),
      debriefText: text(m.debrief_text, '[myself] debrief_text', false) || 'Here is your story.',
      debriefLede: text(m.debrief_lede, '[myself] debrief_lede', false),
      fallbackText: text(m.fallback_text, '[myself] fallback_text', false) || 'Thank you, that is really helpful.',
      characterName: text(m.character?.name, '[myself.character] name', false) || 'Sam',
      characterAbout: Array.isArray(m.character?.about) ? m.character.about.filter((x) => typeof x === 'string') : [],
      disclosure: (m.safeguarding ?? []).map((r) => r?.disclosure).find((d) => typeof d === 'string' && d.trim()) ?? '',
    },
    safeguarding: (m.safeguarding ?? []).filter((r) => r?.kind === 'lexicon' && Array.isArray(r.terms)).map((r) => ({ key: String(r.key), tier: String(r.tier ?? 'safeguarding_review'), terms: r.terms.map((x) => String(x).toLowerCase()) })),
  };
}

const generated = {
  parentConsentForm: form(statements.parentConsentForm),
  childAssentForm: form(statements.childAssentForm),
  informationVersion: copy.parentInformationVersion.version,
  // Earlier versions still accepted, for families who signed before an update.
  earlierInformationVersions: copy.earlierInformationVersions ?? [],
  parentQuestionsForm: questionForm(questions.parentQuestionsForm),
  // The longer questions, when the young person's screen time is not coming through the form.
  parentMoreForm: questionForm(questions.parentMoreForm),
  // Instead of the quick and the longer questions, when the young person has no phone of their own (from 9 October 2026).
  parentNoPhoneForm: questionForm(questions.parentNoPhoneForm),
  // From this age a young person decides alone about sharing their screen time (null: never alone).
  selfConsentAge: studyConfig.study.selfConsentAge,
  // The social media break study (adults): required statements plus an optional record-linkage choice.
  labConsentForm: consentFormOf(lab.labConsentForm),
  labInformationVersion: lab.labInformationVersion.version,
  // The mid-break check-in's questions.
  labCheckInForm: checkInFormOf(lab.labCheckInForm),
  // The control group (21 October 2026): its own consent, information and check-in; no break.
  labConsentFormControl: consentFormOf(lab.labConsentFormControl),
  labInformationVersionControl: lab.labInformationVersionControl.version,
  labCheckInFormControl: checkInFormOf(lab.labCheckInFormControl),
  labStudy: {
    studyId: lab.labStudy.studyId,
    minAge: lab.labStudy.minAge,
    maxAge: lab.labStudy.maxAge,
    maxArchiveBytes: lab.labStudy.maxArchiveBytes,
    maxScreenshots: lab.labStudy.maxScreenshots,
    maxCheckInScreenshots: lab.labStudy.maxCheckInScreenshots,
    participantCodePattern: lab.PARTICIPANT_CODE.source,
    ukPostcodePattern: lab.UK_POSTCODE.source,
    name: lab.labStudy.name,
    contactName: lab.labStudy.contact.name,
    contactEmail: lab.labStudy.contact.email,
  },
  cleaner: {
    version: cleaner.CLEANER_VERSION,
    allowedFiles: cleaner.ALLOWED_CLEANED_FILES,
    categories: cleaner.categories.map((c) => ({ id: c.id, platform: c.platform, title: c.title })),
  },
  // The study's pages, for the personal links in emails, texts and the staff page.
  labPages: Object.fromEntries(Object.entries(lab.labPages).map(([k, v]) => [k, v.path])),
  // Booking the lab visits, and the messages during the break (src/lab/booking.ts).
  labBooking: { ...booking.labBooking, location: { name: booking.labBooking.location.name, address: booking.labBooking.location.address, directions: booking.labBooking.location.directions } },
  labCheckInDay: booking.labCheckInDay,
  labCheckInDays: [...booking.labCheckInDays],
  labStoryCheckIn: booking.labStoryCheckIn,
  labCheckInReminderDays: booking.labCheckInReminderDays,
  labJourneyHour: booking.labJourneyHour,
  // MyStory: each phase's structure, the limits, and how each phase is collected (src/lab/mystory.ts).
  storyStructures: mystory.storyStructures,
  storyLimits: mystory.storyLimits,
  storyModes: mystory.labMyStory.phases,
  // MyStory's AI chat, one MySelf protocol per phase (src/lab/mystory/<phase>.toml), checked here so a file that cannot run stops the build.
  storyChats: Object.fromEntries(['pre', 'mid', 'post'].map((phase) => [phase, chatProtocol(phase)])),
  // The control group's versions (src/lab/mystory/control-<phase>.toml): no break.
  storyChatsControl: Object.fromEntries(['pre', 'mid', 'post'].map((phase) => [phase, chatProtocol(phase, `control-${phase}`)])),
  schools: schools.map((x) => ({ slug: x.slug, id: x.id, name: x.name, area: x.area })),
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `// Generated by scripts/generate-forms.mjs from consent-app/src. Do not edit; edit the app's config and rebuild.\nexport const generated = ${JSON.stringify(generated, null, 2)} as const;\n`);
console.log(
  `generated ${path.relative(process.cwd(), outFile)}: ${generated.parentConsentForm.id} ${generated.parentConsentForm.version}, ${generated.childAssentForm.id} ${generated.childAssentForm.version}, information ${generated.informationVersion}, ${generated.parentQuestionsForm.id} ${generated.parentQuestionsForm.version}, ${generated.parentMoreForm.id} ${generated.parentMoreForm.version}, ${generated.labConsentForm.id} ${generated.labConsentForm.version}, lab information ${generated.labInformationVersion}, ${generated.labCheckInForm.id} ${generated.labCheckInForm.version}, cleaner ${generated.cleaner.version}, ${Object.values(generated.storyStructures).map((x) => `${x.id} ${x.version}`).join(', ')}, ${Object.values(generated.storyChats).map((x) => `${x.key} ${x.version}`).join(', ')}, ${generated.schools.length} schools`,
);
