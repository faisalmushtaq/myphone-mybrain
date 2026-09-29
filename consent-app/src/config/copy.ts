/**
 * Longer wording used by the information screens.
 *
 * Everything marked `draft: true` is prototype text that must be replaced with
 * the ethics-approved participant information. The interface shows a small
 * "draft wording" marker next to draft text so reviewers can see what is
 * still to be finalised.
 */
export interface InfoSection {
  id: string;
  title: string;
  summary: string;
  detail: string[];
  draft: boolean;
}

/** Shown on the "About the study" screen. Two versions: one per audience. */
export const aboutStudy = {
  parent: {
    kicker: 'About the study',
    heading: 'What MyPhone/MyBrain is about',
    intro:
      'MyPhone/MyBrain is a University of Leeds research project working with secondary schools in Bradford and Leeds. We want to understand how young people use phones, and how different patterns of use relate to brain development, wellbeing and learning.',
    cards: [
      {
        title: 'What we ask for today',
        body: 'Your permission for your child to take part, your child’s own agreement, and, if you are both happy, a screenshot of your child’s screen-time summary.',
      },
      {
        title: 'What we are not doing',
        body: 'We are not judging how much anyone uses their phone. We do not read messages, look at photos or see what is posted. Results are reported for groups of young people, never as a profile of one child.',
      },
      {
        title: 'You stay in control',
        body: 'Each permission is a separate choice. You can change your mind later by contacting the team.',
      },
    ],
    draft: true,
  },
  young: {
    kicker: 'About the study',
    heading: 'What MyPhone/MyBrain is about',
    intro:
      'MyPhone/MyBrain is a research project run by the University of Leeds. We are working with schools in Bradford and Leeds to understand how young people use their phones, and how that connects with how the brain develops, how people feel, and how they learn.',
    cards: [
      {
        title: 'What taking part means',
        body: 'Short surveys about everyday life and how you feel. Some people are invited to a session at school, where you wear a cap that records brain activity while you do simple tasks on a computer. If you want, you can also share a screenshot of your phone’s screen-time summary. You choose which parts to do.',
      },
      {
        title: 'What we are not doing',
        body: 'We are not saying phones are good or bad. We do not read your messages, look at your photos or see what you post. We only ever report results for groups of young people, never for one person.',
      },
      {
        title: 'It is your choice',
        body: 'You can say no to any part, and you can stop at any time. Nobody will mind.',
      },
    ],
    draft: true,
  },
};

/**
 * Version of the participant information shown to parents. It is stamped on
 * the consent record so the team knows exactly which text was read.
 * PLACEHOLDER — replace with the approved sheet's version and date.
 */
export const parentInformationVersion = { version: '0.3-draft', date: '2026-09-29' };

