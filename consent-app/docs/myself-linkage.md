# Linking the website to MySelf

The schools study collects data in two places at different times. Parents and
carers fill in the website (permission, their questions, screenshots), often
weeks before or after the young person sits the MySelf school survey in class.
Neither side waits for the other. Instead, both work out the same ID from the
same three details, and a script on a coordinator's computer joins the two
whenever someone wants up-to-date links.

> **4 November 2026: the main route is now online**, in the staff portal's
> linkage registry ([linkage.md](linkage.md)). This script still works, as a
> fallback and a cross-check; the portal gives the same automatic links.

## The ID

MySelf gives every pupil a participant ID such as `PNNTN6X2K00`: "P" and ten
characters worked out from the first name, last name and date of birth
(MySelf's `deriveParticipantId`, `packages/store/src/identity.ts`, decision
D-52). The website works out the same ID from what the parent typed
(`firebase/functions/src/myselfId.ts`). The tests pin both to IDs MySelf's own
code produced:

| First name | Last name | Date of birth | ID |
| --- | --- | --- | --- |
| Amara | Ahmed | 2012-05-04 | `PNNTN6X2K00` |
| Zoë | O'Neill-Bárta | 2010-01-31 | `P4NK3PPJCKA` (the same for "Zoe", "ONeill Barta") |
| Ben | Brook | 2011-11-11 | `P8153060583` |
| Mohammed | Khan | 2013-02-28 | `PJ8DHY9XY6R` |
| Anne-Marie | Smith-Jones | 2012-12-01 | `P703PDK6C3Y` |

The recipe: each name reduced to its letters and digits (accents removed,
lower case, so spaces, hyphens and apostrophes do not matter); SHA-256 of
`myself-participant-v1|<first>|<last>|<YYYY-MM-DD>`; the first 50 bits
written in Crockford base 32 after a "P". **Change neither copy without the
other**: a change on either side breaks every link silently.

When a parent and a pupil spell the name the same way and agree on the date,
the IDs match and nothing else is needed. They often don't: "Tom" at home and
"Thomas" at school, "Muhammad" and "Mohammed", 04/05 read as 5 April, one half
of a double-barrelled surname. So the export also lists, for each young person,
the IDs those slips would give, and the script tries them.

## What the export writes

