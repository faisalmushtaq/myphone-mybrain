/**
 * The results page in plain words: the scores of one brain check, and how
 * they compare with an earlier one ("You tapped for 9 of the 25 threes, 3
 * fewer than then").
 */
export interface ComparableScores {
  /** Digit span: the longest run of digits remembered (0 if fewer than 3). */
  span: number | null;
  /** SART: taps for a 3 (commission errors), out of noGo. */
  commissions: number | null;
  noGo: number | null;
  /** SART: no tap for another digit (omission errors), out of go. */
  omissions: number | null;
  go: number | null;
  /** SART: median reaction time on correct taps, in ms. */
  medianRtMs: number | null;
  /** SART: how steady the reaction times were (coefficient of variation; lower is steadier). */
  cvRt: number | null;
}

/** Reaction times closer than this are "about the same": browser timing is only good to a frame or so. */
export const SAME_RT_MS = 10;
/** Changes in steadiness smaller than this are "about the same". */
export const SAME_CV = 0.02;

const ms = (value: number) => `${Math.round(value)} ms`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const digits = (span: number) => (span > 0 ? `up to ${plural(span, 'digit')}` : 'fewer than 3 digits');

/** The scores on their own, one sentence each. */
export function describeScores(s: ComparableScores): string[] {
  const lines: string[] = [];
  if (s.span !== null) lines.push(`You remembered ${digits(s.span)} in the right order.`);
  if (s.commissions !== null && s.noGo !== null) lines.push(`You tapped for ${s.commissions} of the ${s.noGo} threes (most people tap for quite a few).`);
  if (s.omissions !== null && s.go !== null) lines.push(`You missed ${s.omissions} of the ${s.go} other digits.`);
  if (s.medianRtMs !== null) lines.push(`Your typical reaction time was ${ms(s.medianRtMs)}.`);
  return lines;
}

/** One sentence per score that both checks have, comparing now with `then`. `when` reads like "then" or "at the start". */
export function compareScores(now: ComparableScores, then: ComparableScores, when: string): string[] {
  const lines: string[] = [];
  if (now.span !== null && then.span !== null) {
    const diff = now.span - then.span;
    lines.push(`You remembered ${digits(now.span)}, ${diff === 0 ? `the same as ${when}` : `${plural(Math.abs(diff), 'digit')} ${diff > 0 ? 'more' : 'fewer'} than ${when}`}.`);
  }
  if (now.commissions !== null && now.noGo !== null && then.commissions !== null) {
    const diff = now.commissions - then.commissions;
    lines.push(`You tapped for ${now.commissions} of the ${now.noGo} threes, ${diff === 0 ? `the same as ${when}` : `${Math.abs(diff)} ${diff < 0 ? 'fewer' : 'more'} than ${when}`}.`);
  }
  if (now.omissions !== null && now.go !== null && then.omissions !== null) {
    const diff = now.omissions - then.omissions;
    lines.push(`You missed ${now.omissions} of the other digits, ${diff === 0 ? `the same as ${when}` : `${Math.abs(diff)} ${diff < 0 ? 'fewer' : 'more'} than ${when}`}.`);
  }
  if (now.medianRtMs !== null && then.medianRtMs !== null) {
    const diff = Math.round(now.medianRtMs - then.medianRtMs);
    if (Math.abs(diff) < SAME_RT_MS) lines.push(`Your typical reaction time was ${ms(now.medianRtMs)}, about the same as ${when}.`);
    else lines.push(`Your typical reaction time was ${ms(now.medianRtMs)}, ${Math.abs(diff)} ms ${diff < 0 ? 'faster' : 'slower'} than ${when}.`);
  }
  if (now.cvRt !== null && then.cvRt !== null) {
    const diff = now.cvRt - then.cvRt;
    lines.push(Math.abs(diff) < SAME_CV ? `Your reaction times were about as steady as ${when}.` : `Your reaction times were ${diff < 0 ? 'steadier' : 'less steady'} than ${when}.`);
  }
  return lines;
}
