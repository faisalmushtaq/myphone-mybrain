# Schools' UPN lists

Schools taking part send the UPNs (unique pupil numbers) of the classes that
signed up, so the research team can match each pupil's records on the website
(the parent's permission, the young person's agreement, the questions, the
screenshots) with the school's. Each school has its own upload page and a
password the team gives it.

## For the team

1. On the staff page (<https://myphonemybrain.com/break/staff/>), **School
   uploads**: each school in `_data/schools.json` has its link,
   `https://myphonemybrain.com/schools/upload/?school=<slug>` (for example
   `?school=dua`), and **Make a password**. The password (three groups of
   four letters and digits, such as `K7QX-M3TB-9PWR`) is shown once; only a
   hash is kept. Send the link and the password separately: the link by
   email, the password by phone or text.
2. The school's member of staff opens the link, types the password, chooses
   the file exported from their management information system (CSV or
   Excel `.xlsx`, up to 5 MB), checks what was read (number of pupils, UPNs
   that can be used, classes, the first rows, rows to check, columns that
   are not read), gives their name, role and school email, and sends it.
   They get an emailed receipt; the team gets an email too.
3. A new password replaces the old one at once; **Close uploads** stops the
   page accepting files. Ten wrong passwords from one browser, or 25 for one
   school, in an hour, and the page refuses further tries for that hour.

To add a school, add a line to `_data/schools.json`; its page for parents
(`/<slug>/`) and its upload page follow on the next build.

## What is read

Only the study's columns are read, whatever the file calls them (most
systems' names are recognised: `UPN`; `Legal Forename`, `Forename`, `First
name`; `Legal Surname`, `Surname`, `Last name`, or a single `Name` column as
"Surname, Forename"; `DOB`, `Date of birth`; `Year`, `NC Year`, `Year group`;
`Reg Group`, `Form`, `Tutor group`, `Class`). Legal names are preferred to
preferred names. Dates are read the UK way (14/03/2012, 14-03-12, 14 Mar
2012) and Excel's own dates too. A UPN is 13 characters, a letter then
twelve digits (a temporary UPN ends in a letter); anything else, a missing
name, an unreadable date or a repeated UPN is listed as a row to check, and
the school can send the file anyway or fix it first.

The page asks schools to leave out every other column. Any that are sent are
not read, but stay in the file as it was sent.

## Where it goes

| | |
| --- | --- |
| Storage `schoolupns/<slug>/<id>/<file>` | the file exactly as sent (coordinators only) |
| Firestore `schoolUploads/` | who sent it and when, what was read (UPN, names, date of birth, year group, class) and the rows to check |
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
