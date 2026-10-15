import { describe, expect, it } from 'vitest';
import { optionsFor, parentMoreForm, parentNoPhoneForm, parentQuestionOrder, parentQuestionsForm, type ChoiceQuestion } from './questions';

const q = (id: string) => parentMoreForm.questions.find((x) => x.id === id) as ChoiceQuestion;

describe('the parent’s questions as one set (15 October 2026)', () => {
  it('no age older than the young person is now is offered; the other answers stay', () => {
    const at13 = optionsFor(q('own-phone-age'), 13).map((o) => o.value);
    expect(at13).toContain('13');
    expect(at13).not.toContain('14');
    expect(at13).not.toContain('15-plus');
    expect(at13).toContain('under-5');
    expect(at13).toContain('unsure');
    expect(optionsFor(q('own-phone-age'), 16).map((o) => o.value)).toContain('15-plus');
    expect(optionsFor(q('social-media-age'), 11).map((o) => o.value)).toEqual(['under-8', '8', '9', '10', '11', 'none', 'unsure']);
    expect(optionsFor(q('own-phone-age'), null)).toEqual(q('own-phone-age').options);
    // When they will get a phone: nothing younger than they are now.
    const expected = parentNoPhoneForm.questions.find((x) => x.id === 'expected-age') as ChoiceQuestion;
    expect(optionsFor(expected, 13).map((o) => o.value)).toEqual(['13', '14', '15', '16-plus', 'unsure']);
    expect(optionsFor(expected, 11).map((o) => o.value)).toEqual(['11', '12', '13', '14', '15', '16-plus', 'unsure']);
  });

  it('the order names every question once: facts first, the open question last', () => {
    const ids = [...parentQuestionsForm.questions, ...parentMoreForm.questions].map((x) => x.id).sort();
    expect(parentQuestionOrder.map((o) => o.id).sort()).toEqual(ids);
    expect(parentQuestionOrder[0].id).toBe('own-phone-age');
    expect(parentQuestionOrder[1].id).toBe('social-media-age');
    expect(parentQuestionOrder[parentQuestionOrder.length - 1].id).toBe('anything-else');
  });
});
