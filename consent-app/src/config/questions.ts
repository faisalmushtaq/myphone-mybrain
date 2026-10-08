/**
 * A few quick questions for the parent or carer about how they see the
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
  /** The part of a longer form the question belongs to, shown above it. */
  topic?: string;
  /** "{child}" is replaced with the young person's first name. */
  text: string;
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'choice';
  options: QuestionOption[];
  /** Short answers (such as ages) laid out in a grid of small buttons; longer ones keep a full row. */
  compact?: boolean;
}

/** More than one answer can be chosen; the value is the chosen values joined by ";". "I don't know" ('unsure') stands alone. */
export interface MultiQuestion extends QuestionBase {
  type: 'multi';
  hint: string;
  options: QuestionOption[];
}

export interface TextQuestion extends QuestionBase {
  type: 'text';
  hint: string;
  maxLength: number;
}

export type Question = ChoiceQuestion | MultiQuestion | TextQuestion;

/** The values chosen for a question that takes more than one answer. */
export const multiValues = (value: string | undefined): string[] => (value ? value.split(';').filter(Boolean) : []);

export const parentQuestionsForm: { id: string; version: string; draft: boolean; questions: Question[] } = {
  id: 'mpmb-parent-perceptions',
  // 0.3: one question about social media (8 October 2026).
  version: '0.3-draft',
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
      id: 'social-media-time',
      version: '0.1-draft',
      type: 'choice',
      label: 'Time on social media',
      text: 'On a normal day, how long is {child} on social media, like TikTok, Snapchat, Instagram or YouTube?',
      options: [
        { value: 'none', label: 'They don’t use it' },
        { value: 'under-1', label: 'Less than 1 hour' },
        { value: '1-2', label: '1 to 2 hours' },
        { value: '2-4', label: '2 to 4 hours' },
        { value: 'over-4', label: 'More than 4 hours' },
        { value: 'unsure', label: 'I don’t know' },
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

const dontKnow = { value: 'unsure', label: 'I don’t know' };
const hours = [
  { value: 'under-1', label: 'Less than 1 hour' },
  { value: '1-2', label: '1 to 2 hours' },
  { value: '2-3', label: '2 to 3 hours' },
  { value: '3-4', label: '3 to 4 hours' },
  { value: '4-6', label: '4 to 6 hours' },
  { value: 'over-6', label: 'More than 6 hours' },
  dontKnow,
];

/**
 * The longer questions for the parent or carer, asked whenever the young
 * person's screen time is not coming through this form: the parent said no
 * to the screenshots, or could not send them from their own phone, or the
 * young person said no, was not there, or skipped them (decided 7 October
 * 2026: time and apps, night-time and sleep, and effects; not rules at
 * home). Every question can be skipped. PLACEHOLDER wording, to be replaced
 * with the team's own (validated) items. Keep in step with the server, which
 * reads this file at build time.
 *
 * 0.2 (7 October 2026): the age at their own smartphone goes down to "Under
 * 5", year by year, with "I can't remember / I don't know"; more than one
 * app can be chosen.
 */
export const parentMoreForm: { id: string; version: string; draft: boolean; questions: Question[] } = {
  id: 'mpmb-parent-phone-use',
  // 0.4: when they started on social media (8 October 2026).
  // 0.3: without the questions the quick questions already ask (8 October 2026): the effect on sleep ("gets in the way of sleep, schoolwork or family time"), good or bad overall ("how concerned are you"), and a second "anything else".
  version: '0.4-draft',
  draft: true,
  questions: [
    {
      id: 'own-phone-age',
      version: '0.2-draft',
      type: 'choice',
      topic: 'Time and apps',
      label: 'Age at own smartphone',
      text: 'How old was {child} when they got their own smartphone?',
      compact: true,
      options: [
        { value: 'under-5', label: 'Under 5' },
        ...['5', '6', '7', '8', '9', '10', '11', '12', '13', '14'].map((age) => ({ value: age, label: age })),
        { value: '15-plus', label: '15 or older' },
        { value: 'none', label: 'They don’t have their own' },
        { value: 'unsure', label: 'I can’t remember / I don’t know' },
      ],
    },
    {
      id: 'social-media-age',
      version: '0.1-draft',
      type: 'choice',
      topic: 'Time and apps',
      label: 'Age at first social media',
      text: 'How old was {child} when they started using social media?',
      compact: true,
      options: [
        { value: 'under-8', label: 'Under 8' },
        ...['8', '9', '10', '11', '12', '13', '14'].map((age) => ({ value: age, label: age })),
        { value: '15-plus', label: '15 or older' },
        { value: 'none', label: 'They don’t use it' },
        { value: 'unsure', label: 'I can’t remember / I don’t know' },
      ],
    },
    { id: 'school-day-time', version: '0.1-draft', type: 'choice', topic: 'Time and apps', label: 'Time on a school day', text: 'On a school day, roughly how long is {child} on their phone, outside school hours?', options: hours },
    { id: 'weekend-time', version: '0.1-draft', type: 'choice', topic: 'Time and apps', label: 'Time on a weekend day', text: 'On a weekend day, roughly how long is {child} on their phone?', options: hours },
    {
      id: 'top-app',
      version: '0.2-draft',
      type: 'multi',
      topic: 'Time and apps',
      label: 'Apps used most',
      text: 'Which apps does {child} spend most time on?',
      hint: 'Choose all that apply.',
      options: [
        { value: 'tiktok', label: 'TikTok' },
        { value: 'youtube', label: 'YouTube' },
        { value: 'instagram', label: 'Instagram' },
        { value: 'snapchat', label: 'Snapchat' },
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'games', label: 'Games' },
        { value: 'other', label: 'Something else' },
        dontKnow,
      ],
    },
    {
      id: 'phone-in-bedroom',
      version: '0.1-draft',
      type: 'choice',
      topic: 'Night-time and sleep',
      label: 'Phone in the bedroom at night',
      text: 'How often does {child}’s phone stay in their bedroom overnight?',
      options: [
        { value: 'never', label: 'Never' },
        { value: 'some-nights', label: 'Some nights' },
        { value: 'most-nights', label: 'Most nights' },
        { value: 'every-night', label: 'Every night' },
        dontKnow,
      ],
    },
    {
      id: 'after-bedtime',
      version: '0.1-draft',
      type: 'choice',
      topic: 'Night-time and sleep',
      label: 'On the phone after bedtime',
      text: 'How often is {child} on their phone when they should be asleep?',
      options: [
        { value: 'never', label: 'Never' },
        { value: 'rarely', label: 'Rarely' },
        { value: 'sometimes', label: 'Sometimes' },
        { value: 'often', label: 'Often' },
        { value: 'most-nights', label: 'Most nights' },
        dontKnow,
      ],
    },
    {
      id: 'mood-after',
      version: '0.1-draft',
      type: 'choice',
      topic: 'Effects',
      label: 'Mood after phone use',
      text: 'After time on their phone, how does {child} usually seem?',
      options: [
        { value: 'much-worse', label: 'Much worse' },
        { value: 'a-bit-worse', label: 'A bit worse' },
        { value: 'no-different', label: 'No different' },
        { value: 'a-bit-better', label: 'A bit better' },
        { value: 'much-better', label: 'Much better' },
        dontKnow,
      ],
    },
    {
      id: 'helps',
      version: '0.1-draft',
      type: 'choice',
      topic: 'Effects',
      label: 'How much it helps',
      text: 'How much does {child}’s phone help them, for example to keep in touch, learn or relax?',
      options: [
        { value: 'not-at-all', label: 'Not at all' },
        { value: 'a-little', label: 'A little' },
        { value: 'somewhat', label: 'Somewhat' },
        { value: 'a-lot', label: 'A lot' },
        dontKnow,
      ],
    },
  ],
};

