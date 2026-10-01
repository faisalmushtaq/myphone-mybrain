# Review findings and what changed

After the first working version, the interface was reviewed from six
perspectives: an 11-year-old participant, a 16-year-old participant, a parent
with high digital literacy, a parent with low digital literacy, a research
ethics reviewer, and a data-protection/security reviewer. The reviews were run
against the code and against screenshots of the working prototype. This page
records the findings that led to changes, the findings that were deliberately
not acted on, and the things that were already working well.

## Changes made as a result

### Consent integrity (ethics, data protection)

| Finding | Change |
|---|---|
| An 18-year-old could be enrolled under parental consent (age range was 11–18). | This journey now stops at 17; an 18-year-old gets a specific message to contact the team for the self-consent form (`config/study.ts`, `lib/validation.ts`). |
| "Change" from the review page, and Back from the young person's screen, opened the other person's section without a handover; a parent could rewrite the child's agreement, or a child the parent's choices. | Handovers are now shown whenever the destination belongs to a specific person and the current step does not (`model/journey.ts` `needsHandover`), including Back and Change into the consent and agreement sections. |
| A parent could change a statement after signing and the old signature stayed attached. | Changing any statement after signing clears the signature, records `revisedAt`, and shows "please sign again" (`state/reducer.ts`, `steps/ParentConsent.tsx`). |
| The typed-signature alternative pre-filled the parent's name and counted it as signed with no action. | Switching to typed never counts as signing; the name must be typed by the person (`components/SignaturePad.tsx`). |
| On the parent route the young person's first screen was the agreement form, with nothing telling them what "taking part" means; the young-person "About" copy never mentioned surveys or the school session. | A "Before you decide" recap (surveys, school session, linkage, confidentiality limits, who to ask) now sits at the top of the agreement screen on both routes, and the young "About" cards describe what taking part involves (`config/copy.ts` `youngRecap`, `steps/ChildAssent.tsx`). |
| The participant information had no version and was not stamped on the record. | The information has a version and date, shown on the screen and recorded in the consent record (`informationVersion`). Full information sheet and privacy notice are linked before signing. |
| Consent statements were open-ended ("such as", "and other approved organisations") and mixed "read the information" with "agree to take part". | Statements split and closed lists used; an "authorised people may check study records" statement added (all still draft wording). |
| Declining assent sent the full payload (date of birth, postcode, phone, the parent's signature). | A declined assent sends a reduced record (names, school, parent's name and email; no consent record) and the young person can also "Finish without sending anything" (`state/useSubmission.ts`, `steps/AssentDeclined.tsx`). |
| Only the parent could defer the young person's agreement; nothing discouraged a parent from answering for the child. | The young person has "I'd like to decide later"; the handover asks the parent to let the young person answer themselves and explains why a parent also signs; handover confirmation and agreement start times are recorded so the server can flag an agreement completed suspiciously quickly. |
| Parental-responsibility hint stated legal detail that was partly wrong; foster carers were offered without a warning. | Cautious wording plus a specific note for foster carers (permission must come from the local authority or a holder of parental responsibility) and a "check with the team" note for step-parents, grandparents and others. |
| "Never shared" claims contradicted record linkage and safeguarding duties; no independent complaints route. | Wording now states the two exceptions (linkage, and serious safety concerns) and names an independent contact (placeholder) on the information and confirmation screens. |

### Phone-use donation (young people, data protection)

| Finding | Change |
|---|---|
| Screenshots were uploaded the moment they were chosen, before the family could check or hide anything — contradicting the promise on the previous screen. | Nothing leaves the device until "These are ready" is pressed. Images are checked and re-encoded locally (which also removes camera metadata such as location), previewed, edited, and only then sent (`state/useUploader.ts`, `steps/Upload.tsx`). |
| iPhone Screen Time lists websites as well as apps; the copy only mentioned apps. | The walkthrough and the "before you share" note say so and suggest hiding any row. |
| Walkthrough gaps: Screen Time not turned on; Samsung wording; hold-vs-press for screenshots. | Notes added to `config/walkthroughs.ts`. |
| "Uploaded securely", "encrypted connection", "sent safely" are assurances the front end cannot verify. | Replaced with plain statements of what happens; the privacy notice is linked instead. |

### Accessibility and plain English

