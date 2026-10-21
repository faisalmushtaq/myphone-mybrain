# The control group

Added 21 October 2026, changed 22 October 2026 (`decisions.md`). Controls
have two lab visits 30 to 35 days apart, send their data before the first
and before the second, and tell MyStory (with their own questions) after
each send. Between the visits they carry on using social media as usual:
no break, no Brick, **no check-in and no daily messages**, just one
reminder a week before the follow-up visit (with the link for sending their
data again), besides the usual reminders the day before and on the day of
each visit. The wording is final (22 October 2026).

## How it works

* **Their own first page: <https://myphonemybrain.com/break/control/>.**
  Send controls this link instead of `/break/take-part/`. It is the same
  app with `data-group="control"`, so they see the control consent form,
  information sheet and wording. The group is kept with their consent
  (`group: 'control'` on `labParticipants` and `labConsents`).
* **Every later page is shared** (check-in, after, booking, MyStory). Each
  takes the group from the participant's record; the links the system sends
  to controls carry `?group=control` so the page uses their words from the
  first screen.
* **Someone already in one group cannot sign the other group's form**: the
  server refuses it.

| What | Break group | Control group |
| --- | --- | --- |
| Consent form | `mpmb-lab-consent` 2.1-draft | `mpmb-lab-consent-control` 1.1: the "involves" statement says visits about 30 days apart with social media as usual (no check-in); everything else the same |
| Information sheet | 2.2 | 2.2-control: "What happens between the visits?" instead of the restriction section (the reminder a week before the second visit); risks and payment without the break |
| Check-in (day 15) | `mpmb-lab-checkin` | none: the page says there is no check-in, and the server refuses one |
| MyStory chat | `src/lab/mystory/{pre,mid,post}.toml` | `src/lab/mystory/control-{pre,post}.toml` (0.1.0, final), their own questions about usual use (`control-mid.toml` is kept but no longer used) |
| Messages between the visits | daily, with the check-in link on day 15 | one reminder, 7 days before the follow-up visit at 09:00 (`firebase/functions/src/dailyMessages.ts`) |
| Emails and calendar entries | "your 30-day break starts after this visit" | no break |

## In the data

* `participants.tsv` has a `group` column (`break` or `control`).
* `phenotype/checkin.tsv` has the break group's check-ins (controls have
  none since 22 October 2026).
* The chats are in `phenotype/mystory_chat_<phase>.tsv` (break) and
  `phenotype/mystory_chat_control_<phase>.tsv` (control): their questions,
  and so their `said_*` columns, differ.
* The staff page's participant list and detail show the group; the
  detail's "take part" link is the control page for controls.

## Not done yet

* MyStory's written form (only used when the chat cannot start) still has
  the break group's prompts for every group.
* The page addresses keep `/break/` in them (for example
  `/break/check-in/`), which controls can see in their links.
