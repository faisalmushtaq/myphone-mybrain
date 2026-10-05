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
