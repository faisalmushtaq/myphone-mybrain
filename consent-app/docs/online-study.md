# Online study: design (draft of 20 November 2026)

The online strand of MyPhone/MyBrain, built from the New Year break
prototype (`docs/new-year-break.md`, `src/newyear/`). Adults aged 18 or
over, anywhere, take a break from the social media apps they choose for as
long as they like, and come back whenever they want. **Not open:** it needs
ethics approval first, and the home page shows it as "Opening soon".

## Key message (the PI, 20 November 2026)

> Contribute to this global study of phone abstinence. Want to stop the
> habit? Join us and help us better understand the impact of phone use on
> our brain health.

"Any age" in the PI's first wording became **16 and over** (decided the
same day): 16 and 17 year olds consent for themselves, and under-16s are
pointed to the school study.

Decided by the PI on 20 November 2026:
* **Who:** aged 16 and over, anywhere. 16 and 17 year olds consent for
  themselves; ethics to agree, with safeguarding and signposting suited to
  them (see "Still to decide").
* **Two ways to take part, chosen at joining:** *pause chosen apps* (the
  social media apps they pick; calls, messages and maps carry on), or *cut
  total phone time* to a daily goal they set. Screenshots prove either: the
  chosen apps at (almost) zero, or the daily total under the goal.

* **Open-ended.** No fixed length. People start when they like and end when
  they decide to (or stop answering).
* **Start and end visits** use the same full set: the lab study's
  questionnaires, the short Warwick-Edinburgh Mental Wellbeing Scale
  (SWEMWBS, 7 items), the brain check (memory and attention games) and a
  screen-time screenshot.
* **Return visits, any time in between:** a brain check and a screen-time
  screenshot. The screenshot is the evidence that validates the visit's
  scores; people see where their brain scores lie only after a return
  visit.
* **Check-ins, any time, even after a lapse:** a light mood and urge check
  (each 1 to 5) and whether they are still off their apps. A lapse never
  locks anyone out; they can carry on, restart, or end.
* **Reminders:** notifications asking "still going strong?" (push to the
  phone, email as a fallback), at a frequency the person chooses.
* **Reminder consent at sign-up:** two optional statements, "I agree to
  be sent reminder emails" and "I agree to be sent reminder text messages"
  (which asks for a mobile number), recorded with the consent and changeable
  any time in settings and from every message. Contact details are kept
  apart from the research data. Texts use the lab study's sender (`sms.ts`).
* **Accounts:** email address and password, made by the server with the
  same anti-spam checks as the staff portal, so people can carry on from
  any device.
* **Leaderboard** of generated fun names, as in the prototype.
* **Saved as an app on the phone.** Straight after joining, people are
  asked to sign in on their phone and save the study to their Home Screen,
  then turn on notifications. On an iPhone, web notifications only work
  from a Home Screen app, so without this they get no reminders (only
  emails).

## What is recorded about the person and their device (the PI, 20 November 2026)

**Device and place, at every sign-in and visit** (`olSessions`): device type
(phone, tablet, computer), operating system and version, browser, screen
size, saved app or browser, time zone, and the country (and region where
known) worked out from the connection at that moment. The IP address itself
is not stored: it is personal data and the country is what the analysis
needs.

**Demographics at joining**, each with "Prefer not to say":

| Item | How it is asked |
|---|---|
| Age | Month and year of birth (checks 16 or over; exact age at each visit) |
| Sex | Sex registered at birth: female, male, intersex, prefer not to say |
| Gender | Woman, man, non-binary, prefer to self-describe (text), prefer not to say |
| Ethnicity | UK census groups plus self-describe (country of birth carries the international picture) |
| Country of birth | Full country list |
| Country of residence | Full country list |
| Highest education | ISCED levels in plain words (for example "Secondary school", "Bachelor's degree") |
| Languages | First language, and other languages spoken well |
| Profession | Student, employed, self-employed, not working, retired; then the job in their own words |

Ethnicity is special category data (lawful basis and DPIA). Demographics
with country can identify people in small groups, so the export bands or
merges rare combinations before anyone outside the core team sees them.

## A participant's journey

```
Join ─▶ Start visit ─▶ Break (as long as they like) ─────────────────────▶ End visit ─▶ Follow-up (optional)
        consent          ├─ check-ins any time (mood, urge, still off?)    full scales     1 and 3 months
        account          ├─ return visits any time (brain check +          brain check     after the end
        full scales      │    screenshot = validated scores)               screenshot
        brain check      ├─ reminders ("still going strong?")
        screenshot       └─ lapse? record it, carry on or restart
```

### Join and start visit
1. Information sheet (section by section) and consent, versioned like the
   lab study's (`labConsentForm`), with the age statement (16 or over).
