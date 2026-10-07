# New Year social media break: prototype and backend plan

A strand of MyPhone/MyBrain that anyone aged 18 or over, anywhere in the
world, can join: a self-run break from the social media apps they choose,
for 7, 14 or 30 days, starting on 1 January or any other day. Each person
gets a generated fun name for a leaderboard, checks in each day, and does a
short memory and attention check before the break, halfway, at the end, and
(optionally) a month later.

**Status: prototype only.** It is not open and must not be promoted. The
page is unlisted (`/new-year/`, `noindex`, linked from nowhere) and says on
every screen that it is a preview. Everything it does stays in the
browser's `localStorage` (`mpmb-newyear:v1`); the app makes no network
requests of its own and its bundle does not include the Firebase code (the
page itself loads the site's usual stylesheet and fonts). If the browser
blocks storage, the join page says progress will not be kept. The backend
below is not built yet: this document is the plan for when the team decides
to open it.

## What is in the prototype

| Path | What |
|---|---|
| `new-year.md` | The Jekyll page at `/new-year/` that mounts the bundle |
| `consent-app/newyear.html`, `src/newyear.tsx` | The third Vite entry (`newyear-app.js`; same stylesheet as the other apps) |
| `src/newyear/NewYearApp.tsx`, `store.tsx`, `reducer.ts`, `persistence.ts`, `routes.ts` | Frame, state, device storage (`mpmb-newyear:v1`), screen addresses (`#/tracker`, `#/brain-check/halfway`…) |
| `src/newyear/views/` | The screens: landing, join, tracker, check-in, brain checks, the two games, results, leaderboard, leave |
| `src/newyear/names.ts` | Fun names from curated word lists only |
| `src/newyear/dates.ts`, `streaks.ts`, `schedule.ts`, `summary.ts` | Local calendar dates, streak rules, when each brain check is due |
| `src/newyear/tasks/digitSpan.ts`, `oddball.ts`, `stats.ts` | Task logic and scoring, including d′ |
| `src/newyear/compare.ts`, `leaderboard.ts` | Results in plain words; leaderboard ranking and the invented example entries |
| `src/newyear/*.test.ts`, `tasks/*.test.ts` | Unit tests (`npm test`) |
| `src/newyear/newyear.css` | Styles, all scoped under `.mpmb-app .mpmb-ny` |

The logic is in pure TypeScript modules with no React or browser
dependencies, so the Cloud Functions can use the same code (see
"Sharing the rules" below).

### The rules, as built

* **Days.** All dates are the participant's own local calendar dates
  (`YYYY-MM-DD`), with arithmetic on the date alone, so streaks are the same
  in every time zone and across clock changes. Day 1 is the start date.
* **Check-ins.** Each check-in is about one day of the break once it is
  over, normally yesterday; a missed day can be filled in up to two days
  back, and each day can be answered once. Questions: did you stay off your
  chosen apps (Yes, completely / I slipped a little / I slipped a lot); if
  you slipped, roughly how many minutes (optional); mood and wanting to use
  the apps, each 1 to 5 with words; an optional note of up to 280
  characters, never shown to anyone else.
* **Streaks.** A day counts as kept only for "Yes, completely". The current
  streak is the run of kept days up to yesterday; days that can still be
  filled in neither count nor break it. A slip ends the current streak but
  the best streak, days kept and check-ins all stay, and the wording after
  a slip is encouraging, never shaming.
* **Brain checks** (`schedule.ts`): before the break (day 0, open from
  joining), halfway (day 4 of 7, 8 of 14, 16 of 30), the last day, and an
  optional follow-up 30 days after the last day. Each stays open until the
  next opens (the end check for a week, the follow-up for two weeks), then
  counts as missed.
* **Memory: forward digit span.** Digits 1 to 9 shown one at a time (800 ms
  on, 200 ms off) after a fixation cross; no digit repeated straight away
  and no runs of three up or down. Typed back on a 3 × 3 keypad or a
  keyboard. Starts at 3, two trials per length, moves up if either is
  right, stops when both are wrong or after 10. Score: the longest length
  with a correct trial; correct trials are kept as well. A 2-digit practice
  first does not count.
* **Attention: visual oddball.** A blue circle (80%) or an orange-yellow
  square with a dark edge (20%) in the middle, 500 ms each, then a fixation
  cross for a jittered 1000 to 1400 ms. 100 trials (about 2 min 50 s; 90
  would make it 2.5 minutes, a one-line change in `ODDBALL_MAIN`), never two
  targets in a row, at least three standards first, target positions drawn
  evenly from every arrangement that keeps those rules. Tap the big button
  or press the space bar for the square only. Every press is kept with its
  time, and each stored trial also says whether it counted as a response,
  its reaction time and its outcome (hit, miss, false alarm, correct
  rejection); the first press at 150 ms or later counts, quicker ones are
  anticipations, flagged separately and not counted as hits or false
  alarms. Scores: hits, misses, false alarms, correct rejections, both
  rates, mean and median reaction time of hits, anticipations, and d′ with
  the log-linear correction (0.5 added to hits and false alarms, 1 to the
  number of targets and standards). A 10-trial practice with feedback after
  each shape comes first and does not count. Leaving the page or pressing
  Escape stops a block; it is restarted, not resumed.
* **Timing** is browser timing: onsets on `requestAnimationFrame`, presses by
  the event's timestamp on the same clock (`performance.now()`), so about
  ±1 frame (17 ms at 60 Hz) plus the screen's own delay. The longest gap
  between frames and the number of long frames are stored with each block,
  with the input used (touch, keyboard or both), to spot struggling devices.
  Fine for comparing one person with themselves on the same device; not
  for comparing people's absolute reaction times.
* **Names.** Adjective + animal + two digits from curated lists (45 × 54 ×
  85 ≈ 206,000 names). No free-text names anywhere. The lists leave out
  words about bodies, weight, looks, intelligence, mental health, religion,
  nationality and colour, and animals used as insults; 14, 18, 28, 69 and 88
  are never used as numbers. The tests check the lists against a list of
  such words.
* **Leaderboard.** Fun name, current streak, check-ins and a badge when the
  latest brain check that has opened is done. Ranked by current streak, then
  check-ins; full ties share a rank. In the prototype the other rows are
  invented, made deterministically from the same lists and labelled
  "Example". Apps, notes, moods and scores are never on it.
* **Preview tools** (prototype only, on the tracker): move the date on a day
  or a week and fill past days with made-up answers, so the team can try the
  halfway and end checks without waiting.

## How it would work when it opens

The page stays on GitHub Pages; the data goes to the existing Firebase
project in London (`europe-west2`), in collections of its own, with the
same patterns as the laboratory study (`firebase/functions/src/lab.ts`):
anonymous sign-in sessions, callable functions that validate everything
again, rate limits in `ratelimits/`, and no direct browser access to
Firestore.

```
Browser (GitHub Pages)                       Firebase (europe-west2)
──────────────────────                       ───────────────────────
signInAnonymously ─────────────────────────▶ Auth (anonymous uid = this device)

joinNewYear(consent, plan, nameChoice) ────▶ checks age statement, consent versions, plan,
                                              that the name is from the lists and free;
                                              creates nyParticipants/{participantId}
                                              (random id), reserves nyNames/{name},
                                              returns participantId + recovery code

submitNewYearCheckIn(day, answers) ────────▶ day must be a break day, over, at most two days
                                              back in the participant's time zone (±1 day
                                              slack for travel), not answered before;
                                              writes nyCheckIns/{participantId}_{day};
                                              recomputes the streak on the server and
                                              updates the participant's leaderboard row

submitNewYearTask(stage, task, trials) ────▶ stage must be open; trial data checked for
                                              shape and range; scores recomputed on the
                                              server from the trials (never trusted from
                                              the browser); writes nyTaskResults/

getNewYearProgress() ──────────────────────▶ the participant's own answers and stage
                                              statuses, for a reload or a second device

restoreNewYear(recoveryCode) ──────────────▶ links this device's uid to an existing
                                              participant (rate-limited hard)

withdrawNewYear() ─────────────────────────▶ deletes or flags, as ethics decide

nyLeaderboardSnapshot (every 10 minutes) ──▶ nyPublic/leaderboard: top entries and totals,
                                              the only document browsers may read
```

### Collections

| Collection | Holds | Read by |
|---|---|---|
| `nyParticipants/{participantId}` | A random id (never the fun name). The uids linked to it, the hash of the recovery code, the fun name, the apps chosen (ids), the "other" app's name, length, start date, the IANA time zone and UTC offset at joining, joined time, consent record id, status (active, finished, withdrawn), counts. No names, emails or contact details. | `researcher`, `coordinator` |
| `nyConsents/{id}` | The online consent: form and information versions, each statement with its version, response and time, the age statement, client info, `version` and `supersedes`. No name or signature (an anonymous online study would not take them; ethics to confirm). | `coordinator`, `auditor` |
| `nyCheckIns/{participantId}_{day}` | One per break day: the answers, the day it is about, when it was saved (server time and the participant's local date). The id makes "once per day" a property of the database. | `researcher`, `coordinator` |
| `nyTaskResults/{id}` | One per game per stage: participant, stage, task and task version, seed, settings, every trial (digit span: sequence, response, time to answer; oddball: type, interval, onset, every press), the server's scores, frame timing, input type, screen size and user agent. | `researcher`, `coordinator` |
| `nyNames/{name}` | The name's reservation (participant id, time), so no two people share a name. | functions only |
| `nyLeaderboard/{participantId}` | The participant's public row: fun name, current streak, check-ins, badge, updated time. Kept separately so the public snapshot can be built without touching research data. | functions only |
| `nyPublic/leaderboard` | The snapshot browsers read: the top 100 rows and how many people are taking part. Nothing else. | everyone (the one public rule) |

Research data and anything public are kept apart: the public document is
built from `nyLeaderboard`, which only ever holds the four public fields,
and the fun name does not go into the research export (rows are labelled
by participant id, as `sub-<id>`).

### Sharing the rules

The server must apply exactly the client's rules (streaks, check-in window,
stage windows, name lists, scoring). The functions already copy the app's
form definitions at build time (`firebase/functions/scripts/generate-forms.mjs`);
the same script can copy `dates.ts`, `streaks.ts`, `schedule.ts`,
`names.ts` and `tasks/*.ts`, which are pure TypeScript for that reason, and
the functions' tests can run the app's test cases too.

### Validation and rate limits

* Everything is checked again on the server: types, ranges (mood and
  wanting 1 to 5, minutes 0 to 1440, note at most 280 characters with
  control characters removed, the "other" app at most 30), known app ids,
  lengths 7, 14 or 30, a start date from today to a year ahead.
* Names: only a name the lists can make (`isFunName`), not already taken;
  the server can generate the name itself and the Shuffle button ask for
  another (rate-limited), so no client can choose an arbitrary string.
* Check-ins: one per day per participant (the document id), only for days
  of the break that are over, at most two days back in the participant's
  time zone. The streak is recomputed on the server from the stored
  check-ins, so it can never exceed the days so far.
* Task results: at most one completed result per stage per task (later
  attempts kept but flagged), trial arrays of the expected length, onsets
  and reaction times in plausible ranges, scores recomputed.
* Rate limits per session, as in `lab.ts`: joining 3 an hour, name shuffles
  30 an hour, check-ins 10 an hour, task results 10 an hour, progress
  lookups 30 an hour, recovery attempts 5 an hour (and a lock-out after
  repeated failures).
* App Check (reCAPTCHA v3) enforced on these functions from the start: an
  open, worldwide strand will attract scripts.

## The leaderboard is self-report

Nobody can verify that someone stayed off TikTok, so the leaderboard can
only ever be encouragement. To keep it that way:

* No prizes, rewards or rankings with consequences; the wording says
  "encouragement, not a contest".
* The server computes streaks from dated check-ins it accepted within the
  two-day window, so a 30-day streak takes 30 days, and back-filling is
  impossible.
* One participant per device session, App Check and rate limits make mass
  sign-ups expensive; the public snapshot shows the top 100 and the
  participant's own rank, not an endless list.
* Fun names are generated, so there is nothing offensive to moderate; a
  short blocklist of whole combinations can be added if an unfortunate one
  turns up.
* Honest answers are encouraged in the wording; slips are expected, never
  punished beyond the current streak.
* Consider letting people stay off the leaderboard (an option at joining,
  which the prototype does not have).

## Ethics and consent before opening

* **A new ethics application, or an amendment** to the existing approval:
  this is a new population (adults anywhere, not Bradford and Leeds
  schools), recruited openly online, with self-report and cognitive tasks.
  The information sheet and consent statements need writing and approval;
  everything marked "Draft wording" in the prototype is placeholder.
* **Age.** 18 or over is self-declared (a required tick box). Ethics to
  confirm this is acceptable for an online study with no payment.
* **International participants.** The University of Leeds would be the
  controller under UK GDPR. People in the EU are likely covered by the EU
  GDPR too (monitoring behaviour of people in the EU), which raises whether
  an EU representative is needed. Some countries have their own rules
  (China's PIPL, Brazil's LGPD and others). The Data Protection Officer
  should advise whether to open worldwide or to a list of countries.
* **Special category data.** Mood and urges to use apps are arguably health
  data, so a DPIA is needed and the lawful basis (public task plus the
  research condition) set out.
* **Where data lives.** London (`europe-west2`), as for the other studies.
  Firebase Authentication stores anonymous uids globally (see
  `firebase.md`).
* **Wellbeing and safeguarding.** Signposting for people who find the break
  hard or whose mood drops, with international (not only UK) resources; a
  plain statement that the brain checks are not a medical test; what
  happens if a note mentions self-harm (notes are not monitored in real
  time, and the information sheet must say so).
* **Withdrawal.** How long after the break someone can ask for their data
  to be removed, and how they prove which participant they are (the
  recovery code).
* **Language.** English only at first; translations would need approval.

## Retention

A proposal for the team and the DPO to agree:

* Research data (`nyCheckIns`, `nyTaskResults`, de-identified participant
  rows): kept under the University's research data policy for the agreed
  period after publication.
* Leaderboard rows, name reservations and the public snapshot: deleted when
  the strand closes (for example three months after the last follow-up).
* Uids, recovery-code hashes and rate-limit records: deleted when the strand
  closes, with Firestore TTL policies doing it automatically.
* Notes: reviewed before any researcher reads them, as for the family
  study's free text, and kept only if ethics allow.

## Accessibility

* The prototype aims at WCAG 2.2 AA: everything works by keyboard, visible
  focus, labels and error summaries, polite live announcements for saving
  and for progress through the games, targets at least 44 px, no sideways
  scrolling at 390 px, status shown with shapes and words as well as colour,
  and `prefers-reduced-motion` respected (the games never animate; a shape
  is simply on or off).
* The games are visual and timed, so they are not accessible to blind
  participants and harder for some others. People should be able to join
  and check in without doing them, with "I can't do this game" recorded. An
  audio digit span is a separate, validated task, not a tweak.
* The attention game's button responds to touch on press (not on release),
  to the space bar, and to Enter or a screen reader's activation; keyboard
  capture is attached only while a block runs.

## Data quality

* Each comparison is within one person; encourage the same device for every
  check, and record device, input type, screen size and frame timing.
* Practice effects: a second attempt at both tasks is usually a little
  better whatever happens, so the results page says so. A comparison group
  (for example people who join but start later) would let the study separate
  the break from practice.
* Flags to compute in the export: anticipations, tapping for everything,
  long frame gaps, games stopped and restarted, very quick or very slow
  answers.
* The export can follow the existing BIDS layout: a `new-year/` folder with
  `participants.tsv`, `phenotype/checkins.tsv`, and per session
  (`ses-baseline`, `ses-halfway`, `ses-end`, `ses-followup`) the trial
  tables `task-digitspan_beh.tsv` and `task-oddball_beh.tsv` with
  dictionaries.

## What the prototype leaves out

* Any server: no accounts, no sync between devices, no real leaderboard (the
  other rows are invented), no withdrawal of sent data.
* Consent and an information sheet (only "What is kept", marked as draft).
* A recovery code or any way to carry on from another device.
* Reminders. A privacy-friendly option is a calendar file (`.ics`) with the
  daily check-in and the brain check dates, which needs no contact details;
  emails or push notifications would need more data and more approval.
* Changing an answer once saved, or the plan once started.
* Staying off the leaderboard, country of residence, demographics, other
  questionnaires.
* Translations, and an accessible alternative to the visual games.
* The preview tools would be removed.

## Open decisions for the team

1. Ethics route: a new application or an amendment, and who leads it.
2. Worldwide, or a list of countries (DPO advice on the EU GDPR, PIPL and
   others)?
3. What to ask at joining beyond age 18+: country, age band, gender, usual
   daily social media time? Each adds value and data-protection weight.
4. Break lengths: keep 7, 14 and 30 days, or one fixed length for cleaner
   analysis?
5. Halfway and end timing, and whether the one-month follow-up is optional.
6. Oddball length: 100 trials (about 2 min 50 s) or 90 (about 2.5 minutes)?
7. A comparison group, to separate the break from practice effects?
8. Leaderboard: on by default, opt-in, or opt-out? Top 100 or bands?
9. Notes: collect them at all? Who reads them, and what if one raises a
   concern?
10. Carrying on across devices: recovery code (recommended), email sign-in,
    or one device only?
11. Reminders: none, a calendar file, or emails?
12. Retention periods for each kind of data.
13. Whether participants can download their own data (a simple JSON or PDF
    of their check-ins and scores).
14. Timing of opening: the strand needs approval, testing and translations
    (if any) well before 1 January.

## Cost

At, say, 10,000 participants doing 30 check-ins and four brain checks each,
there are about half a million small Firestore writes over the strand, a
similar number of function calls, and one leaderboard snapshot every ten
minutes: a few pounds a month, within the same budget alert as the other
studies.
