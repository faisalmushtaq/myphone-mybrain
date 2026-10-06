# Content that must be replaced before use

Every piece of participant-facing wording in this prototype is placeholder
text written to make the journey realistic. Nothing here has been reviewed by
the research ethics committee, the data protection team or the University's
legal team. Text flagged `draft: true` in the configuration files shows a
small "Draft wording" marker in the interface (switchable from the Prototype
controls panel).

| What | Where in the code | Replace with |
|---|---|---|
| Parent/guardian consent statements (7: four required, three optional) and the form version id | `src/config/statements.ts` → `parentConsentForm` | Ethics-approved consent form wording, one statement per permission, with the approved version identifier |
| Young person's agreement statements (4) and version | `src/config/statements.ts` → `childAssentForm` | Ethics-approved assent wording, ideally two reading-age variants (11–13 and 14–18) if the committee wants them |
| "About the study" cards, parent and young-person versions | `src/config/copy.ts` → `aboutStudy` | Approved summary of the participant information sheet |
| Participant information sections (what is involved, phone-use, linkage, protection, withdrawal, contact) | `src/config/copy.ts` → `parentInformation` | The approved participant information sheet, split into the same sections; add the independent complaints contact |
| Why we collect phone-use information; the "not interested in" list | `src/config/copy.ts` → `whyPhoneUse` | Approved plain-English explanation consistent with the data management plan |
| Record-linkage wording and the approvals it names (University ethics, NHS REC, data owners, Connected West Yorkshire data access) | `src/config/statements.ts` (`link-records`) and `src/config/copy.ts` (`linking` section) | Wording agreed with Connected West Yorkshire and the data controllers, with the actual approval references and the named datasets |
| Withdrawal information | `src/config/copy.ts` (`withdraw` section), `src/steps/Done.tsx`, statement `understand-withdraw` | Approved withdrawal process and what can/cannot be removed |
| Researcher and contact details, phone number, complaints route | `src/config/study.ts` → `contact`; `src/config/copy.ts` (`contact` section) | Named contact, phone number if published, independent contact for concerns |
| Study, site and form identifiers | `src/config/study.ts` → `studyId`, `siteId`; form ids in `statements.ts` | Identifiers used in the study database |
| Participating schools | `src/config/schools.ts` | Real school list with database ids |
| Eligible age range; whether 16–17s may self-consent; deferred assent; typed signature | `src/config/study.ts` | Decisions from the ethics application |
| The parent's quick questions about the young person's phone use (three items, one tap each, and an open box) and the form version | `src/config/questions.ts` (the server's copy is generated from it at build time) | Validated or ethics-approved items if the team has them; keep the ids stable or bump the versions |
| Thank-you page: "Why this matters" and what happens next | `src/config/copy.ts` → `thankYou`; `src/steps/Done.tsx` | Approved wording |
| The downloadable copy of the record (PDF offered on the thank-you page) | `src/lib/consentPdf.ts` | Approved wording for its title, introduction and "changing your mind" text; the statements and answers come from the configuration |
| The appeal shown before skipping the screenshots, and the "most important part of the study" sentence | `src/steps/PhoneUse.tsx` | Wording the ethics committee is comfortable with: it must not read as pressure |
| What a parent is told when sharing screenshots while the young person's agreement is still to be collected (screen-time page, check page, thank-you page, handover) | `src/steps/PhoneUse.tsx`, `src/components/ConsentSummary.tsx`, `src/steps/Done.tsx`, `src/components/HandoverScreen.tsx` | Wording agreed with ethics, matching how the paper agreement is collected at school |
| Photo-check wording shown to families (the warning under an image, the confirmation before sending, and the reasons a rejected image is given) | `src/components/UploadList.tsx`, `src/steps/PhoneUse.tsx`, `firebase/functions/src/quality.ts` → `FAMILY_REASONS` | Approved wording; the reasons must never accuse |

## The social media break study (adults)

The lab study's page (`/break/take-part/`, code in `src/lab/`) carries the **ethics-approved version 1** wording (SoPREC 4202, approved 11 June 2026) from the Participant Information Sheet and Participant Consent Form, verbatim, so it does not show the "Draft wording" marker. Donations will go through the Smart Data Donation Service (SDDS) once it is ready; until then the website carries out that step, and the interface says so under each passage that mentions SDDS.

| What | Where in the code | Replace with |
|---|---|---|
| Two consent statements and the "Smartphone usage data" information section describe donating data "through SDDS"; each carries a `note` explaining that the website does this step until SDDS is ready | `src/lab/config.ts` → `labConsentForm` (`involves`, `donation-required`), `labInformation` (`donation`) | When SDDS takes over, or the wording is re-approved: update the notes or remove them, and bump `labConsentForm.version` and `labInformationVersion` if the statements themselves change |
| Compensation: the page says £25 per lab visit plus £25 for completing all parts, £75 in total (confirmed by the team); the approved sheet still reads "[£50 / course credit]" and the recruitment email £20 + £30 | `src/lab/config.ts` → `labInformation` (`compensation`); `break.md` | Bring the sheet and the leaflet into line with the £75 |
| Ethics reference SoPREC 4202, approved 11 June 2026 (the team expects to update it) | `src/lab/config.ts` → `labStudy.ethicsReference`, `ethicsApproved`; `break.md`; both exported `dataset_description.json` files (`firebase/functions/src/export.ts`, `exportLab.ts`) | The new reference when it changes |
| The four code answers (mother's first name, house number, birth month, postcode) are kept with the consent record as research variables; the approved information sheet does not say so, and house number plus postcode is a home address | `src/lab/steps/ParticipantId.tsx` (what the participant is told), `firebase/functions/src/lab.ts` (`codeParts`, stored on `labConsents` only), exported in `social-media-break/identifying/consents.tsv` | Confirm with the ethics committee and the DPIA, and add a sentence to the information sheet |
| Record linkage: an optional Yes or No statement, draft wording copied from the schools study's statement, with the approvals it names | `src/lab/config.ts` → `labConsentForm` (`link-records`, version `0.1-draft`) | Wording and approvals confirmed for adults with the governance team; bump the version |
| Age range 18 to 24 (the approved sheet says 18 or older; the recruitment email says 18 to 24) | `src/lab/config.ts` → `labStudy.minAge`, `maxAge` | The range the committee approved |
| Contact names and addresses (Miftah Faizah, Professor Faisal Mushtaq) | `src/lab/config.ts` → `labStudy.contact`; `break.md`, `break-take-part.md` | As approved |
| The participant-code scheme (mother's initials, house number digit, birth month, postcode letters) must match the lab questionnaire exactly | `src/lab/config.ts` → `buildParticipantCode`, `PARTICIPANT_CODE`; mirrored to the server at build time | Whatever the questionnaire does; the two must agree or the data cannot be joined |
| The step-by-step download guide (TikTok, Google Takeout, iPhone and Android screen time) and its screenshots | `src/lab/steps/LabGuide.tsx`, `src/assets/lab-guide/` | Refreshed when the platforms move their menus |
| The categories offered in the cleaner, their descriptions, and what is always removed | `src/lab/cleaner.ts` → `categories`, `alwaysRemoved` | Whatever the data management plan allows; the server accepts only the file names listed in `ALLOWED_CLEANED_FILES` |
| The recruitment page | `break.md` | The approved recruitment leaflet wording |

## Things that are not wording

* The mock API is the default build; the Firebase client is selected with
  `MPMB_BACKEND=firebase` (`docs/firebase.md`).
* The Cloud Vision photo checks (`MPMB_VISION`) send each screenshot to
  Google's Vision API; switch them on only once the DPIA covers it.
* The Prototype controls panel (`src/components/PrototypePanel.tsx`) and the
  `window.__mpmbMockApi` hook must be removed from the production build.
* Google Fonts are loaded from Google's servers by the parent site; for the
  production form, self-host the three font families so no third-party request
  is made from the consent page.
