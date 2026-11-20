# Online study: design (draft of 20 November 2026)

The online strand of MyPhone/MyBrain, built from the New Year break
prototype (`docs/new-year-break.md`, `src/newyear/`). Adults aged 18 or
over, anywhere, take a break from the social media apps they choose for as
long as they like, and come back whenever they want. **Not open:** it needs
ethics approval first, and the home page shows it as "Opening soon".

Decided by the PI on 20 November 2026:

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
   lab study's (`labConsentForm`), with the age statement (18+).
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
6. Safeguarding for the notes and mood (adults, international signposting).

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