2. Create an account (email and password; the server makes it; the address
   is verified).
3. **Save it as an app and turn on notifications** (a step of its own,
   not skippable without a clear "I'll do this later"): steps for the
   device in hand (iPhone or iPad in Safari: Share, Add to Home Screen;
   Android in Chrome: Install app; a computer: sign in on your phone
   instead, with a QR code to open the study there), then "Turn on
   reminders", which asks for notification permission and sends a test.
   Until it is done, the tracker shows a reminder card, and the reminder
   settings say "Email only: save the app to get notifications". The same
   pattern as the staff portal's "Save the portal to your Home Screen"
   (`src/portal/push.ts`, `HomeScreenHelp`), with its own manifest and
   service worker scoped to the online study.
4. Choose the apps to pause and a start date (today or later); get a fun
   name; choose leaderboard on or off, and reminder frequency.
5. Full scales, brain check, screen-time screenshot (the week before the
   break: the baseline).

### During the break
* **Check-in** (any time, as often as they like, at most one counted per
  day for streaks): still off your apps? (yes / slipped a little / slipped
  a lot / I've stopped the break), mood 1 to 5, urge 1 to 5, optional note.
  After a lapse: "carry on" (the streak restarts, everything else is kept)
  or "end my break" (goes to the end visit).
* **Return visit** (any time, suggested every 7 days): brain check and a
  screen-time screenshot. The results page compares this visit with the
  start and with others (within-person, with the practice-effect caveat),
  and marks the scores **validated** once a screenshot came with them.
* **Reminders** at the chosen frequency (daily, every few days, weekly or
  never), stopping when they end or withdraw.

### End and follow-up
* End visit: full scales, brain check, screenshot, and a short "how did it
  go" (why they ended, would they do it again).
* Optional follow-ups 1 and 3 months after the end: the same full set.

## Screenshots and validation
* **Every day must be covered.** A day counts as a verified day off only if
  a screenshot covers it. Phones keep limited history (iPhone Screen Time
  roughly the last few weeks; Android Digital Wellbeing about 10 days on
  most phones; both to be tested), so people send **a screen-time
  screenshot at least once a week**. The weekly reminder asks for it; the
  brain check is offered with it but is optional each week. Gaps stay
  self-report only, and the tracker shows which days are verified and which
  still need a screenshot (while the phone still holds them).
* People stay signed in once the study is saved as an app, so coming back
  is opening the app, not typing a password.
* Re-use the school study's screen-time screenshot reader (on-device OCR
  and the server's Vision check, `images.ts`), which already handles
  iPhone Screen Time and Android Digital Wellbeing.
* From each screenshot: the period it covers and the minutes on each of
  the chosen apps. A visit is **validated** when a readable screenshot
  covering the days before it came with it. Unreadable ones go to the team
  to check by hand.
* Days covered by a validated screenshot with (almost) no time on the
  chosen apps count as **verified days off**.

## Leaderboard
* Fun names only (generated, never typed), opt-out at joining and any time.
* Ranked by verified days off, then current streak (self-reported); a tick
  for people whose latest visit is validated.
* Never shows apps, notes, moods, scores or screenshots.

## Data (Firebase, London, `europe-west2`)
`olParticipants`, `olConsents`, `olCheckIns`, `olVisits` (one per start,
return, end, follow-up: scales, task trials and server-computed scores,
screenshot ids, validation), `olScreenshots` (Storage + readings),
`olLeaderboard` (four public fields), `olPublic/leaderboard` (snapshot),
`olNotify` (push subscriptions, reminder settings). Accounts are Firebase
Auth users with an `online` marker, kept apart from staff accounts.
Exported hourly like the other studies, BIDS-style, by participant id.

## Still to decide
1. **The lab study's questionnaires** (they run in MySelf): the list of
   scales and items to repeat online, and whether MySelf can be used
   directly (a link with the participant id) or the items are built in here.
2. **SWEMWBS licence:** free for non-commercial research, but it must be
   registered with Warwick.
3. **"Validated":** is a screenshot with a visit enough, or must it also
   show the chosen apps at (nearly) zero for the visit to count?
4. **Reminder emails:** fine for ethics as long as the address is kept
   apart from the research data (as for the portal)?
5. Worldwide, or a list of countries (DPO advice), and the ethics route
   (new application or amendment).
6. Safeguarding for the notes and mood: 16 and 17 year olds as well as
   adults, with international signposting, and what happens if a note
   raises a concern about someone under 18.

## Build plan
1. **Now (preview, nothing sent):** rebuild the prototype around this
   design: open-ended break, any-time check-ins including after a lapse,
   return visits with a screenshot step, start/end scales (SWEMWBS built in;
   lab scales once listed), the "save as an app" step with its manifest and
   service worker, reminders setting, and a test pass on phones.
2. **Backend (staging only):** accounts, consent, the collections above,
   screenshot upload and reading, server-side scoring and streaks,
   leaderboard snapshot, push and email reminders, export.
3. **Ethics pack:** information sheet, consent form, DPIA notes, drafted
   from this design for the committee.
4. **Open** when approved: switch the home page box on.

## Build status (20 November 2026)

**Stage 1 is built: the preview, rebuilt around this design** (`src/newyear/`,
still at `/new-year/`, still keeping everything on the device and sending
nothing).

| Part | Where |
|---|---|
| Joining in seven steps: age (month and year of birth, 16 or over), draft consent with optional email and text reminders, about you (the demographics above), the break (pause chosen apps, or a daily limit for total phone time; any start day), fun name, leaderboard on or off, reminder frequency and mobile number, the account (a placeholder in the preview), and saving it to the phone | `views/Join.tsx` |
| Saving as an app and turning on reminders (one-tap install where the browser offers it; steps for iPhone, Android and computers; a test notification) | `views/SaveApp.tsx`, `install.ts`, `/new-year/manifest.webmanifest`, `/new-year/sw.js` |
| Check-ins any time, about the time since the last one: still going strong, slipped (and on which day), or stopped for now; mood and urge 1 to 5; a note | `views/CheckIn.tsx` |
| Visits: start and end (SWEMWBS, the brain check, a screenshot; the end adds "why now" and "again?"), return visits (a screenshot, then the brain check if they like), follow-ups 1 and 3 months after the end. Each saves as it goes and can be finished later | `views/Visit.tsx`, `views/Visits.tsx` |
| Results compared with the start and the visit before, marked validated when a screenshot came with them, with the practice-effect caveat beside the comparison | `views/Results.tsx` |
| The days: kept (said), proven or over (screenshot), slipped, paused, not reported; streaks; proven days; a screenshot due once a week of the break isn't covered | `progress.ts` (tested in `progress.test.ts`) |
| Leaderboard by proven days, then streak; opt-out | `leaderboard.ts`, `views/Leaderboard.tsx` |
| Settings: reminders, email, texts, leaderboard, saving the app | `views/Settings.tsx` |
| Device at every opening and visit (type, system, browser, screen, saved app or not, time zone) | `device.ts` |

**The rules as built:**
* A check-in after any gap is accepted; nobody is locked out. "Still going
  strong" counts the days since the last check-in as kept. After "slipped",
  the slip day is a slip, the days after it kept, and the days before it
  not reported (there may have been other slips). "Stopped for now" pauses
  those days.
* A screenshot outranks what was said for the days it covers: proven when
  the chosen apps show 5 minutes a day or less (or total time is under the
  limit), over otherwise. One screenshot covers up to 28 days.
* A new screenshot is asked for once 7 days of the break are uncovered.
* Scores are validated when the visit has a screenshot.

**Fixed from the test of the old prototype:** the attention game's shapes
were hidden under the site's header on phones (the game now scrolls itself
into view); two open tabs overwrote each other's answers (each save now has
a revision; a tab takes another tab's newer save and never writes it back);
the results said "At halfway" on the wrong check; the tracker praised a
lapsed participant; impossible example leaderboard rows; focus lost in the
memory game and no way to stop it; "too quick" taps in the practice got the
wrong message; "1 time fewer".

