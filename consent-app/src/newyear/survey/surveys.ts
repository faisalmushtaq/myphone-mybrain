import type { VisitKind } from '../config';
import items from './breakStudyItems.json';
import type { SurveySection } from './engine';
import { MOTIVATION_VERSION, motivationEnd, motivationFollowUp, motivationStart } from './motivation';

/**
 * Which questionnaires each visit asks: the motivation questions first, then the
 * social media break lab study's published MySelf survey (the start visit takes
 * the pre-break survey, the end and follow-ups the post-break survey).
 */
const start = items.start.sections as unknown as SurveySection[];
const end = items.end.sections as unknown as SurveySection[];

export type SurveySet = 'start' | 'end' | 'followup';

export function surveyFor(kind: VisitKind): { set: SurveySet; sections: SurveySection[]; version: string } | null {
  if (kind === 'start') return { set: 'start', sections: [motivationStart, ...start], version: `motivation ${MOTIVATION_VERSION}; ${items.start.survey} ${items.start.version}` };
  if (kind === 'end') return { set: 'end', sections: [motivationEnd, ...end], version: `motivation ${MOTIVATION_VERSION}; ${items.end.survey} ${items.end.version}` };
  if (kind === 'followup1' || kind === 'followup3') return { set: 'followup', sections: [motivationFollowUp, ...end], version: `motivation ${MOTIVATION_VERSION}; ${items.end.survey} ${items.end.version}` };
  return null;
}

/** SWEMWBS raw total (7 to 35) from a visit's answers, or null if not all seven were answered. */
export function swemwbsTotal(answers: Record<string, { kind: string; code?: number }>): number | null {
  let total = 0;
  for (let i = 1; i <= 7; i += 1) {
    const a = answers[`swemwbs_q${i}`];
    if (!a || a.kind !== 'code' || typeof a.code !== 'number') return null;
    total += a.code;
  }
  return total;
}
