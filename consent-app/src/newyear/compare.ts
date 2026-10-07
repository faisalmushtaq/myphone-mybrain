/**
 * The results page in plain words: the scores of one brain check, and how
 * they compare with an earlier one ("Your reaction time was 412 ms, 43 ms
 * faster than before your break").
 */
export interface ComparableScores {
  /** Digit span: the longest run of digits remembered (0 if fewer than 3). */
  span: number | null;
  /** Median reaction time to targets, in ms. */
  medianRtMs: number | null;
  hits: number | null;
  targets: number | null;
  falseAlarms: number | null;
}

/** Reaction times closer than this are "about the same": browser timing is only good to a frame or so. */
export const SAME_RT_MS = 10;

const ms = (value: number) => `${Math.round(value)} ms`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const digits = (span: number) => (span > 0 ? `up to ${plural(span, 'digit')}` : 'fewer than 3 digits');
const mistakes = (n: number) => (n === 0 ? 'You never tapped by mistake' : `You tapped by mistake ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`}`);

/** The scores on their own, one sentence each. */
export function describeScores(s: ComparableScores): string[] {
  const lines: string[] = [];
  if (s.span !== null) lines.push(`You remembered ${digits(s.span)} in the right order.`);
  if (s.hits !== null && s.targets !== null) lines.push(`You spotted ${s.hits} of ${s.targets} targets.`);
  if (s.falseAlarms !== null) lines.push(`${mistakes(s.falseAlarms)}.`);
  if (s.medianRtMs !== null) lines.push(`Your reaction time was ${ms(s.medianRtMs)}.`);
  return lines;
}

/** One sentence per score that both checks have, comparing now with `then`. `when` reads like "before your break". */
export function compareScores(now: ComparableScores, then: ComparableScores, when: string): string[] {
  const lines: string[] = [];
  if (now.medianRtMs !== null && then.medianRtMs !== null) {
    const diff = Math.round(now.medianRtMs - then.medianRtMs);
    if (Math.abs(diff) < SAME_RT_MS) lines.push(`Your reaction time was ${ms(now.medianRtMs)}, about the same as ${when} (${ms(then.medianRtMs)}).`);
    else lines.push(`Your reaction time was ${ms(now.medianRtMs)}, ${Math.abs(diff)} ms ${diff < 0 ? 'faster' : 'slower'} than ${when}.`);
  }
  if (now.span !== null && then.span !== null) {
    const diff = now.span - then.span;
    lines.push(`You remembered ${digits(now.span)}, ${diff === 0 ? `the same as ${when}` : `${plural(Math.abs(diff), 'digit')} ${diff > 0 ? 'more' : 'fewer'} than ${when}`}.`);
  }
  if (now.hits !== null && now.targets !== null && then.hits !== null) {
    const diff = now.hits - then.hits;
    lines.push(`You spotted ${now.hits} of ${now.targets} targets, ${diff === 0 ? `the same number as ${when}` : `${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than ${when}`}.`);
  }
  if (now.falseAlarms !== null && then.falseAlarms !== null) {
    const diff = now.falseAlarms - then.falseAlarms;
    lines.push(`${mistakes(now.falseAlarms)}, ${diff === 0 ? `the same as ${when}` : `${plural(Math.abs(diff), 'time')} ${diff < 0 ? 'fewer' : 'more'} than ${when}`}.`);
  }
  return lines;
}
