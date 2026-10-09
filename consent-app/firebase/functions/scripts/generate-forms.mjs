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
  labConsentForm: {
    id: lab.labConsentForm.id,
    version: lab.labConsentForm.version,
    title: lab.labConsentForm.title,
    statements: lab.labConsentForm.statements.map((s) => ({ id: s.id, version: s.version, kind: s.kind, label: s.label, text: s.text })),
  },
  labInformationVersion: lab.labInformationVersion.version,
  // The mid-break check-in's questions.
  labCheckInForm: {
    id: lab.labCheckInForm.id,
    version: lab.labCheckInForm.version,
    questions: lab.labCheckInForm.questions.map((q) =>
      q.type === 'choice'
        ? { id: q.id, version: q.version, type: 'choice', required: q.required, label: q.label, text: q.text, options: q.options.map((o) => ({ value: o.value, label: o.label })) }
        : { id: q.id, version: q.version, type: 'text', required: q.required, label: q.label, text: q.text, maxLength: q.maxLength },
    ),
  },
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
  labJourneyMessages: booking.labJourneyMessages,
  labJourneyHour: booking.labJourneyHour,
  // MyStory: each phase's structure, the limits, and how each phase is collected (src/lab/mystory.ts).
  storyStructures: mystory.storyStructures,
  storyLimits: mystory.storyLimits,
  storyModes: mystory.labMyStory.phases,
  schools: schools.map((x) => ({ slug: x.slug, id: x.id, name: x.name, area: x.area })),
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `// Generated by scripts/generate-forms.mjs from consent-app/src. Do not edit; edit the app's config and rebuild.\nexport const generated = ${JSON.stringify(generated, null, 2)} as const;\n`);
console.log(
  `generated ${path.relative(process.cwd(), outFile)}: ${generated.parentConsentForm.id} ${generated.parentConsentForm.version}, ${generated.childAssentForm.id} ${generated.childAssentForm.version}, information ${generated.informationVersion}, ${generated.parentQuestionsForm.id} ${generated.parentQuestionsForm.version}, ${generated.parentMoreForm.id} ${generated.parentMoreForm.version}, ${generated.labConsentForm.id} ${generated.labConsentForm.version}, lab information ${generated.labInformationVersion}, ${generated.labCheckInForm.id} ${generated.labCheckInForm.version}, cleaner ${generated.cleaner.version}, ${Object.values(generated.storyStructures).map((x) => `${x.id} ${x.version}`).join(', ')}, ${generated.schools.length} schools`,
);
