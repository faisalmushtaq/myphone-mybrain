/**
 * The online study's questionnaires: the social media break lab study's
 * published MySelf surveys (breakStudyItems.json, exported by
 * scripts/export-myself-items.mjs) plus the study-written motivation questions
 * (motivation.ts), in MySelf's own item format, so the same wording, answer
 * options, order and display conditions are used.
 *
 * Pure functions: which questions show, given the answers so far, and
 * whether an answer is complete.
 */
export interface Option {
  code: number;
  label: string;
  kind?: string;
  textEntry?: boolean;
}

export interface ItemRef {
  instrument: string;
  item: string;
}

export type Condition =
  | { op: 'selected' | 'not_selected'; target: { item: ItemRef }; code: number }
  | { op: 'any' | 'all'; args: Condition[] }
  | { op: 'in_group'; target: { item: ItemRef }; group: string; code: number };

export interface SurveyItem {
  key: string;
  variable: string;
  responseType: 'single_choice' | 'multi_choice' | 'ladder' | 'numeric' | 'text_short' | 'text_long' | 'rank_group' | 'time_grid' | 'info' | 'scale_0_10';
  stem: { text: string };
  lede?: { text: string };
  hint?: string;
  required?: 'hard' | 'soft' | 'none';
  allowDecline?: boolean;
  presentation?: string;
  options?: Option[] | null;
  displayIf?: Condition | null;
  // Type-specific
  rungs?: number;
  lowestValue?: number;
  topLabel?: string;
  bottomLabel?: string;
  min?: number;
  max?: number;
  integerOnly?: boolean;
  unitLabel?: string;
  confirmAbove?: number;
  minSelections?: number;
  minChars?: number;
  maxChars?: number;
  groups?: { key: string; label: string; ranked?: boolean }[];
  rowsFrom?: ItemRef & { group: string };
  limitOptions?: { kind: 'at_most_age_now' };
  /** 0–10 scales: the words at each end. */
  ends?: [string, string];
}

export interface SurveyBlock {
  instrument: string;
  name: string;
  citation?: string | null;
  licence?: { status?: string } | null;
  instructions?: string | null;
  items: SurveyItem[];
}

export interface SurveySection {
  key: string;
  title: string;
  transition?: string | null;
  blocks: SurveyBlock[];
}

/** An answer: a code, codes, a number, text, a sorting into groups, or minutes per row; or declined. */
export type Answer =
  | { kind: 'code'; code: number; text?: string }
  | { kind: 'codes'; codes: number[]; text?: string }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'groups'; groups: Record<string, number[]> }
  | { kind: 'minutes'; rows: Record<string, number> }
  | { kind: 'declined' }
  | { kind: 'skipped' };

export type Answers = Record<string, Answer>;

/** A question with where it sits. */
export interface Placed {
  section: SurveySection;
  block: SurveyBlock;
  item: SurveyItem;
}

export function flatten(sections: SurveySection[]): Placed[] {
  return sections.flatMap((section) => section.blocks.flatMap((block) => block.items.map((item) => ({ section, block, item }))));
}

const variableOf = (all: Placed[], ref: ItemRef) => all.find((p) => p.block.instrument === ref.instrument && p.item.key === ref.item)?.item.variable;

/** The codes chosen on a question (a single choice, several, or a group of a sorting). */
function codesOf(a: Answer | undefined, group?: string): number[] {
  if (!a) return [];
  if (a.kind === 'code') return [a.code];
  if (a.kind === 'codes') return a.codes;
  if (a.kind === 'groups') return group ? (a.groups[group] ?? []) : Object.values(a.groups).flat();
  return [];
}

