/**
 * Wording and options for the online study (built from the New Year break
 * prototype). This is a preview: none of it has been through ethics review
 * yet (see docs/online-study.md).
 */
export const APPS = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'snapchat', label: 'Snapchat' },
  { id: 'x', label: 'X (Twitter)' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'other', label: 'Other' },
] as const;

export type AppId = (typeof APPS)[number]['id'];
export const APP_IDS: readonly AppId[] = APPS.map((a) => a.id);

/**
 * AI tools people can take a break from (the PI, 21 November 2026). Any mix
 * of social media apps, AI tools and a daily limit for all phone use can be
 * chosen together.
 */
export const AI_TOOLS = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'copilot', label: 'Microsoft Copilot' },
  { id: 'meta-ai', label: 'Meta AI' },
  { id: 'grok', label: 'Grok' },
  { id: 'perplexity', label: 'Perplexity' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'character-ai', label: 'Character.AI' },
  { id: 'other-ai', label: 'Other AI' },
] as const;
export type AiId = (typeof AI_TOOLS)[number]['id'];
export const AI_IDS: readonly AiId[] = AI_TOOLS.map((a) => a.id);

/** Limits, enforced on the inputs and when saved progress is read back. */
export const LIMITS = { otherApp: 30, otherAi: 30, note: 280, minutes: 1440, goalMinMinutes: 15, goalMaxMinutes: 600, startDaysAhead: 365, text: 80 } as const;

/** How someone is getting on, at a check-in: since their last check-in (or the start). */
export type CheckStatus = 'on-track' | 'little' | 'lot' | 'stopped';
export const STATUS_OPTIONS: { value: CheckStatus; label: string }[] = [
  { value: 'on-track', label: 'Yes, still going strong' },
  { value: 'little', label: 'I slipped a little' },
  { value: 'lot', label: 'I slipped a lot' },
  { value: 'stopped', label: 'I’ve stopped for now' },
];
export const isSlip = (s: CheckStatus) => s === 'little' || s === 'lot';

export const MOOD_LABELS = ['Very low', 'Low', 'Okay', 'Good', 'Very good'] as const;
export const URGE_LABELS = ['Not at all', 'A little', 'Some', 'Quite a lot', 'A lot'] as const;

/** The kinds of visit: start, return (any time), end, and the two follow-ups after the end. */
export type VisitKind = 'start' | 'return' | 'end' | 'followup1' | 'followup3';
export const VISIT_TEXT: Record<VisitKind, { name: string; title: string; when: string }> = {
  start: { name: 'Start', title: 'Start visit', when: 'at the start' },
  return: { name: 'Return visit', title: 'Return visit', when: 'at this return visit' },
  end: { name: 'End', title: 'End visit', when: 'at the end' },
  followup1: { name: 'One month on', title: 'One-month follow-up', when: 'a month after the end' },
  followup3: { name: 'Three months on', title: 'Three-month follow-up', when: 'three months after the end' },
};
/** Full visits have the questionnaires; return visits are a screenshot and, if they like, the brain check. */
export const FULL_VISITS: readonly VisitKind[] = ['start', 'end', 'followup1', 'followup3'];
/** A screenshot at least this often, so every day is covered (phones keep limited history). */
export const SCREENSHOT_EVERY_DAYS = 7;
/** Follow-ups after the end visit, in days, and how long each stays open. */
export const FOLLOW_UPS: { kind: VisitKind; afterDays: number; windowDays: number }[] = [
  { kind: 'followup1', afterDays: 30, windowDays: 14 },
  { kind: 'followup3', afterDays: 90, windowDays: 21 },
];

/** Reminders: how often, and how (the person consents to each at joining). */
export type ReminderFrequency = 'daily' | 'every-3-days' | 'weekly' | 'never';
export const REMINDER_OPTIONS: { value: ReminderFrequency; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'every-3-days', label: 'Every few days' },
  { value: 'weekly', label: 'Once a week (with the screenshot reminder)' },
  { value: 'never', label: 'No reminders' },
];

