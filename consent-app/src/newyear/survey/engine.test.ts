import { describe, expect, it } from 'vitest';
import { flatten, gridRows, optionsFor, problemWith, shown, visibleQuestions, type Answers, type SurveySection } from './engine';
import items from './breakStudyItems.json';
import { surveyFor } from './surveys';

const start = flatten(surveyFor('start')!.sections);
const byVar = (v: string) => start.find((p) => p.item.variable === v)!;

describe('the online study’s questionnaires', () => {
  it('are the break study’s published surveys, without identity, address, UK demographics or the EEG question', () => {
    expect(items.start.survey).toBe('social_media_break_lab_study');
    expect(items.end.survey).toBe('post_break_lab_study');
    const vars = start.map((p) => p.item.variable);
    for (const left of ['first_name', 'last_name', 'dob', 'home_address', 'ethnicity']) expect(vars).not.toContain(left);
    for (const kept of ['swemwbs_q1', 'phq4_q4', 'sm_apps_owned', 'app_minutes', 'sss_society', 'phone_pickups']) expect(vars).toContain(kept);
    // The motivation questions come first, and every variable is unique.
    expect(vars[0]).toBe('mot_reasons');
    expect(new Set(vars).size).toBe(vars.length);
    for (const kind of ['end', 'followup1'] as const) {
      const v = flatten(surveyFor(kind)!.sections).map((p) => p.item.variable);
      expect(new Set(v).size).toBe(v.length);
    }
    expect(surveyFor('return')).toBeNull();
  });

  it('shows the time on each app only for the apps people said they have', () => {
    const grid = byVar('app_minutes');
    const answers: Answers = {};
    expect(shown(grid, start, answers)).toBe(false);
    answers.sm_apps_owned = { kind: 'groups', groups: { have: [3, 1], dont_have: [2] } };
    expect(shown(grid, start, answers)).toBe(true);
    expect(gridRows(grid.item, start, answers).map((o) => o.code).sort()).toEqual([1, 3]);
  });

  it('follows the published display conditions', () => {
    const conditional = start.filter((p) => p.item.displayIf);
    expect(conditional.length).toBeGreaterThan(5);
    // With nothing answered, questions that depend on an answer are hidden.
    const visible = visibleQuestions(start, {});
    expect(visible.length).toBeLessThan(start.length);
  });

  it('offers only ages up to the person’s age now, where the question says so', () => {
    const age = start.find((p) => p.item.limitOptions)!;
    const all = optionsFor(age.item, null).length;
    expect(optionsFor(age.item, 18).length).toBeLessThan(all);
  });

  it('checks answers: required ones, "other" text, numbers in range', () => {
    const reasons = byVar('mot_reasons').item;
    expect(problemWith(reasons, undefined)).toMatch(/answer/);
    expect(problemWith(reasons, { kind: 'codes', codes: [13] })).toMatch(/type/);
    expect(problemWith(reasons, { kind: 'codes', codes: [13], text: 'x' })).toBeNull();
    const pickups = byVar('phone_pickups').item;
    expect(problemWith(pickups, { kind: 'number', value: 5000 })).toMatch(/no more than/);
    expect(problemWith(pickups, { kind: 'declined' })).toBeNull();
    const soft: SurveySection['blocks'][number]['items'][number] = { ...reasons, required: 'soft' };
    expect(problemWith(soft, undefined)).toBeNull();
  });
});
