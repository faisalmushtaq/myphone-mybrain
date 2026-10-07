/**
 * Step-by-step instructions for finding screen-time information.
 *
 * Each platform has a list of steps; each step has a short instruction, an
 * optional note, and a simple illustration id rendered by
 * components/PhoneIllustration.tsx. Device-specific variants (for example
 * Samsung One UI) can be added as extra entries in `walkthroughs`.
 */
export type PlatformId = 'ios' | 'android' | 'other';

export interface WalkthroughStep {
  title: string;
  detail: string;
  note?: string;
  illustration: 'settings' | 'screen-time-row' | 'see-all-activity' | 'week-view' | 'screenshot' | 'wellbeing-row' | 'dashboard' | 'scroll';
}

export interface Walkthrough {
  id: PlatformId;
  name: string;
  screenName: string;
  intro: string;
  steps: WalkthroughStep[];
  screenshotHint: string;
  /** Extra note where the platform's summary shows more than apps. */
  websitesNote?: string;
}

export const platforms: { id: PlatformId; name: string; description: string }[] = [
  { id: 'ios', name: 'iPhone', description: 'Made by Apple. The settings app has a grey gear icon.' },
  { id: 'android', name: 'Android', description: 'Samsung, Google Pixel, Motorola, Xiaomi, OnePlus and most others.' },
  { id: 'other', name: 'Something else, or not sure', description: 'We will show general guidance.' },
];

export const walkthroughs: Record<PlatformId, Walkthrough> = {
  ios: {
    id: 'ios',
    name: 'iPhone',
    screenName: 'Screen Time',
    intro: 'iPhones keep a summary of app use in Settings under “Screen Time”. It takes about a minute to find.',
    steps: [
      { title: 'Open Settings', detail: 'Tap the grey gear icon on the home screen.', illustration: 'settings' },
      { title: 'Tap “Screen Time”', detail: 'Scroll down a little. It has a purple hourglass icon.', illustration: 'screen-time-row' },
      {
        title: 'Tap “See All App & Website Activity”',
        detail: 'It is just under the bar chart at the top.',
        note: 'On older iPhones this may say “See All Activity”. If it says “Turn On App & Website Activity”, your phone has not been keeping a summary, so there is nothing to share yet: skip this part.',
        illustration: 'see-all-activity',
      },
      { title: 'Choose “Week”', detail: 'Tap “Week” at the top so the summary shows the last 7 days.', illustration: 'week-view' },
      {
        title: 'Take a screenshot',
        detail: 'With the list of apps on the screen, press the side button and the volume-up button at the same time, then let go.',
        note: 'On an iPhone with a home button, press the home button and the side button together.',
        illustration: 'screenshot',
      },
      {
        title: 'Scroll down and take one more',
        detail: 'If the list of apps carries on below the screen, scroll down and take another screenshot so we can see every app.',
        illustration: 'scroll',
      },
    ],
    screenshotHint: 'The screenshots we need show the bar chart for the week and, most importantly, the list of apps with the time next to each one. The apps matter as much as the total.',
    websitesNote: 'On an iPhone the list also shows websites visited in Safari. We only need the apps: hide any row, app or website, that you would rather not show. Nobody will ask why.',
  },
  android: {
    id: 'android',
    name: 'Android',
    screenName: 'Digital Wellbeing',
    intro: 'Most Android phones keep a summary of app use in Settings under “Digital Wellbeing”. The exact names vary a little between makes of phone.',
    steps: [
      { title: 'Open Settings', detail: 'Tap the gear icon, or swipe down from the top of the screen and tap the gear.', illustration: 'settings' },
      {
        title: 'Tap “Digital Wellbeing & parental controls”',
        detail: 'Scroll down to find it. You can also type “wellbeing” in the search box at the top of Settings.',
        note: 'On some phones this is called “Digital Wellbeing”, “Screen time” or “Digital balance”.',
        illustration: 'wellbeing-row',
      },
      {
        title: 'Open the dashboard',
        detail: 'Tap the chart, or tap “Dashboard”, to see the list of apps and how long each was used.',
        note: 'On Samsung phones, tap the “Screen time” number.',
        illustration: 'dashboard',
      },
      { title: 'Choose the weekly view', detail: 'If there is a choice between “Day” and “Week”, choose “Week”.', note: 'If your phone only shows one day, that is fine.', illustration: 'week-view' },
      {
        title: 'Take a screenshot',
        detail: 'With the list of apps on the screen, press the power (side) button and the volume-down button together — a quick press, don’t hold.',
        note: 'On some phones you can also swipe down with three fingers.',
        illustration: 'screenshot',
      },
      {
        title: 'Scroll down and take one more',
        detail: 'If the list of apps carries on below the screen, scroll down and take another screenshot so we can see every app.',
        illustration: 'scroll',
      },
    ],
    screenshotHint: 'The screenshots we need show the total time and, most importantly, the list of apps with the time next to each one. The apps matter as much as the total.',
  },
  other: {
    id: 'other',
    name: 'Other phones',
    screenName: 'screen time',
    intro: 'Most phones have a screen-time or wellbeing summary somewhere in Settings. If you cannot find it, that is okay — you can skip this part.',
    steps: [
      { title: 'Open Settings', detail: 'Look for the gear icon.', illustration: 'settings' },
      { title: 'Search for “screen time” or “wellbeing”', detail: 'Use the search box at the top of Settings if there is one.', illustration: 'wellbeing-row' },
      { title: 'Open the summary of app use', detail: 'You are looking for a list of apps with the time spent on each.', illustration: 'dashboard' },
      { title: 'Take a screenshot', detail: 'Usually the power button and a volume button pressed together.', illustration: 'screenshot' },
    ],
    screenshotHint: 'Any screen that shows a list of apps with the time used on each one is what we are looking for.',
  },
};

