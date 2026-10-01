# Consent and screen-time donation: user journey (v3)

This document defines who does what, in which order, where the device
changes hands, and when things are sent. `src/model/journey.ts` is the
executable version.

Version 3 follows a round of testing with the streamlined v2 flow. The big
change is *when* things are sent: the permission and agreement go to the
server the moment the young person has signed, screenshots go when the send
button on the screen-time page is pressed, and the last page is a check of
what has already been sent rather than a "send" button. What changed and why
is at the end.

## Design principles

1. **One screen per purpose, no read-only screens.** Every screen asks for
   something. Explanations sit beside the question they support, folded
   until needed.
2. **Always clear who is holding the phone.** Every step has an *actor*. A
   full-screen handover appears whenever the device must change hands into
   the permission or agreement sections, and the strip under the progress
   bar names whose section is open.
3. **Consent is captured from the parent directly.** Name, relationship,
   parental responsibility, active choices, and a signature. A young person
   cannot tick a box saying a parent agreed.
4. **The required statements are one confirmation; the permissions are
   separate choices.** The four statements needed to take part sit under one
   tick (each is still recorded individually, marked `via: 'group'`). The
   three optional permissions (screenshots, linking with records already held
   through Connected West Yorkshire, and recontact) are explicit Yes/No rows
   with no default.
5. **The young person's agreement is their signature.** The three things it
   means are listed above the box. Saying no and deciding later are equally
   visible. Sharing screenshots is agreed by doing it (pressing send).
6. **Participation is recorded as soon as it exists.** The permission and
   agreement are saved the moment the young person has signed (or declined,
   or deferred), before the screenshots. A family that stops there has still
   taken part; nothing depends on a final "send".
7. **Screenshots are asked for, not demanded.** They are the one thing no one
   else can provide, so skipping is a two-step choice with a short appeal,
   but it is always possible, and the thank-you page says the team can send
   a link to add them later.
8. **Checking is a page, not a gate.** The last step shows the record the
   team holds, with "Change" beside each section. Changes are saved as
   amendments; the original is kept.
9. **Errors do not chase the person.** They appear when Continue is pressed
   and the summary takes focus once. Fixing a field removes its error as it
   is fixed; a new problem waits for the next Continue.
10. **Identifying details are kept apart from research data**, in the model,
    the payloads, the database collections and on screen.
11. **Nothing sensitive stays in the browser.** Progress lives in
    `sessionStorage` for the tab, expires after two hours or 30 minutes of
    inactivity, and is cleared when the thank-you page is reached. Images
    are never stored in the browser.

## The two ways in

| | Route P: parent or guardian starts | Route Y: young person starts |
|---|---|---|
| Typical situation | Parent opens the link at home | Young person opens it with a parent present |
| Details | One screen: the child's details and the parent's own | The young person's details, then a handover, then the parent's own |
| Handovers | Parent → young person, after permission | Young person → parent before the parent's details; parent → young person after permission |

## Steps

Actors: **P** parent/guardian, **Y** young person, **A** anyone.

| # | Step id | Actor | What happens |
|---|---|---|---|
| — | `welcome` | A | Choose who is starting; what the study is (folded); three reassurances. Not counted as a step. |
| 1 | `child-details` | route | Names, date of birth, school (a typed-in school name needs at least three letters), year group. Route P also asks for the parent's name, relationship, parental-responsibility confirmation and an optional email address (phone and postcode folded, optional). |
| — | *handover Y→P* | | Route Y only. |
| 2 | `parent-details` | P | Route Y only: check the child's details, then the parent's own (same fields as above). |
| 3 | `parent-consent` | P | **One screen.** Six one-line information summaries (each opens to the full wording); the four required statements under one tick; three Yes/No permissions; name (pre-filled), signature, date. |
| 4 | `parent-questions` | P | **Optional, about a minute.** Three one-tap questions about how the parent sees the young person's phone use (how concerned, compared with others, gets in the way) and an open box for anything else (up to 500 characters, with a note not to include names). Tapping an answer moves to the next question; the box has a Finish button. "Skip this question" and "Skip these questions" are always visible. Coming back shows the answers with "Change my answers" rather than asking again. Clearly labelled as research information, not part of the permission. |
| — | *handover P→Y* | | Route P offers "{child} isn't here right now": the young person's agreement is deferred (to be collected separately, for example on paper at school) and the parent carries on with the rest themselves, screenshots included. |
| 5 | `child-assent` | Y | Three-line recap; "Signing your name means…"; signature. "I don't want to take part" and "I'd like to decide later" alongside. **Finishing this step sends the permission and agreement to the server.** |
| 6 | `phone-use` | A | **One screen.** Status line ("Permission saved. Reference …"); why we ask (folded); which phone; how to find the summary (open until images are added); add, check, hide parts of, and **send** screenshots. The page, the instructions and the permission statement all say the same thing: we want the **list of apps with the time on each**, not just the total, because how a phone is used matters as much as how much. Each image gets a quick on-device check; a photo-like image is flagged and must be confirmed before it goes. Skip is a two-step choice. |
| 7 | `check` | A | "Check what you've sent": the whole record with "Change" beside each section (changes are saved as amendments), "Add screenshots"/"Add more screenshots", and "Everything is right — finish". |
| — | `done` | A | Thank you: why taking part matters (draft wording), reference, what happens next, changing your mind, independent contact, "See what was recorded", "Finish and clear this device". |

Route P is six counted steps; route Y is seven. The parent's answers are shown on the check page as a count only ("3 of 4 answered"), because whoever is holding the phone may be the young person; changing them means a handover to the parent.

### When things are sent

