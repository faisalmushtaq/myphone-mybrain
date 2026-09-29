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
   * Age from which a young person may consent for themselves. Not enabled:
   * the journey always captures parent/guardian consent for under-18s. If the
   * ethics committee approves self-consent (for example at 16), this value is
   * the place to implement it.
   */
  selfConsentAge: null as number | null,

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
   * When the young person is not present (parent route), allow their
   * agreement to be collected separately (for example at school). The record
   * stores assent as "deferred" and the phone-use steps are skipped.
   */
  allowDeferredAssent: true,

  /** Ask the parent or guardian a few one-tap questions about how they see the young person's phone use, straight after their permission. */
  parentQuestions: true,

  /** Phone-use information is only requested once the young person has agreed. */
  requireAssentBeforeDonation: true,

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
    /** Someone independent of the research team for concerns or complaints. PLACEHOLDER. */
    concerns: {
      name: 'Faculty Research Ethics Committee, University of Leeds', // PLACEHOLDER — confirm the correct independent contact
      email: 'research-ethics@example.leeds.ac.uk', // PLACEHOLDER
    },
    contactPageUrl: '/contact/',
    privacyPageUrl: '/privacy/',
    familiesPageUrl: '/families/',
    documentsPageUrl: '/documents/',
  },
} as const;

export type Study = typeof study;