export function holds(c: Condition | null | undefined, all: Placed[], answers: Answers): boolean {
  if (!c) return true;
  switch (c.op) {
    case 'any':
      return c.args.some((x) => holds(x, all, answers));
    case 'all':
      return c.args.every((x) => holds(x, all, answers));
    case 'in_group': {
      const v = variableOf(all, c.target.item);
      return v ? codesOf(answers[v], c.group).includes(c.code) : false;
    }
    case 'selected':
    case 'not_selected': {
      const v = variableOf(all, c.target.item);
      const chosen = v ? codesOf(answers[v]).includes(c.code) : false;
      // "Not selected" only once the question was answered: an unanswered question hides both ways.
      if (c.op === 'selected') return chosen;
      return v ? Boolean(answers[v]) && answers[v].kind !== 'skipped' && answers[v].kind !== 'declined' && !chosen : false;
    }
    default:
      return true;
  }
}

/** The rows of a time grid: the options put in the named group of the earlier sorting question. */
export function gridRows(item: SurveyItem, all: Placed[], answers: Answers): Option[] {
  if (!item.rowsFrom) return [];
  const source = all.find((p) => p.block.instrument === item.rowsFrom!.instrument && p.item.key === item.rowsFrom!.item);
  if (!source) return [];
  const codes = codesOf(answers[source.item.variable], item.rowsFrom.group);
  return (source.item.options ?? []).filter((o) => codes.includes(o.code));
}

/** Whether a question is shown now: its condition holds, and a time grid has rows. */
export function shown(p: Placed, all: Placed[], answers: Answers): boolean {
  if (!holds(p.item.displayIf, all, answers)) return false;
  if (p.item.responseType === 'time_grid') return gridRows(p.item, all, answers).length > 0;
  return true;
}

/** The options offered, with ages above the person's age now left out where the question says so. */
export function optionsFor(item: SurveyItem, ageNow: number | null): Option[] {
  const opts = item.options ?? [];
  if (item.limitOptions?.kind === 'at_most_age_now' && ageNow !== null) {
    return opts.filter((o) => {
      const n = Number.parseInt(o.label, 10);
      return Number.isNaN(n) || n <= ageNow;
    });
  }
  return opts;
}

/** A problem with an answer, or null if it will do. */
export function problemWith(item: SurveyItem, a: Answer | undefined): string | null {
  if (item.responseType === 'info') return null;
  if (!a || a.kind === 'skipped') return item.required === 'hard' ? 'Please answer this question to go on.' : null;
  if (a.kind === 'declined') return null;
  switch (item.responseType) {
    case 'single_choice': {
      if (a.kind !== 'code') return 'Please choose an answer.';
      const o = item.options?.find((x) => x.code === a.code);
      if (o?.textEntry && !a.text?.trim()) return 'Please type your answer in the box.';
      return null;
    }
    case 'multi_choice': {
      if (a.kind !== 'codes' || a.codes.length < (item.minSelections ?? 1)) return 'Please choose at least one answer.';
      const other = item.options?.find((x) => x.textEntry && a.codes.includes(x.code));
      if (other && !a.text?.trim()) return 'Please type your answer in the box.';
      return null;
    }
    case 'ladder':
    case 'scale_0_10':
      return a.kind === 'number' ? null : 'Please choose a step.';
    case 'numeric': {
      if (a.kind !== 'number' || Number.isNaN(a.value)) return 'Please enter a number.';
      if (item.integerOnly !== false && !Number.isInteger(a.value)) return 'Please enter a whole number.';
      if (item.min !== undefined && a.value < item.min) return `Please enter a number of at least ${item.min}.`;
      if (item.max !== undefined && a.value > item.max) return `Please enter a number no more than ${item.max}.`;
      return null;
    }
    case 'text_short':
    case 'text_long': {
      if (a.kind !== 'text') return 'Please type an answer.';
      if (item.minChars && a.value.trim().length < item.minChars) return `Please write at least ${item.minChars} characters.`;
      return null;
    }
    case 'rank_group':
      return a.kind === 'groups' ? null : 'Please sort the apps.';
    case 'time_grid':
      return a.kind === 'minutes' ? null : 'Please give the time for each app, or 0.';
    default:
      return null;
  }
}

/** The questions shown now, in order. */
export function visibleQuestions(all: Placed[], answers: Answers): Placed[] {
  return all.filter((p) => shown(p, all, answers));
}
