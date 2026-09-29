/**
 * A few one-tap questions for the parent or guardian about how they see the
 * young person's phone use, asked straight after their permission. Optional,
 * and clearly separate from the permission: the answers are research
 * information, stored with the participant's code rather than their name.
 *
 * PLACEHOLDER wording. The study team may replace these with validated
 * items; each question and the form carry a version so that answers can
 * always be read against the wording that was shown.
 */
export interface QuestionOption {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  version: string;
  /** Short label for summaries. */
  label: string;
  /** "{child}" is replaced with the young person's first name. */
  text: string;
  options: QuestionOption[];
}

export const parentQuestionsForm: { id: string; version: string; draft: boolean; questions: Question[] } = {
  id: 'mpmb-parent-perceptions',
  version: '0.1-draft',
  draft: true,
  questions: [
    {
      id: 'concern',
      version: '0.1-draft',
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
      id: 'time-school-day',
      version: '0.1-draft',
      label: 'Time on a school day',
      text: 'On a typical school day, roughly how long do you think {child} spends on their phone?',
      options: [
        { value: 'under-1h', label: 'Under 1 hour' },
        { value: '1-2h', label: '1 to 2 hours' },
        { value: '2-4h', label: '2 to 4 hours' },
        { value: '4-6h', label: '4 to 6 hours' },
        { value: 'over-6h', label: 'More than 6 hours' },
        { value: 'unsure', label: 'I don’t know' },
      ],
    },
    {
      id: 'compared-peers',
      version: '0.1-draft',
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
      id: 'overall',
      version: '0.1-draft',
      label: 'Overall',
      text: 'Overall, do you think {child}’s phone use is…',
      options: [
        { value: 'mostly-good', label: 'Mostly good for them' },
        { value: 'mixed', label: 'A mix of good and bad' },
        { value: 'mostly-bad', label: 'Mostly bad for them' },
        { value: 'unsure', label: 'I’m not sure' },
      ],
    },
  ],
};
