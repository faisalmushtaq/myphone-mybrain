# Decisions

Decisions the study lead made on the questions this code raised, and where
each is implemented. Newest first.

## 7 October 2026

**Ethics:** no piecemeal approvals while the changes are being made. Once
they are all in, the ethics forms get **one master update**;
`content-placeholders.md` is the list of what it needs to cover.

### The young people's study (schools)

| Decision | Where |
| --- | --- |
| The EEG workshop is **opt-out**. Linking with health and education records (Connected West Yorkshire) is part of the **same** opt-out: without the EEG there is no point linking, so one opt-out covers both. | Site copy (home, families, young people, FAQ, privacy, school pages); `src/config/statements.ts` (no "take-part" or "link-records" for parents) |
| Opting out is **by email** to brainpop@leeds.ac.uk, by **parents and carers only**. No form and no paper slips anywhere. Before the address is shown, the site warns **twice** that the young person will then not take part in the workshop (deliberate friction). | `src/steps/OptOut.tsx` (from the form's first page, or `?optout=1` from the school pages and the FAQ), with a ready-made email |
| An opt-out that arrives **after** the workshop withdraws the data too, as far as is still possible. | Opt-out wording; the staff page's Opt-outs tab ("it came after the workshop") |
| A family that opts out gives **no data at all**: the phone form is not for them. | Opt-out wording |
| The team **records each opt-out email on the staff page**; the export lists them and flags them in the UPN matches. | Staff page → Opt-outs (`optOuts/`); export: `schools/identifying/opt_outs.tsv`, `opted_out` in `participants_key.tsv`, `participants.tsv` and the UPN tables |
| The phone data (screen-time screenshots) is **opt-in**. **16- and 17-year-olds** can agree for themselves. For **under-16s** a parent or carer gives permission. | `study.selfConsentAge` (16); `src/model/journey.ts`; the server checks it again (`validate.ts`) |
| Under-16s: when the parent can see the young person's screen time on their **own phone** (Apple Family Sharing, Google Family Link), the parent's permission is enough and the parent sends the screenshots. Otherwise the young person sends them from their phone, if they are willing. If not (or neither is possible), the parent answers **longer questions**: time and apps, night-time and sleep, effects. Every parent answers the quick questions. | `src/steps/PhoneSource.tsx`, `familyWalkthroughs`, `parentMoreForm` (`src/config/questions.ts`, draft wording) |
| The draft markers and the preview controls come off the live site now. | Deploy workflow (`MPMB_PROTOTYPE` defaults to false) |
| Families can still complete the form **after the workshop**, if they didn't at the time: the team chases them. But nothing says so: the parent letter says only that "in the coming weeks your child will take part in…" (no dates), and the letter and the site ask for the form **as soon as they get it**, with no "you can do it later". The form stays open, and a family that stopped part-way (the young person wasn't there or wanted to decide later, or no screenshots were sent) **carries on later** with the reference from their thank-you page and the young person's date of birth, on any device: the young person adds their answer and screenshots, or the family adds screenshots, to the same record. | `src/steps/Resume.tsx` (`?finish=<reference>`, or "Carry on with your reference" on the first page); `resumeRecord` in `firebase/functions/src/resume.ts`; the thank-you page's link (`CarryOnLink`); `added_later_on` in `participants.tsv`, `added_later` in the sessions files |

