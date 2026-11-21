// Exports the questions of the social media break lab study's published MySelf surveys for the
// online study, from their release files in MySelf's survey archive (the `survey-archive`
// branch of faisalmushtaq/MySelf): exactly the questions, wording, answer options, order and
// display conditions participants were shown.
//
//   git -C <MySelf> show origin/survey-archive:social_media_break_lab/social_media_break_lab_study/8.0.0/manifest.json > pre.json
//   git -C <MySelf> show origin/survey-archive:social_media_break_lab/post_break_lab_study/3.0.0/manifest.json > post.json
//   node scripts/export-myself-items.mjs pre.json post.json > src/newyear/survey/breakStudyItems.json
//
// Left out, because the online study asks its own or they belong to the lab: the consent
// screen, names, address and UK demographics, the EEG practicality, and the post-break
// survey's own questions about the lab's 30-day break.
import fs from 'node:fs';

const LEAVE_OUT = new Set(['ybm_intro_consent', 'ybm_identity', 'ybm_demographics', 'ybm_eeg_practical', 'social_media_break_lab_studio']);

function exportSurvey(file) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const refKey = (r) => `${r.instrument}@${r.version}/${r.language}/${r.informant}/${r.readingLevel}`;
  const sections = [];
  for (const sec of m.composition.sections) {
    const blocks = [];
    for (const c of sec.components) {
      if (!c.ref || LEAVE_OUT.has(c.ref.instrument)) continue;
      const inst = m.instruments[refKey(c.ref)];
      if (!inst) throw new Error(`Missing ${refKey(c.ref)}`);
      const form = inst.forms[0];
      const items = (c.items ? c.items.map((k) => form.items.find((i) => i.key === k)) : form.items).filter(Boolean);
      blocks.push({
        instrument: inst.instrument,
        name: inst.name,
        kind: inst.kind ?? c.kind,
        citation: inst.citation ?? null,
        licence: inst.licence ?? null,
        instructions: form.instructions ?? null,
        items: items.map((i) => ({ ...i, scale: undefined, scaleVersion: undefined, legacyVariable: undefined, options: i.scale ? m.scales[`${i.scale}@${i.scaleVersion}`]?.options ?? m.scales[i.scale]?.options ?? null : null })),
      });
    }
    if (blocks.length) sections.push({ key: sec.key, title: sec.title, transition: sec.transition ?? null, blocks });
  }
  return { survey: m.release.assessment, version: m.release.version, publishedAt: m.release.publishedAt, sections };
}

const [pre, post] = process.argv.slice(2).map(exportSurvey);
process.stdout.write(JSON.stringify({ source: 'MySelf survey archive (faisalmushtaq/MySelf, branch survey-archive), study space social_media_break_lab', start: pre, end: post }, null, 1));
