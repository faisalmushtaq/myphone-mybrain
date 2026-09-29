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
| Confirmation email content and what happens next | `src/steps/Done.tsx` | Approved wording; the email itself is sent by the server, not this app |
| Privacy notice link text and the "encrypted connection" sentence on the review page | `src/steps/Review.tsx`, `src/steps/About.tsx` | Approved privacy notice and accurate description of the production hosting |

## Things that are not wording

* The mock API must be replaced by a real client (`src/api/index.ts`).
* The Prototype controls panel (`src/components/PrototypePanel.tsx`) and the
  `window.__mpmbMockApi` hook must be removed from the production build.
* Google Fonts are loaded from Google's servers by the parent site; for the
  production form, self-host the three font families so no third-party request
  is made from the consent page.