/** Participant information for parents/guardians, shown before the consent statements. */
export const parentInformation: InfoSection[] = [
  {
    id: 'what-involved',
    title: 'What taking part involves',
    summary: 'Short surveys, an optional session at school, and (if you choose) sharing phone-use information.',
    detail: [
      'Young people complete short surveys about everyday life, wellbeing and technology. Some are invited to a session at school that may include an EEG recording, which measures brain activity safely and painlessly using a cap with sensors.',
      'Families can also choose to share a summary of the young person’s phone use, usually as a screenshot of the phone’s screen-time or digital-wellbeing screen.',
      'Everything is optional. Your child can choose which parts to do.',
    ],
    draft: true,
  },
  {
    id: 'phone-use',
    title: 'Phone-use information',
    summary: 'A screenshot of the screen-time summary: which apps were used and for how long. Not messages, photos or posts.',
    detail: [
      'Patterns of phone use differ a lot between young people. We want to understand those differences scientifically, rather than rely on guesses about screen time.',
      'We use this information to look for patterns across many young people. We do not assess or report on any individual child.',
      'Before sharing a screenshot, families can check it and hide anything they do not want to share.',
    ],
    draft: true,
  },
  {
    id: 'linking',
    title: 'Linking with records already held',
    summary: 'With your permission, study information can be linked, through Connected West Yorkshire, to NHS, education and other routinely held records, using a code rather than a name.',
    detail: [
      'Linking lets the study look at longer-term patterns in health, learning and wellbeing without asking families for more forms. The records are ones that already exist: NHS health records, education records such as attendance and results, and other routinely collected records. You give one permission that covers all of these, and you can withdraw it at any time.',
      'Connected West Yorkshire is a secure research data service. Linking happens inside it, following its access procedures, and only with the approvals in place: the study’s ethics approval from the University of Leeds and, for NHS records, from an NHS Research Ethics Committee; permission from the organisation that holds each record, for example the NHS or the Department for Education; and approval through Connected West Yorkshire’s own data access process. Researchers work with the linked information only inside the secure service.',
      'Linked information is labelled with a code, not your child’s name, and the key that connects the code to your child is kept separately in a system with restricted access. It is not anonymous, but researchers analysing the information do not see names or contact details. Results are only ever reported for groups of young people.',
    ],
    draft: true, // PLACEHOLDER — confirm the exact approvals and their references with the governance team
  },
  {
    id: 'protection',
    title: 'How information is protected',
    summary: 'Stored in secure University systems with controlled access. Never sold or shared with social media companies.',
    detail: [
      'Identifying details (names, dates of birth, contact details) are stored separately from research information and are only used to manage the study and match records correctly.',
      'Research information is analysed using study codes. Results are published for groups of people, never for individuals.',
      'Your child’s identifying details are only shared outside the University if you agree to record linkage, and then only with the organisation doing the linking. There is one exception: if the team were seriously worried about your child’s safety or someone else’s, they may need to tell someone who can help, and would talk to you and your child first wherever possible.',
      'The University of Leeds is responsible for the information. The full privacy notice explains the legal basis and how long information is kept.',
    ],
    draft: true,
  },
  {
    id: 'withdraw',
    title: 'Changing your mind',
    summary: 'You or your child can stop at any time, without giving a reason.',
    detail: [
      'Contact the team and tell us what you would like to withdraw from: the study as a whole, or a single part such as record linkage.',
      'Information already used in completed analyses may not be removable, and the team will explain what can and cannot be undone.',
    ],
    draft: true,
  },
  {
    id: 'contact',
    title: 'Who to contact',
    summary: 'The MyPhone/MyBrain team at the University of Leeds.',
    detail: [
      'Email brainpop@leeds.ac.uk with any question about the study. We aim to reply within five working days.',
      'If you have a concern or complaint about how the study is being run and would rather not raise it with the research team, you can contact the Faculty Research Ethics Committee at the University of Leeds (contact details to be confirmed), who are independent of the study.',
    ],
    draft: true,
  },
];

/** Reasons shown on the phone-type screen. */
export const whyPhoneUse = {
  heading: 'Share your phone-use information',
  intro:
    'Phones are part of everyday life. We want to understand how young people actually use them, not how much people guess they do. Patterns differ a lot from person to person, and that is exactly what we want to understand.',
  points: [
    { title: 'What you share', body: 'A screenshot of the phone’s screen-time summary: which apps were used and for roughly how long.' },
    { title: 'Why we want it', body: 'To understand patterns across lots of young people, and how those patterns relate to wellbeing, learning and brain development.' },
    { title: 'How we use it', body: 'Researchers look at the information for groups of people. Nobody is judged or ranked, and nobody gets an individual “profile”.' },
    { title: 'How it is protected', body: 'Images are stored by the University of Leeds with a code instead of a name. They are never sold, and never shared with phone or social-media companies or with your school.' },
  ],
  notInterested: ['Messages or chats', 'Photos or videos', 'What was posted or watched', 'Notifications or contacts'],
  reassurance: 'We only need the list of apps and the time spent on each. Before you share a screenshot you can check it and hide anything you would rather keep private, including any app or website you would rather not show.',
  draft: true,
};

/** Short recap shown to the young person just before their own agreement, whichever route was taken. */
export const youngRecap = {
  heading: 'Before you decide',
  points: [
    'Taking part means short surveys, and for some people a session at school where you wear a cap that records brain activity while you do simple computer tasks. You choose which parts to do.',
    'Your answers get a code number instead of your name, and we only report results for groups of young people. If we were ever seriously worried about your safety we might need to tell someone who can help, and we would talk to you first if we could.',
    'If your parent or guardian agreed to it, information that the NHS or your school already holds about you may be added to the study, using the code instead of your name.',
    'You can ask a parent, a teacher or the research team anything before you sign.',
  ],
  draft: true,
};
