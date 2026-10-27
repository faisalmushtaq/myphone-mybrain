# Opting out of the workshop

Decided 7 October 2026 (`decisions.md`): the workshop at school (EEG), and
linking with records through Connected West Yorkshire, are **opt-out**, as
one. Sharing screen time is a separate **opt-in** on the website.

Since 19 October 2026 there are **two kinds** of opt-out:

* **Workshop and data** (`workshop-and-data`): the young person does not take
  part in the workshop, and none of their information is used or linked.
  Every opt-out logged before then is this kind.
* **Data only** (`data-only`): the young person takes part in the workshop
  with their class, but nothing recorded about them is kept or used for the
  study, and nothing is linked with their records.

## How a parent or carer opts out

Only by **email to S.A.Ali1@leeds.ac.uk (Dr Sarmad Ali)**, from a parent or carer. There is no
form and no paper slip. The website adds deliberate friction first:

1. "Opt out of the workshop" on the form's first page (or a link with
   `?optout=1`, from each school's page and the FAQ) opens **Before you opt
   out**: what the young person would miss, that it also means no linking, and
   that the phone part needs no opt-out at all (just don't fill in the form).
2. **What would you like?** The parent chooses one of the two kinds.
3. **Are you sure?** Worded for the kind chosen. The young person will not take part with their class and
   none of their information will be used; after the workshop, opting out
   withdraws the data too, as far as is still possible. (For data only: the
   young person takes part, but none of their information is kept or used.)
4. **How to opt out**: the address, what to include (the young person's full
   name, school, class or year group, the parent's name and that they are the
   parent or carer), a "Write the email" button that opens a ready-made email
   (with the school filled in when the page came from a school's link), and
   "Copy the address". The email's subject says which kind: "Opt out:
   MyPhone/MyBrain workshop and study" or "Opt out of data use:
   MyPhone/MyBrain (workshop is fine)".

The website records nothing about this. `src/steps/OptOut.tsx` has the wording.

## When an email arrives

Reply to confirm, then log it on the staff page
(<https://myphonemybrain.com/staff/>) → **Opt-outs** → **Log an opt-out
email**: **what the parent asked for** (workshop and data, or data only), the young person's names and school (needed to find them), year group
or class, date of birth if the email gives one, the parent's name, the day it
arrived, and whether it came **after the workshop** (then the data already
collected is to be withdrawn, as far as possible). A parent who changes their
mind: **Opted back in?** keeps the entry, marked cancelled.

## What the export does with it

Every hour (`firebase/functions/src/exportUpn.ts`, `export.ts`):

| File | |
| --- | --- |
| `schools/identifying/opt_outs.tsv` | every logged opt-out and its `kind`, with the website record and the school UPN it names, if any |
| `schools/upn-uploads/upn_matches.tsv`, `upn_unmatched.tsv` | `opted_out`, `opt_out_kind` and `opt_out_id` for each pupil an opt-out names |
| `schools/identifying/participants_key.tsv` | `opted_out` and `opt_out_kind` for each family record on the website |
| `schools/donations/participants.tsv` | `opted_out` and `opt_out_kind`, so a record can be left out of analysis |

Matching is by school and names, compared the way the UPN matching compares
them (accents, spaces, hyphens and capitals ignored), and by date of birth
when both have one. Nothing is deleted automatically: the flags tell the team
what to remove or withhold. For a `data-only` opt-out the young person is
still in the workshop: the team needs to know on the day, or soon after, whose
EEG recording is not to be kept.
