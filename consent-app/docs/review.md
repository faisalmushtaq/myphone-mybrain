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
* **Verifying the parent's identity** (for example a one-time code sent to their email before the record counts). This needs a server; it is described in `docs/architecture.md` as the recommended mechanism, along with a "this wasn't me" link in the confirmation email.
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