| What | When | If it fails |
|---|---|---|
| Permission and agreement (`submitConsent`) | Automatically, a moment after step 4 is finished (the first time step 5 or 6 is shown). "Let the team know" on the declined page sends the minimal record. | The status line says "Your permission has not been saved yet" with "Try again". Nothing retries in a loop. The check page cannot be finished until it is saved. |
| Amendments (`submitConsent` with the reference) | Automatically when anything in the details, permission or agreement changes and the screen-time or check page is shown again. | Same status line, "Your changes have not been saved yet". |
| Screenshots (`submitDonation`) | When "Send this screenshot" / "Send these N screenshots" is pressed on step 5 (including from "Add more screenshots" on the check page). Each send is its own record, linked by the reference. | The images stay on the page marked "Not sent" with a reason and a retry. An image the server would not keep is marked with the reason so it can be removed or replaced. |

Sent screenshots cannot be removed from the app; the check page says to
contact the team quoting the reference.

### Branching rules

* Parent declines screenshots → step 6 removed; the check page says "Not shared".
* Young person presses "I don't want to take part" → `assent-declined`: "Let the team know" (sends a minimal record: names, school and the parent's name; no contact details and no permission record) or "Finish without sending anything".
* Young person presses "I'd like to decide later", or the parent says the young person isn't here → agreement `deferred` (with who deferred it). Nothing waits for it: the young person's agreement may be collected separately, for example on paper at school, so the screen-time step stays and the parent can complete everything. The screen-time page says the agreement will be collected separately (and, when the young person is absent, that the parent is sharing on their behalf). Screenshots sent without an in-app agreement are recorded as such (`youngPersonAgreedInApp: false`, with the agreement status at the time); the server never refuses them on that account. `study.screenshotsWaitForAssent` makes the step wait instead.
* "Skip this for now" on step 6 → "Before you skip": the screenshots are the part nobody else can provide, taking part is already recorded, it takes about a minute. "OK, I'll add them now" opens the instructions; "I really can't right now — skip" moves on.
* An image that looks like a photograph rather than a screenshot → warning under the image; pressing send asks "It's right — send anyway" or "Let me check".
* An image the server will not keep (not an image, unsafe content, or clearly not a screen-time page when the thorough checks are on) → "Not all of the images could be accepted" with the reason under the image; the rest are sent.
* Age outside 11–17 → specific message (an 18-year-old consents for themselves; the team will send that form).
* A permission statement changed after signing → signature cleared, "please sign again". A change after the record was sent → saved as an amendment.

### Handover screens

Addressed to the person receiving the device, with their name on the button.
The parent → young person handover explains why a parent also signs and asks
the parent to let the young person answer themselves. Handover confirmation
and agreement start/finish times are recorded so the server can flag an
agreement completed within seconds. Handovers guard the permission and
agreement sections only; either person may correct identifying details from
the check page.

## What changed from v2, and why

| v2 | v3 | Why |
|---|---|---|
| Email address always required | Optional email field, a contact detail only | Nothing is emailed to families: the thank-you page offers a PDF of the record to download instead. |
| Errors re-validated on every keystroke and the summary took focus again | Summary focuses once, on Continue; fixing a field removes its error; new errors wait for the next Continue | Testing: "when I go to fix it, it bounces back up". |
| "Skip" on the screen-time page moved straight on | Two-step skip with a short appeal | The screenshots are the key part of the study; participation is already recorded, so the appeal carries no pressure. |
| Everything sent by one "Send" button at the end | Permission and agreement sent when the young person has signed; screenshots sent from their own page | A family that stops at the screenshots still counts; nothing can be lost by closing the tab after signing. |
| "Ready to send" page | "Check what you've sent" page, with amendments | By that point everything is on the server; the page is for checking and correcting. |
| Confirmation page | Thank-you page with "Why this matters" | Asked for in testing: say thank you, and say briefly why it matters. |
| No check on what an image is | On-device check (shape and colour) with a warning and confirmation; server checks (SafeSearch and text detection when enabled) that refuse unsafe or plainly wrong images | Families add the wrong image by mistake; nothing harmful should be stored. |
| Typed school name of any length | At least three letters | Testing. |
| "Screen-time screenshots" | "Screen time and the apps you use": the statement, the page, the instructions and the check all ask for the list of apps with times, and say why | The study wants to know *how* a phone is used, not only how much; a screenshot of the total alone is much less useful. |
| "Isn't here" deferred the agreement and skipped the screenshots | The parent can complete everything, screenshots included; the young person's agreement is collected separately, for example on paper at school, and nothing in the app or on the server waits for it | Testing: a parent should be able to finish the whole thing when the young person is out. |
| — | Three optional one-tap questions and an open box for the parent after their permission | Asked for in testing: a quick read of how parents see, and how concerned they are about, their child's phone use. |

Everything kept from v2: the one-screen permission, the signature-only
agreement, the handover guards, re-signing after a change, the decline and
decide-later paths, contact-detail masking, and the separation of identifying
details from research data.

## What changed from v1 to v2

| v1 | v2 | Why |
|---|---|---|
| Welcome, then "About the study" | About folded into Welcome | The about screen asked for nothing. |
| Child details, then parent details (both routes) | One details screen on the parent route | The same person was filling in both. |
| Information screen, then consent screen | One permission screen | Reading and agreeing belong together. |
| Four required checkboxes | One confirmation tick over a list (configurable) | Each is still recorded individually. |
| Optional permissions as large cards | Compact Yes/No rows | Same explicit choice, a third of the height. |
| Young person: two checkboxes, two Yes/No choices, typed name | One signature over a three-line list; screenshot consent by sending | Signing is a single clear act. |
| Phone type, walkthrough, upload (three screens) | One screen | The instructions open when needed and fold once images are added. |
| Full review page before sending | Short summary with the full record one tap away | Families who want to check everything still can. |