**Next:** stage 2 (the backend on a test setup), once the team has listed the
lab study's questionnaires and agreed what "validated" requires.

## Changes of 21 November 2026 (the PI)

**The attention game is now the SART.** The visual oddball was too easy
(near-perfect scores leave no room to see change) and was not a validated
behavioural task; its screen also carried counters, a progress bar and a
button. It is replaced by the Sustained Attention to Response Task as
published (Robertson, Manly, Andrade, Baddeley and Yiend, 1997,
Neuropsychologia 35, 747–758): 225 digits (1 to 9, each 25 times, random
order), each shown for 250 ms at one of five sizes (48, 72, 94, 100 or 120
points) then a ring-and-cross mask for 900 ms; tap (or the space bar) for
every digit except 3; an 18-digit practice first, without feedback. Scores:
commission errors (taps for 3, of 25; the main score), omission errors (of
200), median, mean and standard deviation of correct reaction times,
coefficient of variation, anticipations (under 100 ms, not counted), and the
mean reaction time of the four digits before each commission and each
withheld 3. During a block the screen is black with only the digit or mask
(and a small × to stop); it is drawn on the page itself, above the site.
`tasks/sart.ts` (tested), `views/SartGame.tsx`. The memory game's digits are
also shown full screen now, without round or length counters.