| Finding | Change |
|---|---|
| Error-summary links for Yes/No statements pointed at ids that did not exist. | Links now target the first radio (`lib/validation.ts` `statementField`); the date row has a focusable id. |
| Inline error arrays re-created on every render made the error summary steal focus repeatedly (for example on every upload progress tick). | The summary focuses only when the *content* of the errors changes. |
| The image editor had no focus trap and its effect re-ran on parent re-renders. | It is now a native `<dialog>` opened with `showModal()`; the close handler is stable. |
| Input borders (#c8ddda) were 1.4:1 against white; progress labels 3.4:1; several mono labels under 11px. | Form-control borders use #5f8588 (4:1); progress labels raised to 0.8rem at 4.6:1; tags and flags raised to 0.8rem. |
| Platform choice was colour-only. | Each card now has a visible radio dot. |
| Upload progress and sending had no reliable announcements; the Send button lost focus while disabled. | One permanent polite live region (`lib/announce.ts`); loading buttons are `aria-disabled` and keep focus. |
| Page title never changed; the child's date of birth offered the parent's saved birthday. | Title set per step; birthday autofill only on the young person's own route. |
| Jargon: "record linkage", "pseudonymisation", "attainment", "study code", "withdraw". | Replaced with plain phrases; "Right to withdraw" is now "Stopping at any time". |
| Stale errors stayed after fields were corrected. | Fields re-validate as they are corrected once a first attempt has been made. |
| No mid-journey way to clear a shared device; the done screen kept data in memory indefinitely; contact details visible to whoever held the phone at review. | "Clear and start again" in the progress bar; automatic clearing after 30 minutes without activity (10 on the confirmation screen); saved progress older than two hours is discarded; contact details are masked on the review page until "Show contact details" is pressed. |

## Findings not acted on, and why

* **Editable consent date.** Kept, because the brief asks for the date to be confirmable; the device timestamp is recorded alongside it. The ethics committee may prefer it removed (`steps/ParentConsent.tsx`).
* **Verifying the parent's identity** (for example a one-time code sent to their email or phone before the record counts). This needs a server; it is described in `docs/architecture.md` as the recommended mechanism.
* **Progress lost if a young person closes the tab while waiting for a parent.** Saved progress is deliberately per-tab and short-lived for privacy; the young-person route now says to do it when a parent is present, and the handover screen says what to do if they are not. A resumable link would need the server.
* **Self-consent at 16–17.** Left as a documented configuration point for the ethics application.
* **Draft-wording markers.** Kept on by default because every piece of wording is still draft; they can be switched off from the prototype controls and must be removed before any real family uses the form.
* **Google Fonts.** The parent site loads fonts from Google; the production consent page should self-host them (noted in `docs/content-placeholders.md`).

## What the reviewers found was working well

* Parental consent is captured directly from the parent, with each permission a separate, explicit choice (required ones as checkboxes, optional ones as Yes/No with no default), tagged "Needed to take part" or "Your choice", and every statement version- and time-stamped.
* The young person's refusal is a first-class path with a calm ending, and phone-use steps disappear when either person says no or the agreement is deferred.
* Identifying details, the consent record and research information are separated in the data model, the payload, and visually on the review page; image bytes never touch React state or browser storage; redaction replaces pixels rather than overlaying them.
* Handover screens are addressed to the person receiving the device, with their name on the button, and the actor strip makes it clear whose section is open.
* Form primitives follow GOV.UK-style patterns: real inputs under custom visuals, hint and error association, error summary with links, three-part date of birth with a numeric keypad, large targets.

## Second round: streamlining (v2)

After the first version was tested, the journey was shortened from ten
screens to five or six without removing any of the safeguards above:

* Information and permission share one screen; the required statements sit
  under one confirmation tick (configurable in `config/study.ts`) and each is
  still recorded individually with `via: 'group'`.
* The young person's agreement is a single signature over a three-line list;
  their screenshot consent is recorded by the act of sending (`via: 'action'`).
* Phone type, instructions and upload are one screen; the instructions open
  when a phone is chosen and fold once images are added.
* The review page became an optional "Review everything before sending"
  section on a short send screen.
* The parent route enters the child's and the parent's details on one screen;
  phone and postcode are folded away as optional.

Things deliberately kept: the handover screens, the explicit Yes/No for each
optional permission, re-signing after a change, the decline and decide-later
paths, and contact-detail masking on the review.

The Firebase backend was then built (`docs/firebase.md`) and tested end to
end against the emulator suite, including the security rules.

## Third round: testing feedback (v3)

Testing of v2 with the mock backend produced a short list of changes, all in
the direction of "send at the natural moment, and never lose a family":

* **Email optional.** The address is a plain optional contact detail.
  Nothing is emailed to families; the thank-you page offers a PDF copy of the
  record to download instead.
* **No bouncing.** The error summary takes focus once, when Continue is
  pressed; fixing a field removes its error as it is fixed; a new problem
  waits for the next Continue.
* **Participation is recorded the moment it exists.** The permission and
  agreement are sent as soon as the young person has signed (or declined, or
  deferred). A status line on the following screens shows "Permission saved"
  with the reference, or "not saved yet" with a retry.
* **The screenshots are asked for.** Skipping is a two-step choice with a
  short appeal that says the screenshots are the part no one else can
  provide, that taking part is already recorded, and that it takes about a
  minute.
* **Send from the screen-time page**, not from a final page; each send is its
  own record.
* **The last page checks rather than sends.** Every section has "Change";
  changes are saved as amendments (new records that point at the ones they
  supersede) and the original is kept. More screenshots can be added from
  here.
* **A thank-you page** with a short "Why this matters" (draft wording).
* **A typed-in school name needs at least three letters.**
* **Photo checks.** On the device, a content-blind check of shape and colour
  warns when an image looks like a photograph and asks for confirmation
  before it goes. On the server, the metadata-stripped copy is checked with
  Cloud Vision SafeSearch (unsafe content is refused and never stored) and
  text detection (an image with none of the words a screen-time page carries,
  that also looks like a photograph, is refused; an unclear one is kept and
  flagged for a coordinator to look at). Without Vision the server never
  refuses on relevance alone.

Points the reviewers would raise about these, and the answers built in:

| Perspective | Concern | Answer |
|---|---|---|
| Ethics | Does the skip appeal pressure a young person? | It states that taking part is already recorded and that skipping is fine; the skip remains one tap away, and the thank-you page offers a link to add them later rather than asking again. Wording is draft (`docs/content-placeholders.md`). |
| Ethics | Can a family remove a screenshot after sending? | Not from the app; the check page says to contact the team quoting the reference. Withdrawal is a team process, as before. |
| Data protection | Where do the images go for the Vision checks? | To the Cloud Vision API's EU endpoint, as the metadata-stripped copy, only when `MPMB_VISION` is on; nothing about the content is logged. To be covered in the DPIA before it is switched on. |
| Data protection | Are amendments an audit risk? | No record is edited: each amendment is a new consent and assent document with `supersedes`, and the submission lists every version. |
| Young people | Will the photo warning make them feel accused? | It says "doesn't look like a screen-time page" and explains that a photo of another phone showing the app list is fine; the only hard refusals are for unsafe content or a plain photograph with no screen-time words. |
| Low-literacy parent | Is it clear when things are saved? | One status line, always in the same place, with three states: saving, saved with the reference, not saved with a retry. |

## Fourth round: apps, and the parent's questions

* **Apps, not just totals.** The permission statement, the young person's
  statement, the screen-time page, the walkthroughs and the check now all say
  the same thing: we want the list of apps with the time on each, and why
  (how a phone is used matters as much as how much). Both `phone-use`
  statements have a new version; the server flags an accepted screenshot
  whose text shows screen-time words but no app list, so the team can ask for
  it.
* **Three one-tap questions and an open box for the parent**, straight after
  their permission: how concerned they are, compared with other young people,
  whether it gets in the way, and anything else they want to say.
  Optional at every level (skip a question, skip them all), with a visible
  "Previous question", and a summary with "Change my answers" when the parent
  comes back rather than asking everything again.

| Perspective | Concern | Answer |
|---|---|---|
| Ethics | Survey items inside a consent journey could be read as a condition of taking part. | The step is labelled optional, says the answers are research information and "not part of your permission", sits after the permission has been signed, and can be skipped in one tap. The record stores `skipped` distinctly from `completed`. |
| Young person | Seeing "Very concerned" about themselves on the shared phone. | The check page and the thank-you page show a count only ("3 of 4 answered"); the answers are behind a handover to the parent. |
| Data protection | Free text can carry names or details about other people. | The box says not to include names; it is limited to 500 characters; the record is stored with the participant id only, and the DPIA should say who reads free text before it reaches researchers. |
| Accessibility | Auto-advance on selection can strand keyboard and screen-reader users. | The options are real buttons (one press = one answer), focus moves to the next question and its number is announced; nothing advances on arrow keys. |
| Data protection | Where are the answers stored? | In a `surveys` collection labelled by participant id only, readable by the researcher and coordinator roles; re-sent as a new versioned record with any amendment. |

## Fifth round: the young person not being there

A parent should be able to complete everything when the young person is
out, so "{child} isn't here right now" no longer stops at the permission:
the parent carries on to the screen-time step and the check page. The young
person's own agreement may be collected separately, for example on paper at
school, so neither the app nor the server treats an agreement that is not in
the app as missing.

| Perspective | Concern | Answer |
|---|---|---|
| Ethics | Screenshots of the young person's phone shared before their agreement is recorded. | Parental consent covers the collection; the young person's own agreement is collected separately (the page says so before anything is sent), and the donation records whether they had agreed in the app and what their agreement status was at the time, so the team can match it against the paper record. `study.screenshotsWaitForAssent` makes the step wait instead, if the committee prefers. |
| Ethics | A young person who said no. | Declining still ends the journey, and the server refuses screenshots for a declined record. |
| Data protection | Can a client claim the young person agreed in the app when they did not? | The agreement record is only written to the young person's assent record when that record is completed on the server; otherwise it stays on the donation as the client's statement. |
