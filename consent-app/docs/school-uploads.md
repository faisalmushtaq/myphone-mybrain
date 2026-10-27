# Schools' UPN lists

Schools taking part send the UPNs (unique pupil numbers) of the classes that
signed up, so the research team can match each pupil's records on the website
(the parent's permission, the young person's agreement, the questions, the
screenshots) with the school's. Each school has its own upload page and a
password the team gives it.

## For the team

1. On the staff page (<https://myphonemybrain.com/staff/>), **School
   uploads**: each school in `_data/schools.json` has its link,
   `https://myphonemybrain.com/schools/upload/?school=<slug>` (for example
   `?school=dua`), and **Make a password**. The password (three groups of
   four letters and digits, such as `K7QX-M3TB-9PWR`) is shown once; only a
   hash is kept. Send the link and the password separately: the link by
   email, the password by phone or text.
2. The school's member of staff opens the link, types the password, chooses
   their class list (Excel, CSV, Word, PDF or plain text, up to 50 MB; a
   file the page cannot read is still sent, marked to be read by hand), checks what was read (number of pupils, UPNs
   that can be used, classes, the first rows, rows to check, columns that
   are not read), gives their name, role and school email, and sends it.
   They get an emailed receipt; the team gets an email too.
3. A new password replaces the old one at once; **Close uploads** stops the
   page accepting files. Ten wrong passwords from one browser, or 25 for one
   school, in an hour, and the page refuses further tries for that hour.

To add a school, add a line to `_data/schools.json`; its page for parents
(`/<slug>/`) and its upload page follow on the next build.

## What is read

Only the UPN, the names (first, middle, last) and the date of birth are read
(27 October 2026), whatever the file calls them (most systems' names are
recognised: `UPN`; `Legal Forename`, `Forename`, `First name`; `Middle name`;
`Legal Surname`, `Surname`, `Last name`, or a single `Name` column as
"Surname, Forename"; `DOB`, `Date of birth`). Year group, class and every
other column are listed as "not read". Legal names are preferred to
preferred names. Dates are read the UK way (14/03/2012, 14-03-12, 14 Mar
2012) and Excel's own dates too. A UPN is 13 characters, a letter then
twelve digits (a temporary UPN ends in a letter); anything else, a missing
name, an unreadable date or a repeated UPN is listed as a row to check, and
the school can send the file anyway or fix it first.

The page and its template ask for those columns only, and ask schools to
leave out every other column. Any that are sent are not read or stored in the
database, but stay in the file as it was sent (coordinators only). The file is
kept as sent so the team can check what the reader made of it, and because a
file the website cannot read is read by hand; a school that sends extra
columns can be asked to send the list again without them.

## Where it goes

| | |
| --- | --- |
| Storage `schoolupns/<slug>/<id>/<file>` | the file exactly as sent (coordinators only), until it names an opted-out pupil: then it is deleted, and what was read from it, redacted, is the record (26 October 2026; a file read by hand is kept, and the team removes the pupil's details by hand) |
| Firestore `schoolUploads/` | who sent it and when, what was read (UPN, names, date of birth) and the rows to check |
| Storage `schoolquarantine/<session>/<id>` | a file over 7 MB, put there by the browser before the function reads it (the call itself cannot carry more than about 7 MB); deleted once sent, or after a day if never sent. The browser can create and delete its own only, never read it |
| Firestore `schoolUploadAccess/<slug>` | the password's hash (scrypt), when it was made, whether uploads are open |

Within the hour the export writes a separate folder, beside `donations/`
and `identifying/`:

```
schools/upn-uploads/
  README.md
  uploads.tsv                       one row per file: school, sender, when, counts
  dua/2026-10-07_1a2b3c4d_Year 8.csv          the file as sent
  dua/2026-10-07_1a2b3c4d_pupils.tsv          what was read from it
  upn_matches.tsv                   each family's record with the UPN it matches
  upn_unmatched.tsv                 pupils on a school's list with no record here
```

`upn_matches.tsv` gives, for every family record at a school that has sent
a list, the matching UPN and how sure the match is: `name-and-dob` (first
name, last name and date of birth agree), `surname-and-dob` (the first name
differs: a short name, perhaps; check), `name-only` (the date of birth
differs or is missing; check), `ambiguous` (more than one pupil fits; check
by hand) or `none`. Names are compared ignoring accents, spaces, hyphens and
capitals. When a UPN appears in more than one file from a school, the latest
file wins. `participant_id` is the record's label in `schools/donations/`.

## Data protection

UPNs, names and dates of birth are identifying: the files, the tables and
the matches are for study coordinators only, like `schools/identifying/`.
The upload page is not linked from anywhere and not indexed, needs the
school's own password, and the files are never public. Retention follows the
study's: the UPN lists can be deleted from the database once matching is
done (`scripts/delete-record.mjs` style), and the export removes them on its
next run.

## Opted-out pupils (26 October 2026)

Since 27 October 2026 the class list asks only for the UPN, the legal first,
middle and last names and the date of birth. For a pupil whose parent or
carer opted them out, only what honours the opt-out is kept: names, school
and UPN, with the opt-out's kind and date. `firebase/functions/src/schoolRedact.ts`
blanks the date of birth in `schoolUploads/`, so the export never carries it,
and deletes the original file once it names an opted-out pupil, if the website
read it (the parsed rows and the file's SHA-256 remain). It runs when an
opt-out is logged on the staff page, when a school sends a list, and before
every hourly export. A cancelled opt-out does not bring the date of birth back:
ask the school to send the list again. The OneDrive mirror moves the deleted
file to "MyPhoneMyBrain removed", emptied after 90 days.

Lists read between 19 and 27 October 2026 used the fuller Born in Bradford
template (gender, ethnicity, year group, form tutor, class, address, postcode,
school email, FSM, SEN). The same pass removes those fields from every stored
pupil (`LEGACY_FIELDS`), opted out or not, so the export no longer carries them.
A file kept as the school sent it still holds whatever columns it had; the team
should delete or redact any such file by hand.
