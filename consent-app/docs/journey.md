# Consent and phone-use donation: user journey

This document was written before the interface was built. It defines who does
what, in which order, and where the device changes hands. The code in
`src/model/journey.ts` is the executable version of this document.

## Design principles

1. **One small screen at a time.** No step asks for more than a handful of
   things. Long explanations sit behind "Find out more" disclosures.
2. **Always clear who is holding the phone.** Every step carries an *actor*
   (young person, parent/guardian, or "whoever has the phone"). When the actor
   changes, a full-screen **handover** appears before the next step. The
   actor is also shown in a persistent strip under the progress bar.
3. **Consent is captured from the parent directly.** A young person cannot tick
   a box saying a parent has agreed. The parent section requires the parent's
   name, relationship, active choices on each statement, and a signature.
4. **Choices are individual and explicit.** Each permission is a separate
   statement. Required statements are a checkbox; optional statements are an
   explicit *Yes / No* so that "not answered" is never mistaken for "declined".
5. **The young person's agreement matters.** After parental consent, the young
   person is asked for their own agreement (assent). They can say no, and that
   ends the journey respectfully. Phone-use data is only requested once the
   young person has agreed.
6. **Identifying information is kept separate from research data.** Different
   screens, different colours, and different objects in the data model.
7. **Nothing sensitive is stored permanently in the browser.** Progress is kept
   in `sessionStorage` (cleared when the tab closes and on submission);
   images are kept in memory only and uploaded through the API layer.

## The two ways in

| | Route P: parent or guardian starts | Route Y: young person starts |
|---|---|---|
| Typical situation | Parent opens the link from a letter or email at home | Young person opens it at school or on their own phone |
| First screens | Welcome → About the study (parent wording) | Welcome → About the study (young-person wording) |
| Who enters the child's details | Parent | Young person (name, date of birth, school, year group) |
| First handover | Parent → young person, after parent consent | Young person → parent, before parent details |
| Second handover | — (parent may also skip the young-person part if the child is not present, see below) | Parent → young person, after parent consent |

## Steps

Actors: **P** = parent/guardian, **Y** = young person, **A** = anyone with the phone.

| # | Step id | Phase | Actor | What happens | Can be skipped? |
|---|---|---|---|---|---|
| 1 | `welcome` | About | A | Choose "I'm a parent or guardian" or "I'm the young person". Short reassurance. | No |
| 2 | `about` | About | (route) | Three short cards: what the study is, what we ask for today, what you can change later. Find-out-more disclosures. | No |
| 3 | `child-details` | Details | Y or P | First name, last name, date of birth (day/month/year fields), school, year group. Explains why identifying details are needed and that they are kept apart from research data. | No |
| — | *handover Y→P* | | | Route Y only: "Please ask your parent or guardian to complete the next part." | |
| 4 | `parent-details` | Details | P | Parent's full name, relationship to the child, parental-responsibility confirmation, email (for a copy of the form), phone (optional), home postcode (optional). Route Y: shows the child's details for the parent to check. | No |
| 5 | `parent-information` | Consent | P | The participant information, in sections with "Find out more": what taking part involves, phone-use information, linking with health records, linking with education records, how information is protected, withdrawing, who to contact. | No |
| 6 | `parent-consent` | Consent | P | Consent statements (required checkboxes; optional Yes/No), typed name, drawn signature, date confirmation. | No |
| — | *handover P→Y* | | | "Please pass this to {child}." Route P offers "{child} isn't here right now", which defers the young person's part. | |
| 7 | `child-assent` | Agreement | Y | Young-person wording. "Do you want to take part?" (Yes/No), understanding checks, phone-use Yes/No, typed first name. | Deferred if the child is not present (Route P). |
| 8 | `phone-type` | Phone use | A | Why we ask, what we are and are not interested in. Choose iPhone / Android / something else. | Skipped when phone-use consent or assent was declined, or when assent is deferred. "Skip for now" available. |
| 9 | `find-screen-time` | Phone use | A | Illustrated walkthrough for the chosen platform. | As above |
| 10 | `upload` | Phone use | A | Take a photo or choose screenshots; preview; hide parts of an image; remove and retake; upload status and retry. | As above |
| 11 | `review` | Finish | A | Consent summary: who agreed to what and when, child details, phone-use images. Change links. Submit. | No |
| 12 | `done` | Finish | A | Reference code, what happens next, how to withdraw, contact details, "Clear this device". | — |

### Branching rules

* **Parent consent declined for "taking part"** → the required statement blocks
  progress with a clear message: taking part is optional, and the form cannot
  be submitted without it. (A parent who does not wish to consent simply does
  not submit; the "done" screen is not reached.)
* **Phone-use statement declined by the parent** → steps 8–10 are removed from
  the journey. The review page records the choice.
* **Young person answers "No" to taking part** → the journey moves to an
  `assent-declined` screen: "That's completely fine." The family can send the
  decision to the team (so the school does not include them) or go back.
* **Young person answers "No" to phone-use** → steps 8–10 are removed.
* **Child not present (Route P)** → assent status `deferred`; steps 7–10 are
  removed; the review page shows what is still to do and the team will ask the
  young person separately (for example at school).
* **Age outside the study range** (11–18, configurable) → the date-of-birth
  field shows a specific error and progress is blocked.

### Handover screens

Each handover is a full-width panel with a large heading, a plain sentence
about what the next person will do, and a single primary action worded from
the perspective of the *receiving* person ("I'm the parent or guardian —
continue"). Colours: the parent section is deep teal with a white label; the
young person's section is yellow with dark text. The persistent actor strip
uses the same colours so the two sections are visually distinct throughout.

## Progress and saving

* Progress bar with phase labels (About, Details, Consent, Agreement, Phone
  use, Finish) and "Step n of m". The total adapts to branching.
* Browser Back and the in-app Back button both go to the previous step.
* Text answers, choices and the signature are kept in `sessionStorage` while
  the tab is open, so a refresh does not lose progress. Images are never stored
  in the browser; after a refresh, uploaded images are listed by name without
  previews.
* "Clear everything and start again" is available from the progress area and
  the final screen.

## Error and edge states designed in

* Missing required fields: inline message under the field, plus an error
  summary at the top of the step that links to each field.
* Invalid date of birth (impossible date, future date, outside the age range).
* Consent statements not answered; required statement unticked.
* Missing or too-short signature (a single dot is not a signature).
* Typed name that does not match the name entered on the previous step
  (a warning, not a block, because names are legitimately written differently).
* Image problems: wrong file type, over the size limit, too many images,
  upload failure (with retry), and a preview that cannot be rendered.
* Submission failure at any stage, with a retry that resumes from the stage
  that failed.
* JavaScript disabled: the page explains that the online form needs
  JavaScript and points to the contact page.
