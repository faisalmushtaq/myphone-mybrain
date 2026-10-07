/**
 * Study-level settings. Everything here is a configuration point that the
 * research team or governance reviewers may need to change; nothing in the
 * interface hard-codes these values.
 */
export const study = {
  /** Identifier stamped on every record. */
  studyId: 'MPMB',
  /** Site identifier (for example a data-collection region). */
  siteId: 'LEEDS-BRADFORD',
  name: 'MyPhone/MyBrain',
  organisation: 'University of Leeds',

  /**
   * Age range for this parental-consent journey (inclusive). The study works
   * with 11–18-year-olds, but a parent cannot consent on behalf of an adult, so
   * this flow stops at 17; 18-year-olds must consent for themselves through a
   * separate process.
   */
  minAge: 11,
  maxAge: 17,

  /**
   * Age from which a young person decides for themselves about sharing their
   * screen time, without a parent or carer (decided 7 October 2026). Under
   * this age a parent or carer gives permission first: from their own phone
   * if they can see the young person's screen time there (Apple Family
   * Sharing, Google Family Link), otherwise the young person shares from
   * theirs if they want to. See docs/decisions.md.
   */
  selfConsentAge: 16 as number | null,

  /**
   * Minutes without any interaction before the form clears itself. Protects
   * families using a shared or borrowed device.
   */
  inactivityMinutes: 30,

  /**
   * Show the required consent statements as a list under ONE confirmation
   * tick (fast, common in online consent) rather than one checkbox each.
   * Each statement is still recorded individually. The ethics committee may
   * prefer itemised ticks; set false to get them.
   */
  groupRequiredStatements: true,

  /**
   * Accessibility alternative to a drawn signature. When true, a parent who
   * cannot draw can type their full name instead; the record stores which
   * method was used. Whether this is acceptable must be agreed with ethics.
   */
  allowTypedSignature: true,

  /**
   * Let the young person decide later, or the parent say they are not there:
   * the record stores their agreement as "deferred", nothing is shared from
   * their phone, and the parent answers the longer questions instead.
   */
  allowDeferredAssent: true,

  /** Ask every parent or carer a few one-tap questions about how they see the young person's phone use, straight after their permission. */
  parentQuestions: true,

  /**
   * The workshop at school (and linking with records) is opt-out: a parent or
   * carer emails the team, after two warnings on this site. No form, no
   * paper slip (decided 7 October 2026).
   */
  optOut: {
    email: 'brainpop@leeds.ac.uk',
    subject: 'Opt out: MyPhone/MyBrain workshop',
  },

  /** Upload limits enforced in the browser (and again on the server). */
  upload: {
    maxImages: 6,
    maxBytesPerImage: 10 * 1024 * 1024,
    acceptedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    /** Longest edge after in-browser processing (redaction/crop) to limit file size. */
    maxEdgePx: 2200,
  },

  /** Contact details shown on the information and confirmation screens. */
  contact: {
    email: 'brainpop@leeds.ac.uk',
    phone: null as string | null, // PLACEHOLDER — add the team phone number if one is to be published
    team: 'The MyPhone/MyBrain team, University of Leeds',
    contactPageUrl: '/contact/',
    privacyPageUrl: '/privacy/',
    /** The participant information sheet on the website, with how taking part and opting out work. */
    informationSheetUrl: '/information/',
  },
} as const;

export type Study = typeof study;
