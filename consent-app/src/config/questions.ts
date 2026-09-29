/**
 * A few quick questions for the parent or guardian about how they see the
 * young person's phone use, asked straight after their permission. Optional,
 * and clearly separate from the permission: the answers are research
 * information, stored with the participant's code rather than their name.
 *
 * Three one-tap questions and an open text box. PLACEHOLDER wording; the
 * study team may replace these with validated items. Each question and the
 * form carry a version so that answers can always be read against the
 * wording that was shown. Keep in step with firebase/functions/src/forms.ts.
 */
export interface QuestionOption {
  value: string;
  label: string;
}

interface QuestionBase {
  id: string;
  version: string;
  /** Short label for summaries. */
  label: string;
  /** "{child}" is replaced with the young person's first name. */
  text: string;
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'choice';
  options: QuestionOption[];
}

export interface TextQuestion extends QuestionBase {
  type: 'text';
  hint: string;
  maxLength: number;
}

export type Question = ChoiceQuestion | TextQuestion;

export const parentQuestionsForm: { id: string; version: string; draft: boolean; questions: Question[] } = {
  id: 'mpmb-parent-perceptions',
  version: '0.2-draft',
  draft: true,
  questions: [
    {
      id: 'concern',
      version: '0.1-draft',
      type: 'choice',
      label: 'How concerned',
      text: 'How concerned are you about {child}’s phone use?',
      options: [
        { value: 'not-at-all', label: 'Not at all' },
        { value: 'a-little', label: 'A little' },
        { value: 'somewhat', label: 'Somewhat' },
        { value: 'very', label: 'Very' },
        { value: 'extremely', label: 'Extremely' },
      ],
    },
    {
      id: 'compared-peers',
      version: '0.1-draft',
      type: 'choice',
      label: 'Compared with others',
      text: 'Compared with other young people their age, how much does {child} use their phone?',
      options: [
        { value: 'much-less', label: 'Much less' },
        { value: 'a-bit-less', label: 'A bit less' },
        { value: 'about-the-same', label: 'About the same' },
        { value: 'a-bit-more', label: 'A bit more' },
        { value: 'much-more', label: 'Much more' },
        { value: 'unsure', label: 'I don’t know' },
      ],
    },
    {
      id: 'gets-in-the-way',
      version: '0.1-draft',
      type: 'choice',
      label: 'Gets in the way',
      text: 'How often does {child}’s phone use get in the way of sleep, schoolwork or family time?',
      options: [
        { value: 'never', label: 'Never' },
        { value: 'rarely', label: 'Rarely' },
        { value: 'sometimes', label: 'Sometimes' },
        { value: 'often', label: 'Often' },
        { value: 'almost-always', label: 'Almost always' },
      ],
    },
    {
      id: 'anything-else',
      version: '0.1-draft',
      type: 'text',
      label: 'Anything else',
      text: 'Is there anything else you’d like to tell us about {child}’s phone use?',
      hint: 'Optional. For example what works well, what worries you, or what you have tried. Please don’t include names or anything that could identify someone else.',
      maxLength: 500,
    },
  ],
};
