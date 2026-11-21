import type { SurveySection } from './engine';

/**
 * Why people take a break, and how it went: study-written questions for the
 * online study (the PI, 21 November 2026: "the survey needs to be more
 * comprehensive asking about their motivations"). Neither break study survey
 * asks this, so these are new and DRAFT, for the team to agree:
 *  - reasons (choose all) and the main one;
 *  - importance and confidence, each 0 to 10: the "readiness rulers" of
 *    motivational interviewing (Rollnick, Miller and Butler, 2008);
 *  - readiness, in plain words;
 *  - what might make it hard, and what they hope will change;
 *  - at the end and the follow-ups: how it went, what was hard, what helped,
 *    and what next.
 * Variables start mot_ so they can't clash with the break study's.
 */
const REASONS = [
  { code: 1, label: 'To spend less time on my phone' },
  { code: 2, label: 'To sleep better' },
  { code: 3, label: 'To feel less anxious, stressed or low' },
  { code: 4, label: 'To concentrate better on work or study' },
  { code: 5, label: 'To be more present with family and friends' },
  { code: 6, label: 'To stop comparing myself with other people' },
  { code: 7, label: 'To have more time for other things, like hobbies, exercise or reading' },
  { code: 8, label: 'To break a habit I don’t like' },
  { code: 9, label: 'To rely less on AI tools for thinking or writing' },
  { code: 10, label: 'Curiosity: to see what changes' },
  { code: 11, label: 'To help the research' },
  { code: 12, label: 'Someone suggested it' },
  { code: 13, label: 'Something else', textEntry: true },
];

const HARD = [
  { code: 1, label: 'Boredom' },
  { code: 2, label: 'Missing out on news, plans or friends' },
  { code: 3, label: 'Needing these apps or tools for work or study' },
  { code: 4, label: 'Habit: picking up my phone without thinking' },
  { code: 5, label: 'Notifications' },
  { code: 6, label: 'Stress or low mood' },
  { code: 7, label: 'Other people around me using their phones' },
  { code: 8, label: 'Something else', textEntry: true },
];

const block = (instrument: string, name: string, items: SurveySection['blocks'][number]['items']) => ({ instrument, name, citation: null, licence: { status: 'study-written (draft)' }, instructions: null, items });

export const motivationStart: SurveySection = {
  key: 'motivation',
  title: 'Your break',
  transition: 'First, some questions about why you are taking a break.',
  blocks: [
    block('mot_start', 'Motivation for the break (study-written, draft)', [
      { key: 'reasons', variable: 'mot_reasons', responseType: 'multi_choice', stem: { text: 'Why do you want to take this break?' }, lede: { text: 'Choose all that apply.' }, required: 'hard', options: REASONS },
      { key: 'main_reason', variable: 'mot_main_reason', responseType: 'single_choice', stem: { text: 'Which of these is the most important reason for you?' }, required: 'hard', options: REASONS },
      { key: 'importance', variable: 'mot_importance', responseType: 'scale_0_10', stem: { text: 'How important is it to you to make this change right now?' }, required: 'hard', ends: ['Not at all important', 'Extremely important'] },
      { key: 'confidence', variable: 'mot_confidence', responseType: 'scale_0_10', stem: { text: 'How confident are you that you can keep it up?' }, required: 'hard', ends: ['Not at all confident', 'Extremely confident'] },
      {
        key: 'readiness',
        variable: 'mot_readiness',
        responseType: 'single_choice',
        stem: { text: 'Which of these describes you best?' },
        required: 'hard',
        options: [
          { code: 1, label: 'I’ve already started cutting down' },
          { code: 2, label: 'I’m ready to start now' },
          { code: 3, label: 'I’m thinking about it, but not sure I’m ready' },
          { code: 4, label: 'I’m mainly doing this for the study' },
        ],
      },
      { key: 'barriers', variable: 'mot_barriers', responseType: 'multi_choice', stem: { text: 'What do you think might make it hard?' }, lede: { text: 'Choose all that apply.' }, required: 'soft', allowDecline: true, options: HARD },
      { key: 'hope', variable: 'mot_hope', responseType: 'text_long', stem: { text: 'What would you most like to be different by the end of your break?' }, required: 'soft', maxChars: 500 },
    ]),
  ],
};

const howItWent = (instrument: string, when: 'end' | 'followup'): SurveySection => ({
  key: `motivation_${when}`,
  title: when === 'end' ? 'How your break went' : 'Since your break',
  transition: when === 'end' ? 'First, some questions about how your break went.' : 'First, some questions about how things have been since your break.',
  blocks: [
    block(instrument, `How it went (study-written, draft)`, [
      { key: 'went', variable: `mot_${when}_went`, responseType: 'scale_0_10', stem: { text: when === 'end' ? 'Overall, how well did your break go?' : 'Overall, how well have you kept to what you wanted since your break?' }, required: 'hard', ends: ['Not at all well', 'Extremely well'] },
      {
        key: 'got',
        variable: `mot_${when}_got`,
        responseType: 'single_choice',
        stem: { text: 'Did you get what you hoped for from your break?' },
        required: 'hard',
        options: [
          { code: 1, label: 'Yes, mostly' },
          { code: 2, label: 'Partly' },
          { code: 3, label: 'Not really' },
          { code: 4, label: 'It’s too early to say' },
        ],
      },
      { key: 'hard', variable: `mot_${when}_hard`, responseType: 'multi_choice', stem: { text: when === 'end' ? 'What made it hard?' : 'What has made it hard?' }, lede: { text: 'Choose all that apply.' }, required: 'soft', allowDecline: true, options: [...HARD.slice(0, -1), { code: 9, label: 'Nothing: it wasn’t hard' }, HARD[HARD.length - 1]] },
      { key: 'helped', variable: `mot_${when}_helped`, responseType: 'text_long', stem: { text: 'What helped you most?' }, required: 'soft', maxChars: 500 },
      {
        key: 'next',
        variable: `mot_${when}_next`,
        responseType: 'single_choice',
        stem: { text: when === 'end' ? 'What do you plan to do now?' : 'Which of these describes you now?' },
        required: 'hard',
        options: [
          { code: 1, label: when === 'end' ? 'Keep the break going' : 'I’ve kept the break going' },
          { code: 2, label: when === 'end' ? 'Use these apps or tools less than before' : 'I use these apps or tools less than before' },
          { code: 3, label: when === 'end' ? 'Go back to how I used them before' : 'I’m back to how I used them before' },
          { code: 4, label: 'Not sure' },
        ],
      },
      { key: 'importance', variable: `mot_${when}_importance`, responseType: 'scale_0_10', stem: { text: 'How important is it to you now to keep using your phone less?' }, required: 'hard', ends: ['Not at all important', 'Extremely important'] },
    ]),
  ],
});

export const motivationEnd = howItWent('mot_end', 'end');
export const motivationFollowUp = howItWent('mot_followup', 'followup');
export const MOTIVATION_VERSION = '0.1-draft';
