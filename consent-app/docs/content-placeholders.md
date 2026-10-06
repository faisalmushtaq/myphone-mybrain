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

The lab study's pages (`/break/take-part/` before the break, `/break/check-in/` during it, `/break/after/` after it; code in `src/lab/`) follow the **participant information sheet of 21 February 2026** (SoPREC 4202) section by section, with two adaptations: the sheet says files are uploaded to Qualtrics and names TikTok and YouTube, whereas this website does the upload and Instagram is also accepted. Five consent statements are the approved form's wording; the two that described the data donation were redrafted to match the new sheet and carry version `2.0-draft` (the form is `mpmb-lab-consent 2.0-draft`, the information `2.0`).

| What | Where in the code | Replace with |
|---|---|---|
| The two redrafted consent statements (`involves`, `donation-required`) and the information sheet's two adaptations (upload here rather than to Qualtrics; Instagram as well as TikTok and YouTube) | `src/lab/config.ts` → `labConsentForm`, `labInformation` (`what`, `donation`) | The wording the committee approves; bump `labConsentForm.version` and `labInformationVersion` when it changes |
| The study accepts TikTok, YouTube and Instagram exports; Snapchat and others are refused because their exports are mostly personal and other people's data | `src/lab/cleaner.ts` (platforms, categories), `src/lab/guideSteps.tsx` (the Instagram steps), `src/lab/steps/LabGuide.tsx` (the app picker) | Keep in step with the apps the protocol names |
| Compensation: the page says £25 per lab visit plus £25 for completing all parts, £75 in total (confirmed by the team); the approved sheet still reads "[£50 / course credit]" and the recruitment email £20 + £30 | `src/lab/config.ts` → `labInformation` (`compensation`); `break.md` | Bring the sheet and the leaflet into line with the £75 |
| Ethics reference SoPREC 4202, approved 11 June 2026 (the team expects to update it) | `src/lab/config.ts` → `labStudy.ethicsReference`, `ethicsApproved`; `break.md`; both exported `dataset_description.json` files (`firebase/functions/src/export.ts`, `exportLab.ts`) | The new reference when it changes |
| The four details the participant ID is built from (first name, last name, date of birth, postcode) are kept with the consent record; the research dataset has age at consent only. The approved information sheet does not list them | `src/lab/steps/ParticipantId.tsx` (what the participant is told), `firebase/functions/src/lab.ts` (`codeParts`, stored on `labConsents` only), exported in `social-media-break/identifying/consents.tsv` | Confirm with the ethics committee and the DPIA, and add a sentence to the information sheet |
| Record linkage: an optional Yes or No statement, draft wording copied from the schools study's statement, with the approvals it names | `src/lab/config.ts` → `labConsentForm` (`link-records`, version `0.1-draft`) | Wording and approvals confirmed for adults with the governance team; bump the version |
| The progress email and the 48-hour follow-up sent to participants who ask for them (one for the first page, one for the after-break page) | `firebase/functions/src/lab.ts` → `labStatusEmail`, `labFollowUpEmail` | Wording the team is happy with |
| The statement that what is sent is kept unless the person formally withdraws, within one month of the final session (`data-kept`, `0.1-draft`), and the same point in the information's "Do I have to take part?" | `src/lab/config.ts` → `labConsentForm`, `labInformation` (`voluntary`) | Wording the committee approves; for someone who stops early, say what "final session" means |
| The per-app checklist ("Still to do", "I don’t use it", "Every app you use is ticked off") and the line in the progress emails asking people to say on the page if they do not use an app | `src/lab/PlatformChecklist.tsx`, `src/lab/steps/LabDone.tsx`, `firebase/functions/src/lab.ts` (`outstanding`, `notUsedNote`) | Wording the team is happy with; whether "not used" should need a reason |
| The mid-break check-in questions: week of the break, use of the restricted apps, mood, how hard the break has been, missing social media, and a free-text note (`mpmb-lab-checkin 0.1-draft`) | `src/lab/config.ts` → `labCheckInForm` | The team's agreed items (for example a validated short mood scale); bump the version, and the server and the export's data dictionary follow |
| MyStory, offered after each check-in: the card says it is not open yet | `src/lab/config.ts` → `labMyStory` (`url: null`, `codeParam`) | The MyStory address once it is live; the participant ID is added as `?code=`, so check the data agreement covers passing it |
| The after-break page's reminder in place of a new consent (what was agreed, what is kept, how to withdraw) | `src/lab/steps/LabReminder.tsx` | Wording agreed with the committee: that a reminder, not a second consent, is enough at that point |
| Age range 18 to 24 (the approved sheet says 18 or older; the recruitment email says 18 to 24) | `src/lab/config.ts` → `labStudy.minAge`, `maxAge` | The range the committee approved |
| Contact names and addresses (Miftah Faizah, Professor Faisal Mushtaq) | `src/lab/config.ts` → `labStudy.contact`; `break.md`, `break-take-part.md`, `break-check-in.md`, `break-after.md` | As approved |
| The participant ID: `MP` and the first 12 hexadecimal digits of the SHA-256 hash of `FIRST\|LAST\|YYYYMMDD\|POSTCODE` (names upper case, letters only; postcode letters and digits only). The survey platform must build it the same way, with the same question wording, or the data cannot be joined | `docs/participant-id.md` (recipe, worked examples, JavaScript and Python); `src/lab/config.ts` → `buildParticipantId`, `PARTICIPANT_CODE`; `firebase/functions/src/lab.ts` → `buildParticipantId` | The survey platform's implementation checked against the worked examples |
| The step-by-step download guide (TikTok, Google Takeout, iPhone and Android screen time) and its screenshots | `src/lab/guideSteps.tsx` (shown by `src/lab/steps/LabScreenshots.tsx` for the phones and `src/lab/steps/LabGuide.tsx` for the apps), `src/assets/lab-guide/` | Refreshed when the platforms move their menus |
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