Every hour, as part of the usual export (see `firebase.md`, "Getting the data
out"):

| File | What it adds |
| --- | --- |
| `schools/identifying/participants_key.tsv` | `myself_id`: the ID from the name and date the parent gave |
| `schools/identifying/myself_candidate_ids.tsv` | one row per other ID the young person might have, with its `kind`: `nickname` (a list of about 190 groups of UK first names, including Arabic and South Asian spellings, in `firebase/functions/src/nicknames.ts`), `dob-day-month-swapped` (when the day is 12 or less), `names-swapped`, `surname-part`, `first-name-part` (the first of two first names), `class-list-name` (the legal name on the school's class list, when the UPN match found a different first name) |
| `schools/donations/participants.tsv` | `myself_id`, in the research dataset, with a data-dictionary entry, so analysts can join on it directly where it matches exactly |
| `schools/upn-uploads/<school>/<date>_<id>_pupils.tsv` | `myself_id` for every pupil on the class list, from their legal name |

## Running the matcher

On the coordinator's own computer, against the OneDrive copy of the export
(`MyPhoneMyBrain/schools`), with MySelf's files beside it. Needs Node 18 or
later and nothing else.

1. From the MySelf researcher app, export the BIDS dataset (its
   `participants.tsv`) and, for names and UPNs, unlock the Linkage screen with
   the passphrase and download `myself_identifiers_<date>.csv`. Without the
   identifier file the script still links on IDs but cannot do fuzzy or UPN
   matching.
2. Run:

   ```sh
   node consent-app/scripts/match-myself.mjs \
     --website "$HOME/OneDrive - University of Leeds/MyPhoneMyBrain/schools" \
     --myself ~/Downloads/myself-bids/participants.tsv \
     --identifiers ~/Downloads/myself_identifiers_2026-11-20.csv \
     --out "$HOME/OneDrive - University of Leeds/MyPhoneMyBrain-linkage" \
     --html
   ```

   Optionally `--site-map site_map.tsv` (columns `site_code`, `school_id`: the
   MySelf site code issued to each school and the website's school id, such
   as `GSAL01` → `GSAL`), which keeps fuzzy matches within one school.
3. Read `summary.txt`. Open `review.tsv` (or `review.html` in a browser) and
   decide each pair: `link` or `reject` in the decision column (in the page,
   "Same person" or "Not the same", then "Save decisions" and put the saved
   `decisions-<time>.tsv` in the output folder).
4. Run the same command again. Decisions are copied into `decisions.tsv` and
   kept for every later run; the decided pairs leave the review list.
5. Enter each row of `myself_corrections.tsv` in MySelf (Linkage screen,
   record a correction: wrong code → right code), so MySelf's own exports
   treat the two codes as one pupil.

Run it whenever new data have come in on either side; it starts from scratch
each time apart from the decisions.

### How it decides

Strongest first. A pair links on its own only when, at that tier, it is the one
candidate on both sides; anything else goes to review.

1. **Decisions** already made by a person.
2. **Exact**: the website's `myself_id` is a MySelf code.
3. **Variant**: one of the candidate IDs is a MySelf code
   (`variant:nickname`, `variant:dob-day-month-swapped`, …).
4. **UPN**: MySelf's linked UPN equals the one the website's record matched on
   the school's class list; or a MySelf code equals a class-list pupil's
   `myself_id` and that pupil's UPN is matched to a website record
   (`upn:class-list`).
5. **Fuzzy**: names compared with Jaro-Winkler (first and last, also the wrong
   way round), date of birth the same, one digit off, or day and month
   swapped, and the postcode. **Always reviewed**, never linked on its own; a
   MySelf record with more than one plausible website record is marked
   ambiguous (twins, siblings).

A website record that already has a link and fits a second MySelf code goes to
review ("second MySelf code"): if a person decides both are the same young
person, the weaker code goes into `myself_corrections.tsv` (the right code is
the one their name and date give, otherwise the one with more sittings).
One MySelf code fitting two website records (twins, or one child registered by
both parents) is never linked on its own.

### The output folder

| File | |
| --- | --- |
| `links.tsv` | website label and record id, MySelf ID, the tier, `auto` or `reviewed` |
| `review.tsv` | the pairs to decide, both sides' details, why, the score, a `decision` column |
| `review.html` | the same as a page (with `--html`) |
| `decisions.tsv` | every decision so far: keep it; the script reads it on every run |
| `unmatched_website.tsv`, `unmatched_myself.tsv` | records with no link, and whether they are in review |
| `myself_corrections.tsv` | `wrong_code`, `right_code`, `reason`, for MySelf's Linkage screen |
| `summary.txt` | the counts |

## Privacy

- The ID is a **pseudonym, not an anonymisation**: anyone with a young
  person's name and date of birth can recompute it. That is MySelf's design
  (its key is a fixed public string, not a secret), so that a pupil gets the
  same ID every sitting without anyone holding a list. The website's
  `myself_id` adds nothing MySelf's own research data does not already carry.
- `myself_candidate_ids.tsv` lists names and dates, so it sits in
  `identifying/`, coordinators only. The research dataset carries only the
  exact `myself_id`.
- The script runs locally and writes only to `--out`. Every output file other
  than `links.tsv` and `summary.txt` holds names or dates of birth: keep the
  folder with the identifying data (the University OneDrive, not Google
  Drive), and do not email it.
- A link is a research decision: when in doubt, reject. An unlinked record
  loses one join; a wrong link mixes two children's data.