| The parent's **home address and postcode are required** (records will be linked: that is part of the opt-out, so the form never offers to leave it blank); email and phone are optional. **No parental-responsibility tick**: only a parent or carer fills the form in. | `src/components/GuardianFields.tsx`, `src/config/fields.ts`, `validateGuardian` (`src/lib/validation.ts`); the server (`validate.ts`) |
| The permission has **no choices** ("Your choices" is gone): no screenshots question (the parent's yes or no is their answer to "Can we have {child}'s screen time?", now on both routes) and no recontact question. | `src/config/statements.ts` (`mpmb-parent-consent 0.7-draft`), `src/steps/ParentConsent.tsx`, `src/steps/PhoneSource.tsx` |
| **Everything is saved from the moment the parent signs**, even if the family never reaches the end or presses "Everything is right": answers are saved as they are given, and all of it can be used. | `SyncManager` (`src/App.tsx`), `firstIncomplete` (`src/state/useSync.ts`); `submitConsent` (`firebase/functions/src/index.ts`): versions only for changes to the record, one answers record per question form |
| **One last prompt** before finishing without the screen time, when it could still come. | `lastCall` (`src/model/journey.ts`), `src/steps/Check.tsx` |
| The age at their own smartphone goes down to **Under 5**, year by year, with **"I can't remember / I don't know"**; **more than one app** can be chosen as the ones used most. | `parentMoreForm` (`mpmb-parent-phone-use 0.2-draft`); multi-answer questions in `src/steps/ParentQuestions.tsx`, `validate.ts` and the export's data dictionary |
| The approved information sheet is **on the website** (`/information-sheet/`), brought up to date with these decisions, with a section on **how taking part works**: the workshop and linking are opt-out (by email), the young person decides on the day, and screen time is opt-in online. Linked from the Documents page, the families page, every school's page, the footer, the FAQ and the form. | `information-sheet.md`; `content-placeholders.md` lists where it differs from the approved documents |
| **No separate route for concerns or complaints** anywhere (the "independent of the study" paragraph is gone from the form, the thank-you page, the PDF and the site). | `src/config/copy.ts` (information `0.5-draft`), `src/steps/Done.tsx`, `src/lib/consentPdf.ts`, `_includes/documents_safeguards.html` |

For the master ethics update: opting out by email only (the approved
documents describe a slip); sharing an under-16's screen time from the
parent's family view without asking the young person; the address being
required and no parental-responsibility tick; no recontact question; keeping
what a family gave after signing even if they stopped part-way; and no
separate complaints route.

### The website for schools (teacher feedback, 7 October 2026)

| Decision | Where |
| --- | --- |
| Show **what a session looks like**, stage by stage (the talk, the live demonstration, fitting the headsets, seeing their own signals, the tasks, the questionnaires, questions about careers), with photos. | `session_timeline` in `_data/content.yml`; `_includes/gallery.html` (/participation/) |
| Make **real neuroscience** the schools page's lead: hands-on, beyond the usual curriculum, a chance to inspire pupils; with pupils' own words from Notre Dame Catholic Sixth Form College and a link to the college's story. | `_includes/for_schools.html`; `school_voice` in `_data/content.yml` |
| The curriculum card says the workshop was **designed with teachers from KS3 to KS5**. "Digital data awareness" is gone: it is not a confirmed part of the sessions. | `for_schools.benefits` in `_data/audience.yml` |
| The **Gatsby Benchmarks** (4, 5 and 7) use the team's own copy, and the benchmarks' official names. | `for_schools.gatsby_benchmarks` in `_data/audience.yml` |
| The workshop **has been tested in 8 schools with more than 1,000 students**: shown on the schools page, and said on the home, session and study pages. The headset is always a **lightweight headset**. | `track_record` in `_data/content.yml`; `_includes/home_summary.html`; `session_timeline.intro`; `inclusion` in `_data/audience.yml` |

### The social media break study (adults)

| Decision | Where |
| --- | --- |
| Participants book **both** lab visits at the first sitting, committing to both; the second is **28 to 35 days** after the first. (May change later.) | `src/lab/booking.ts`, the booking page, `booking.ts` in the functions |
| Texts through **Twilio**, sender **MyPhoneStdy** (11 characters, letters only: networks reject hyphens and longer names). | Deploy workflow (`MPMB_SMS_FROM`), `docs/booking.md` |
| Emails come from the study's Gmail; replies go to Miftah; **Miftah and brainpop@leeds.ac.uk are copied** on every booking, change and cancellation. | `src/lab/booking.ts` (`copyTo`) |
| Before a visit: bring the phone, charged; clean, dry hair with no products; glasses (or contact lenses) if worn; arrive 10 minutes early: the team meets participants at the **main entrance of the School of Psychology**. The building and room stay a placeholder for now. | `src/lab/booking.ts` |
| MyStory runs on this site's own form, after **every weekly check-in**. Before and after the break it is told **at the lab visits**, on a lab computer, from the staff page's links. The prompts stay as drafts until MySelf's arrive. | `src/lab/mystory.ts`, the staff page |
| Ages **18 to 21** (it was 18 to 24), checked from the date of birth at sign-up: anyone older is refused; someone who turns 22 during the study carries on. The optional Yes/No for record linkage stays. | `labStudy.maxAge` in `src/lab/config.ts`; `src/lab/steps/ParticipantId.tsx`; `tooOldToJoin` in `lab.ts`; the information sheet's "Why have I been invited?" (version 2.1) |
| Participants must give a **mobile number**, at sign-up with their four details (not part of the ID): the team needs it to contact them. Text reminders are on unless they untick them when booking. | `src/lab/steps/ParticipantId.tsx`, `submitLabConsent` (`lab.ts`), `src/lab/steps/LabBook.tsx`, `booking.ts`; `docs/booking.md` (costs) |
| The first page has **two equal ways in**: "New to the study" (Start) and "Already started?" (Continue), which finds the record with the participant ID or the same four details, on any device, without asking for the mobile number again. | `src/lab/steps/LabWelcome.tsx`, `carryOn` in `src/lab/steps/ParticipantId.tsx` |
| Participants can **come back later to reschedule**, signing in with their **participant ID** (as well as the four details or the emailed link). Changing times keeps the email address on file; a new address is possible, and then the old one is told. | `src/lab/steps/ParticipantId.tsx` ("Use my participant ID instead"), `src/lab/steps/LabBook.tsx`; `bookLabSlot` (`email: null` keeps the address; `addressChangedEmail`), `docs/booking.md` |

### Other

| Decision | Where |
| --- | --- |
| The New Year break prototype stays live but unlisted at `/new-year/`. | `new-year.md` |