**Donations use the lab study's own instructions and mechanisms.** The
screen-time step is the lab's: "Which phone do you have?", the illustrated
iPhone and Android steps, several screenshots (camera and location details
removed on the device). The start and end visits also ask for the TikTok,
YouTube and Instagram data downloads with the lab's illustrated guides,
read and cleaned on the device by the lab's cleaner with the same choices of
what to share; each app is added or set aside ("I don't use it"), and the
visit can be finished later while a download arrives. The screenshots are
the validation of days off and of brain-check scores. `views/Donation.tsx`
(reusing `lab/guideSteps.tsx`, `lab/cleaner.ts`, `lab/download.ts`,
`components/ImageCapture.tsx`). In the preview nothing is sent.

**AI abstinence, and any mix.** People choose any number of social media
apps, any number of AI tools (ChatGPT, Claude, Gemini, Microsoft Copilot,
Meta AI, Grok, Perplexity, DeepSeek, Character.AI, other), and/or a daily
limit for all phone use. A screenshot proves a day only when every part is
met: the chosen apps and AI tools at 5 minutes a day or less (browser use of
AI tools included) and total time under any limit. `targets.ts`.

Still open: AI tools have no data download step yet (their exports, such as
ChatGPT's, hold whole conversations, which needs its own cleaner and ethics
review); the lab study's questionnaires are still to be listed.

## Questionnaires and Remi (21 November 2026, the PI)

**The break study's questionnaires.** The start visit asks the social media
break lab study's published MySelf survey (pre-break, `social_media_break_lab_study`
8.0.0); the end visit and the follow-ups ask its post-break survey
(`post_break_lab_study` 3.0.0). They are exported, not retyped, from MySelf's
survey archive (the `survey-archive` branch of faisalmushtaq/MySelf) by
`scripts/export-myself-items.mjs` into `src/newyear/survey/breakStudyItems.json`:
the same wording, answer options, order and display conditions. Left out
because the online study asks its own or they belong to the lab: the consent
screen, names, address and UK demographics, the EEG practicality, and the
post-break survey's questions about the lab's 30-day break. What is in: hand
preference (EHI-SF), the adult MacArthur ladders, sleep (SQS, KSS), SWEMWBS,
STAI-5, PHQ-4, smartphone and AI use, social media use, time on each app,
screen control and attitudes, patterns and attention, phone pickups,
doomscrolling, and BIS/BAS. One question at a time, as in MySelf, saving as
it goes (`views/Survey.tsx`, `survey/engine.ts`, tested). Adaptations: the
app sorter is a tap list (the order tapped stands for MySelf's ranking), and
"age you got your first smartphone" offers ages up to the person's age now,
from their month of birth.

For the team: the MacArthur ladder's wording says "in the UK", which does not
fit people elsewhere; it is kept word for word until the team decides. Six of
the questionnaires are used with permission (EHI-SF, KSS, SWEMWBS, STAI-5,
doomscrolling items, BIS/BAS): check each permission covers an open,
worldwide online study.

**Motivation (study-written, draft 0.1).** First in the start visit: why they
want to take a break (choose all) and the main reason, importance and
confidence 0 to 10 (motivational interviewing's readiness rulers), readiness,
what might make it hard, and what they hope will change. At the end and the
follow-ups: how it went, whether they got what they hoped for, what was hard,
what helped, what next, and importance now. `survey/motivation.ts`.

**Remi.** A step at the start visit ("before"), once at a return visit two
weeks or more in ("midway", optional), and at the end visit ("after"), as the
lab study's MyStory. Its protocols are `src/newyear/mystory/online-pre.toml`,
`online-mid.toml` and `online-post.toml`: word-for-word copies of the break
study's, marked as drafts for Michelle to adapt (open-ended, worldwide, from
16, and breaks from AI tools or total phone time as well as social media).
Remi says only what those files say. In the preview the step explains where
the chat goes; it runs once the server stage is built and Michelle has
approved the files.

**The Short Grit Scale (21 November 2026, the PI).** The 8-item Grit-S
(Duckworth and Quinn, 2009; free for non-commercial research) comes after the
motivation questions at the start, the end and both follow-ups, so change can
be compared. Answers are coded as published (Very much like me = 5 to Not
like me at all = 1); items 1, 3, 5 and 6 are reversed in scoring; the score is
the mean of the eight (1 to 5), with consistency-of-interest and
perseverance-of-effort subscales. The results page shows it next to wellbeing.
`survey/grit.ts` (tested). The wording is the published 2009 version; check it
against the paper before ethics submission.
