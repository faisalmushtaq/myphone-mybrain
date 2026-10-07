/**
 * MyStory: short micro-narratives from participants in the social media
 * break study, a different structure for each phase so the stories answer
 * what each phase is about. A participant picks one prompt, tells the story
 * in their own words and gives it a title, then places it on a few
 * "signifiers": a triangle (three things it was about, in any mix), sliders
 * between two ends, and quick choices. This is the shape SenseMaker-style
 * micro-narratives take, so the stories can be read alongside MySelf's.
 *
 * DRAFT prompts and signifiers, written for this site until the team's own
 * (for example MySelf's) are settled; ids and versions are what the server
 * accepts and the export's data dictionary describes. Plain data with no
 * imports: the server's build reads this file too.
 *
 * Any phase can instead use another survey (MySelf, for example), either
 * linked to or shown inside the page, with the participant ID and the phase
 * passed along: see labMyStory below and docs/mystory.md.
 */

export type StoryPhase = 'pre' | 'mid' | 'post';

export type StorySignifier =
  | { id: string; type: 'triad'; question: string; corners: [string, string, string] }
  | { id: string; type: 'dyad'; question: string; left: string; right: string }
  | { id: string; type: 'choice'; question: string; options: { value: string; label: string }[]; multiple?: boolean };

export interface StoryStructure {
  id: string;
  version: string;
  phase: StoryPhase;
  title: string;
  intro: string;
  prompts: { id: string; text: string }[];
  storyHint: string;
  signifiers: StorySignifier[];
}

const apps = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'snapchat', label: 'Snapchat' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'other', label: 'Another app' },
  { value: 'none', label: 'No app' },
];

const feeling = {
  id: 'feeling',
  type: 'choice' as const,
  question: 'How do you feel about this story now?',
  options: [
    { value: 'very-negative', label: 'Very negative' },
    { value: 'negative', label: 'Negative' },
    { value: 'neutral', label: 'Neither' },
    { value: 'positive', label: 'Positive' },
    { value: 'very-positive', label: 'Very positive' },
  ],
};

export const storyStructures: Record<StoryPhase, StoryStructure> = {
  pre: {
    id: 'mystory-pre',
    version: '0.1-draft',
    phase: 'pre',
    title: 'Your phone, before the break',
    intro: 'A few minutes, in your own words: a moment with your phone, then a few quick questions about it.',
    prompts: [
      { id: 'stayed', text: 'Tell us about a recent moment with your phone that stayed with you, good or bad.' },
      { id: 'evening', text: 'Describe a typical evening with your phone. What happens?' },
      { id: 'changed', text: 'Think of a time social media changed how you felt. What happened?' },
    ],
    storyHint: 'A few sentences is plenty. Leave out names and anything that could identify someone.',
    signifiers: [
      { id: 'about', type: 'triad', question: 'In this story, my phone was mostly about…', corners: ['Connecting with people', 'Passing the time', 'Finding things out'] },
      { id: 'afterwards', type: 'dyad', question: 'Afterwards, I felt…', left: 'Worse', right: 'Better' },
      { id: 'choice', type: 'dyad', question: 'How much was it my choice?', left: 'Not my choice at all', right: 'Completely my choice' },
      { id: 'app', type: 'choice', question: 'Which app was it?', options: apps },
      feeling,
    ],
  },
  mid: {
    id: 'mystory-mid',
    version: '0.1-draft',
    phase: 'mid',
    title: 'Your story this week',
    intro: 'A few minutes, in your own words: a moment from your break this week, then a few quick questions about it.',
    prompts: [
      { id: 'pull', text: 'Tell us about a moment this week when you wanted to open one of your apps. What happened?' },
      { id: 'instead', text: 'What did you do instead of scrolling this week? Tell us about one moment.' },
      { id: 'surprised', text: 'Tell us about something that surprised you about being off social media.' },
    ],
    storyHint: 'A few sentences is plenty. Leave out names and anything that could identify someone.',
    signifiers: [
      { id: 'pull', type: 'triad', question: 'The pull of the moment was about…', corners: ['Habit', 'People and connection', 'Boredom or stress'] },
      { id: 'hard', type: 'dyad', question: 'That moment was…', left: 'Easy', right: 'Very hard' },
      { id: 'afterwards', type: 'dyad', question: 'Afterwards, I felt…', left: 'Worse', right: 'Better' },
      {
        id: 'where',
        type: 'choice',
        question: 'Where were you?',
        options: [
          { value: 'home', label: 'At home' },
          { value: 'study-work', label: 'Studying or at work' },
          { value: 'with-others', label: 'Out with others' },
          { value: 'travelling', label: 'Travelling' },
          { value: 'bed', label: 'In bed' },
          { value: 'elsewhere', label: 'Somewhere else' },
        ],
      },
      feeling,
    ],
  },
  post: {
    id: 'mystory-post',
    version: '0.1-draft',
    phase: 'post',
    title: 'Looking back on your break',
    intro: 'A few minutes, in your own words: looking back on your break, then a few quick questions about it.',
    prompts: [
      { id: 'mattered', text: 'Looking back on your break, tell us about the moment that mattered most.' },
      { id: 'first-open', text: 'Tell us about the first time you opened your apps again. What happened?' },
      { id: 'differently', text: 'What, if anything, will you do differently with your phone now?' },
    ],
    storyHint: 'A few sentences is plenty. Leave out names and anything that could identify someone.',
    signifiers: [
      { id: 'changed', type: 'triad', question: 'What the break changed most was…', corners: ['My time', 'My mood', 'My relationships'] },
      { id: 'expected', type: 'dyad', question: 'Overall, the break was…', left: 'Harder than I expected', right: 'Easier than I expected' },
      { id: 'future', type: 'dyad', question: 'From now on, I want to use social media…', left: 'Much less than before', right: 'Much more than before' },
      {
        id: 'again',
        type: 'choice',
        question: 'Would you take a break like this again?',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'maybe', label: 'Maybe' },
          { value: 'no', label: 'No' },
        ],
      },
      feeling,
    ],
  },
};

/** Limits the server applies too. */
export const storyLimits = { titleMax: 120, storyMin: 20, storyMax: 5000 };

/**
 * How each phase's MyStory is collected:
 *   native  this site's own form (the structures above), in the site's look,
 *           stored with the rest of the study's data under the participant ID;
 *   link    another survey (MySelf, for example) opened in a new tab;
 *   embed   another survey shown inside the page.
 * For link and embed, the participant ID goes to the survey as the idParam
 * query parameter and the phase (pre, mid or post) as phaseParam, so the
 * survey files the story under the same ID; in Qualtrics, declare both as
 * embedded data at the top of the survey flow (docs/mystory.md).
 */
export type StoryMode =
  | { mode: 'native' }
  | { mode: 'link' | 'embed'; name: string; url: string; idParam: string; phaseParam: string | null; height?: number };

export const labMyStory: { name: string; phases: Record<StoryPhase, StoryMode> } = {
  name: 'MyStory',
  phases: {
    pre: { mode: 'native' },
    mid: { mode: 'native' },
    post: { mode: 'native' },
  },
};

/** The address of an external MyStory survey for one participant and phase; null for the site's own form. */
export function storySurveyUrl(phase: StoryPhase, code: string, mode: StoryMode = labMyStory.phases[phase]): string | null {
  if (mode.mode === 'native') return null;
  const url = new URL(mode.url);
  url.searchParams.set(mode.idParam, code);
  if (mode.phaseParam) url.searchParams.set(mode.phaseParam, phase);
  return url.toString();
}
