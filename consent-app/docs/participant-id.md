# The participant ID

Every adult in the social media break study is known by a participant ID such
as `MP2670FF90A5F2`, never by name. The ID is built from four details the person
always knows, so nobody has to remember a code, and any system that asks for the
same four details and follows the same recipe gets the same ID. That is how the
website's data (consent, screenshots, app data, check-ins) joins up with the
survey platform's questionnaires and the laboratory data without a name.

The website builds it in `src/lab/config.ts` (`buildParticipantId`) and the
server checks it in `firebase/functions/src/lab.ts` (`buildParticipantId`); both
are tested against the worked examples below.

## The four questions

Ask them with the same wording everywhere, so people answer the same way. (On
the first page the website also asks for a mobile number, so the team can
contact people. It is **not** part of the ID and is kept apart from it.)

| Question | Hint shown |
| --- | --- |
| First name | As on official documents, not a nickname. Just your first name, no middle names. |
| Last name | |
| Date of birth | |
| Postcode | Where you live now, such as LS2 9JT. (On later visits: the postcode you gave at the start, even if you have moved since.) |

## The recipe

1. **First name and last name**, each:
   1. Unicode NFKD normalisation (this separates accents from letters);
   2. upper case;
   3. keep letters only: anything that is not a letter (Unicode category L) is
      removed, so accents, spaces, hyphens, apostrophes and full stops all go.

   `Élodie` gives `ELODIE`; `O'Brien-Smith` gives `OBRIENSMITH`; `Mary Jane` gives
   `MARYJANE`; `Strauß` gives `STRAUSS`.
2. **Date of birth** as eight digits, year, month, day: 14 March 2005 gives `20050314`.
3. **Postcode** in upper case with everything except A to Z and 0 to 9 removed:
   `ls2 9jt` gives `LS29JT`.
4. **Join** the four with a vertical bar, in this order:
   `JANE|SMITH|20050314|LS29JT`.
5. **Hash** that text with SHA-256 (the text encoded as UTF-8), written in
   hexadecimal.
6. **The ID** is `MP` followed by the first 12 hexadecimal digits, in capitals:
   `MP2670FF90A5F2`.

Because the first name is part of it, twins get different IDs. Upper or lower
case, extra spaces, accents and the spacing of the postcode make no difference.
A different spelling, a nickname, a middle name, or a different postcode does: it
gives a different ID, which is why the hints above matter.

## Worked examples

Any implementation must give exactly these results.

| First name | Last name | Date of birth | Postcode | Text that is hashed | Participant ID |
| --- | --- | --- | --- | --- | --- |
| Jane | Smith | 2005-03-14 | LS2 9JT | `JANE\|SMITH\|20050314\|LS29JT` | `MP2670FF90A5F2` |
| ` jane ` | smith | 2005-03-14 | ls29jt | `JANE\|SMITH\|20050314\|LS29JT` | `MP2670FF90A5F2` |
| Élodie | O’Brien-Smith | 2003-11-02 | ls6 1ab | `ELODIE\|OBRIENSMITH\|20031102\|LS61AB` | `MP2E11B78F58BE` |
| Mary Jane | van der Berg | 2006-01-01 | M1 1AE | `MARYJANE\|VANDERBERG\|20060101\|M11AE` | `MP532156113C03` |
| Zoë | Ng | 2001-12-31 | EC1A 1BB | `ZOE\|NG\|20011231\|EC1A1BB` | `MPC464EEC6978B` |
| Amira | Khan | 2004-07-09 | BD1 1AA | `AMIRA\|KHAN\|20040709\|BD11AA` | `MP4B89BF282A5D` |
| Yasmin | Khan | 2004-07-09 | BD1 1AA | `YASMIN\|KHAN\|20040709\|BD11AA` | `MP33CE17327FF2` |

## Code for other platforms

JavaScript (any modern browser, for example in a survey question's custom
JavaScript; the date as `YYYY-MM-DD`):

```js
async function participantId(firstName, lastName, dateOfBirth, postcode) {
  const name = (s) => Array.from(s.normalize('NFKD').toUpperCase()).filter((c) => /\p{L}/u.test(c)).join('');
  const key = [name(firstName), name(lastName), dateOfBirth.replace(/-/g, ''), postcode.toUpperCase().replace(/[^A-Z0-9]/g, '')].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return 'MP' + hex.slice(0, 12).toUpperCase();
}
// participantId('Jane', 'Smith', '2005-03-14', 'LS2 9JT') gives 'MP2670FF90A5F2'
```

Python (for example to add the ID to a questionnaire export afterwards):

```python
import hashlib
import unicodedata

def id_name(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s).upper() if unicodedata.category(c).startswith('L'))

def participant_id(first_name, last_name, date_of_birth, postcode):
    """date_of_birth as 'YYYY-MM-DD'."""
    pc = ''.join(c for c in postcode.upper() if c.isascii() and c.isalnum())
    key = '|'.join([id_name(first_name), id_name(last_name), date_of_birth.replace('-', ''), pc])
    return 'MP' + hashlib.sha256(key.encode('utf-8')).hexdigest()[:12].upper()

# participant_id('Jane', 'Smith', '2005-03-14', 'LS2 9JT') gives 'MP2670FF90A5F2'
```

Any other language with SHA-256 works the same way; check it against the worked
examples before using it.

## Privacy

The ID is a pseudonym, not anonymous: anyone who knows a person's four details
can rebuild it. Treat it as personal data. The website keeps the four details
with the consent record, in the export's `identifying/` folder for study
coordinators only; the research dataset has only the ID (and age at consent).

## Before launch

Codes made under the earlier scheme (two letters, a digit, a month and two
letters, such as `JA101CD`) are no longer accepted. Delete the test records made
with them before the study opens.