/** Demographics (the PI, 20 November 2026). Every question has "Prefer not to say". */
export const PREFER_NOT = 'prefer-not';
export const SEX_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'intersex', label: 'Intersex' },
  { value: PREFER_NOT, label: 'Prefer not to say' },
];
export const GENDER_OPTIONS = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'non-binary', label: 'Non-binary' },
  { value: 'self-describe', label: 'Prefer to self-describe' },
  { value: PREFER_NOT, label: 'Prefer not to say' },
];
/** UK census (England and Wales, 2021) groups, with self-describe; country of birth carries the international picture. */
export const ETHNICITY_GROUPS: { group: string; options: { value: string; label: string }[] }[] = [
  { group: 'Asian or Asian British', options: [{ value: 'asian-indian', label: 'Indian' }, { value: 'asian-pakistani', label: 'Pakistani' }, { value: 'asian-bangladeshi', label: 'Bangladeshi' }, { value: 'asian-chinese', label: 'Chinese' }, { value: 'asian-other', label: 'Any other Asian background' }] },
  { group: 'Black, Black British, Caribbean or African', options: [{ value: 'black-caribbean', label: 'Caribbean' }, { value: 'black-african', label: 'African' }, { value: 'black-other', label: 'Any other Black, Black British or Caribbean background' }] },
  { group: 'Mixed or multiple ethnic groups', options: [{ value: 'mixed-white-black-caribbean', label: 'White and Black Caribbean' }, { value: 'mixed-white-black-african', label: 'White and Black African' }, { value: 'mixed-white-asian', label: 'White and Asian' }, { value: 'mixed-other', label: 'Any other Mixed or multiple ethnic background' }] },
  { group: 'White', options: [{ value: 'white-british', label: 'English, Welsh, Scottish, Northern Irish or British' }, { value: 'white-irish', label: 'Irish' }, { value: 'white-traveller', label: 'Gypsy or Irish Traveller' }, { value: 'white-roma', label: 'Roma' }, { value: 'white-other', label: 'Any other White background' }] },
  { group: 'Another ethnic group', options: [{ value: 'arab', label: 'Arab' }, { value: 'other', label: 'Any other ethnic group' }] },
];
export const ETHNICITY_SELF_DESCRIBE = 'self-describe';
/** ISCED 2011 levels in plain words, so countries compare. */
export const EDUCATION_OPTIONS = [
  { value: 'isced0', label: 'No formal education, or did not finish primary school' },
  { value: 'isced1', label: 'Primary school' },
  { value: 'isced2', label: 'Lower secondary school (for example GCSEs, or up to age 15 or 16)' },
  { value: 'isced3', label: 'Upper secondary school (for example A levels, a high school diploma, the Baccalauréat)' },
  { value: 'isced4', label: 'A vocational or technical qualification after school' },
  { value: 'isced5', label: 'A short higher education course (for example an HND, a foundation or associate degree)' },
  { value: 'isced6', label: 'A bachelor’s degree, or equivalent' },
  { value: 'isced7', label: 'A master’s degree, or equivalent' },
  { value: 'isced8', label: 'A doctorate (PhD), or equivalent' },
  { value: PREFER_NOT, label: 'Prefer not to say' },
];
export const WORK_OPTIONS = [
  { value: 'student', label: 'In education' },
  { value: 'employed', label: 'Employed' },
  { value: 'self-employed', label: 'Self-employed' },
  { value: 'not-working', label: 'Not working' },
  { value: 'retired', label: 'Retired' },
  { value: 'other', label: 'Something else' },
  { value: PREFER_NOT, label: 'Prefer not to say' },
];
/** Suggestions for the language fields (any language can be typed). */
export const COMMON_LANGUAGES = ['English', 'Arabic', 'Bengali', 'Cantonese', 'French', 'German', 'Gujarati', 'Hindi', 'Indonesian', 'Italian', 'Japanese', 'Korean', 'Mandarin', 'Persian', 'Polish', 'Portuguese', 'Punjabi', 'Romanian', 'Russian', 'Somali', 'Spanish', 'Swahili', 'Tagalog', 'Tamil', 'Turkish', 'Ukrainian', 'Urdu', 'Vietnamese', 'Welsh', 'Yoruba'];

/** ISO 3166-1 alpha-2 codes; names come from the browser (Intl.DisplayNames). */
export const COUNTRY_CODES = 'AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR XK KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW'.split(' ');

/** The youngest age that can take part (the PI, 20 November 2026). */
export const MIN_AGE = 16;

export const STORAGE_KEY = 'mpmb-online:v1';
/** The prototype's key: read once and dropped (its shape does not fit the open-ended design). */
export const OLD_STORAGE_KEY = 'mpmb-newyear:v1';