/**
 * For a parent or carer sending an under-16's screen time from their own
 * phone (decided 7 October 2026): where it is in Apple Family Sharing (the
 * young person has an iPhone) or Google Family Link (an Android phone). The
 * chip chosen is the young person's phone.
 */
export const familyWalkthroughs: Record<'ios' | 'android', Walkthrough> = {
  ios: {
    id: 'ios',
    name: 'Apple Family Sharing',
    screenName: 'Screen Time',
    intro: 'If your child’s iPhone is in your Family Sharing group, your own iPhone shows their screen time in Settings.',
    steps: [
      { title: 'Open Settings on your iPhone', detail: 'Tap the grey gear icon.', illustration: 'settings' },
      { title: 'Tap “Screen Time”', detail: 'It has a purple hourglass icon.', illustration: 'screen-time-row' },
      {
        title: 'Tap your child’s name',
        detail: 'It is listed under “Family”, further down the page.',
        note: 'No “Family” list? Then Screen Time is not shared with you: go back and choose another way, or skip this part.',
        illustration: 'screen-time-row',
      },
      { title: 'Tap “See All App & Website Activity”, then “Week”', detail: 'So the summary shows the last 7 days.', illustration: 'week-view' },
      { title: 'Take a screenshot', detail: 'With the list of apps on the screen, press the side button and the volume-up button at the same time.', note: 'On an iPhone with a home button, press the home button and the side button together.', illustration: 'screenshot' },
      { title: 'Scroll down and take one more', detail: 'If the list of apps carries on below the screen, take another so we can see every app.', illustration: 'scroll' },
    ],
    screenshotHint: 'The screenshots we need show your child’s list of apps with the time next to each one, for the week.',
    websitesNote: 'The list may also show websites. We only need the apps: hide any row you would rather not show.',
  },
  android: {
    id: 'android',
    name: 'Google Family Link',
    screenName: 'Family Link',
    intro: 'If you manage your child’s Android phone with Google Family Link, the Family Link app on your phone (Android or iPhone) shows their screen time.',
    steps: [
      { title: 'Open the Family Link app on your phone', detail: 'Its icon is a green, yellow and blue shape.', illustration: 'settings' },
      { title: 'Choose your child', detail: 'Tap their name or picture at the top.', illustration: 'wellbeing-row' },
      { title: 'Open their screen time', detail: 'Tap “Screen time”, or “App activity”, to see the list of apps and the time on each.', note: 'The names vary a little between versions of the app.', illustration: 'dashboard' },
      { title: 'Choose the last 7 days', detail: 'If there is a choice of days, choose the week.', note: 'If it only shows one day, that is fine.', illustration: 'week-view' },
      { title: 'Take a screenshot', detail: 'On an Android phone, press the power and volume-down buttons together. On an iPhone, the side and volume-up buttons.', illustration: 'screenshot' },
      { title: 'Scroll down and take one more', detail: 'If the list of apps carries on below the screen, take another so we can see every app.', illustration: 'scroll' },
    ],
    screenshotHint: 'The screenshots we need show your child’s list of apps with the time next to each one.',
  },
};

