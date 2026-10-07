# Decisions

Decisions the study lead made on the questions this code raised, and where
each is implemented. Newest first.

## 7 October 2026

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

To confirm with the ethics committee: opting out by email only (the
approved documents describe a slip), and sharing an under-16's screen time
from the parent's family view without asking the young person.

### The social media break study (adults)

| Decision | Where |
| --- | --- |
| Participants book **both** lab visits at the first sitting, committing to both; the second is **28 to 35 days** after the first. (May change later.) | `src/lab/booking.ts`, the booking page, `booking.ts` in the functions |
| Texts through **Twilio**, sender **MyPhoneStdy** (11 characters, letters only: networks reject hyphens and longer names). | Deploy workflow (`MPMB_SMS_FROM`), `docs/booking.md` |
| Emails come from the study's Gmail; replies go to Miftah; **Miftah and brainpop@leeds.ac.uk are copied** on every booking, change and cancellation. | `src/lab/booking.ts` (`copyTo`) |
| Before a visit: bring the phone, charged; clean, dry hair with no products; glasses (or contact lenses) if worn; arrive 10 minutes early: the team meets participants at the **main entrance of the School of Psychology**. The building and room stay a placeholder for now. | `src/lab/booking.ts` |
| MyStory runs on this site's own form, after **every weekly check-in**. Before and after the break it is told **at the lab visits**, on a lab computer, from the staff page's links. The prompts stay as drafts until MySelf's arrive. | `src/lab/mystory.ts`, the staff page |
| Ages **18 to 24**. The optional Yes/No for record linkage stays. | `src/lab/config.ts` |

### Other

| Decision | Where |
| --- | --- |
| The New Year break prototype stays live but unlisted at `/new-year/`. | `new-year.md` |
