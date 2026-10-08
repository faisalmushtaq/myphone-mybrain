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

/**
 * Shown on the welcome screen. Since 7 October 2026 the workshop at school
 * (and linking with records) is opt-out, by email; this form is about the
 * opt-in part: sharing screen time, and the parent's answers.
 */
export const aboutStudy = {
  parent: {
    kicker: 'About the study',
    heading: 'What MyPhone/MyBrain is about',
    intro:
      'MyPhone/MyBrain is a University of Leeds research project working with secondary schools in Bradford and Leeds. We want to understand how young people use phones, and how different patterns of use relate to brain development, wellbeing and learning.',
    cards: [
      {
        title: 'The workshop at school',
        body: 'Every young person in the classes taking part is invited to a MyPhone/MyBrain workshop at school, unless a parent or carer opts them out. Opting out is by email, and also means nothing about them is linked with health or school records. You don’t need this form for the workshop.',
      },
      {
        title: 'What this form is for',
        body: 'Sharing screenshots of your child’s screen-time summary (which apps they use, and for how long) and a few questions for you about their phone use. Both are optional. Young people aged 16 or over can share their own screen time.',
      },
      {
        title: 'What we are not doing',
        body: 'We are not judging how much anyone uses their phone. We do not read messages, look at photos or see what is posted. Results are reported for groups of young people, never as a profile of one child.',
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
        title: 'What this form is for',
        body: 'Sharing screenshots of your phone’s screen-time summary: which apps you use and for how long. It is your choice. At 16 or over you can do it on your own; under 16, your parent or carer says it is okay first.',
      },
      {
        title: 'What we are not doing',
        body: 'We are not saying phones are good or bad. We do not read your messages, look at your photos or see what you post. We only ever report results for groups of young people, never for one person.',
      },
      {
        title: 'It is your choice',
        body: 'You can say no, and you can stop at any time. Nobody will mind.',
      },
    ],
    draft: true,
  },
};

/**
 * Version of the information shown to parents. It is stamped on the
 * permission record so the team knows exactly which text was read.
 * PLACEHOLDER — replace with the approved sheet's version and date.
 * 0.5: no separate route for concerns or complaints (7 October 2026).
 * 0.6: a lightweight headset, as in the approved information sheet, not a "soft cap" (7 October 2026).
 */
export const parentInformationVersion = { version: '0.6-draft', date: '2026-10-07' };

/**
 * Earlier versions the server still accepts, so a family who read one of them
 * and signed before an update reached the site can still save. List only
 * recent ones; the version a family saw is stored with their permission.
 */
export const earlierInformationVersions: string[] = ['0.5-draft'];

/** The information for parents and carers, shown before their permission. */
export const parentInformation: InfoSection[] = [
  {
    id: 'what-this-is',
    title: 'What this form is for',
    summary: 'Sharing your child’s screen time, if you agree, and a few questions for you about their phone use. Both are optional.',
    detail: [
      'Screen time means screenshots of the phone’s Screen Time or Digital Wellbeing page: the list of apps and the time spent on each. How a phone is used matters as much as how much. If you can see your child’s screen time on your own phone (Apple Family Sharing or Google Family Link), you can send it from there; otherwise your child can send it from their phone, if they want to.',
      'Your answers to the questions are used in the study too, labelled with a code rather than a name. If the screen time is not shared, we ask you a few more questions instead.',
      'Young people aged 16 or over decide for themselves about sharing their own screen time.',
    ],
    draft: true,
  },
  {
    id: 'workshop',
    title: 'The workshop at school',
    summary: 'Separate from this form: every young person in the classes taking part is invited, unless a parent or carer opts them out by email.',
    detail: [
      'In the workshop, young people wear a lightweight headset that records brain activity (EEG) while they do simple tasks on a computer. It doesn’t hurt, and they can stop at any time.',
      'As part of the same study, information about young people who take part may be linked, through Connected West Yorkshire, with records already held about them (NHS health records and education records such as attendance and results), using a code rather than a name and only with the approvals in place.',
      'To opt your child out of the workshop, and so out of the linking, a parent or carer emails the team: see “Opt out of the workshop” at the start of this form. This form does not change anything about the workshop.',
    ],
    draft: true, // PLACEHOLDER — confirm the wording, the approvals and their references with the governance team
  },
  {
    id: 'protection',
    title: 'How information is protected',
    summary: 'Stored in secure University systems with controlled access. Never sold or shared with social media companies.',
    detail: [
      'Identifying details (names, dates of birth, contact details) are stored separately from research information and are only used to manage the study and match records correctly.',
      'Research information is analysed using study codes. Results are published for groups of people, never for individuals. Screenshots are never shown to your child’s school.',
      'There is one exception to confidentiality: if the team were seriously worried about your child’s safety or someone else’s, they may need to tell someone who can help, and would talk to you and your child first wherever possible.',
      'The University of Leeds is responsible for the information. The full privacy notice explains the legal basis and how long information is kept.',
    ],
    draft: true,
  },
  {
    id: 'withdraw',
    title: 'Changing your mind',
    summary: 'You or your child can stop at any time, without giving a reason.',
    detail: [
      'Contact the team and tell us what you would like to withdraw: the screenshots, your answers, or your child from the study as a whole.',
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
    ],
    draft: true,
  },
];

/** Reasons shown on the phone-type screen. */
export const whyPhoneUse = {
  heading: 'Share your screen time and the apps you use',
  intro:
    'Phones are part of everyday life. We want to understand how young people actually use them, not how much people guess they do. Patterns differ a lot from person to person, and that is exactly what we want to understand. Which apps, and for how long, tells us far more than the total alone: how a phone is used matters as much as how much.',
  points: [
    { title: 'What you share', body: 'Screenshots of the phone’s screen-time summary showing the list of apps and roughly how long each was used. The apps matter as much as the total.' },
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
    'Sharing your screen time means sending screenshots of your phone’s screen-time page: which apps you used, and for how long. Not your messages, photos or what you watched.',
    'We take your name off and use a code number instead. We only share results about big groups of young people, never about you, and we never show your screenshots to your school. If we were worried that you were not safe, we might tell someone who can help, and we would talk to you first if we could.',
  ],
  ask: 'You can ask a parent, a teacher or the research team anything before you sign.',
  draft: true,
};

/** The thank-you screen. */
export const thankYou = {
  heading: 'Thank you.',
  why: [
    'Almost everything people say about young people and phones is guesswork, because nobody has had good evidence. MyPhone/MyBrain is collecting it, carefully, from thousands of young people in Bradford and Leeds.',
    'Every family that shares makes the picture clearer, and the screenshots of screen time and app use are the part no one else can provide. What we learn goes back to young people, families and schools, and to the people who make decisions about education and health.',
  ],
  draft: true,
};
