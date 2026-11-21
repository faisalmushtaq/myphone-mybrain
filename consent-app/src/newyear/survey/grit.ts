import type { Answers, SurveySection } from './engine';

/**
 * The Short Grit Scale (Grit-S): Duckworth, A. L. and Quinn, P. D. (2009).
 * Development and validation of the Short Grit Scale (Grit-S). Journal of
 * Personality Assessment, 91(2), 166–174. Free for non-commercial research
 * and educational use. Added at the PI's request, 21 November 2026.
 *
 * Eight statements, each answered on five points from "Very much like me" to
 * "Not like me at all", as published. Codes follow the published scoring
 * for the items that are not reversed (Very much like me = 5 ... Not like me
 * at all = 1); items 1, 3, 5 and 6 (consistency of interest) are reversed when
 * scoring. The score is the mean of the eight, 1 (not at all gritty) to 5
 * (extremely gritty), with two subscales: consistency of interest (1, 3, 5,
 * 6) and perseverance of effort (2, 4, 7, 8).
 */
export const GRIT_VERSION = '1.0';

const OPTIONS = [
  { code: 5, label: 'Very much like me' },
  { code: 4, label: 'Mostly like me' },
  { code: 3, label: 'Somewhat like me' },
  { code: 2, label: 'Not much like me' },
  { code: 1, label: 'Not like me at all' },
];

const ITEMS: { n: number; text: string; reversed: boolean }[] = [
  { n: 1, text: 'New ideas and projects sometimes distract me from previous ones.', reversed: true },
  { n: 2, text: 'Setbacks don’t discourage me.', reversed: false },
  { n: 3, text: 'I have been obsessed with a certain idea or project for a short time but later lost interest.', reversed: true },
  { n: 4, text: 'I am a hard worker.', reversed: false },
  { n: 5, text: 'I often set a goal but later choose to pursue a different one.', reversed: true },
  { n: 6, text: 'I have difficulty maintaining my focus on projects that take more than a few months to complete.', reversed: true },
  { n: 7, text: 'I finish whatever I begin.', reversed: false },
  { n: 8, text: 'I am diligent.', reversed: false },
];

export const gritSection: SurveySection = {
  key: 'grit',
  title: 'How you go about things',
  transition: null,
  blocks: [
    {
      instrument: 'grit_s',
      name: 'Short Grit Scale (Grit-S)',
      citation: 'Duckworth, A. L., and Quinn, P. D. (2009). Development and validation of the Short Grit Scale (Grit-S). Journal of Personality Assessment, 91(2), 166–174.',
      licence: { status: 'open (non-commercial research)' },
      instructions: 'Here are a number of statements that may or may not apply to you. For the most accurate score, when responding, think of how you compare to most people: not just the people you know well, but most people in the world. There are no right or wrong answers, so just answer honestly.',
      items: ITEMS.map((i) => ({ key: `q${i.n}`, variable: `grit_q${i.n}`, responseType: 'single_choice' as const, stem: { text: i.text }, required: 'hard' as const, options: OPTIONS })),
    },
  ],
};

/** The Grit-S score (mean of the eight, 1–5) and its two subscales, or null unless all eight were answered. */
export function gritScores(answers: Answers): { grit: number; consistency: number; perseverance: number } | null {
  const scored: number[] = [];
  for (const i of ITEMS) {
    const a = answers[`grit_q${i.n}`];
    if (!a || a.kind !== 'code') return null;
    scored.push(i.reversed ? 6 - a.code : a.code);
  }
  const mean = (ns: number[]) => Math.round((ns.reduce((x, y) => x + y, 0) / ns.length) * 100) / 100;
  return { grit: mean(scored), consistency: mean([0, 2, 4, 5].map((k) => scored[k])), perseverance: mean([1, 3, 6, 7].map((k) => scored[k])) };
}
