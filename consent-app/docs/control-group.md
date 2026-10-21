# The control group

Added 21 October 2026 (`decisions.md`). Controls do everything the break
group does except the break: two lab visits 30 to 35 days apart, their data
before the first and before the second, the day-15 check-in with a
screenshot and MyStory, and a short message every day. They carry on using
social media as usual between the visits. No Brick.

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
| Consent form | `mpmb-lab-consent` 2.1-draft | `mpmb-lab-consent-control` 1.0-draft: the "involves" statement says visits about 30 days apart with social media as usual; everything else the same |
| Information sheet | 2.2 | 2.2-control-draft: "What happens between the visits?" instead of the restriction section; risks and payment without the break |
| Check-in (day 15) | `mpmb-lab-checkin` | `mpmb-lab-checkin-control`: use compared with usual, mood, anything else |
| MyStory chat | `src/lab/mystory/{pre,mid,post}.toml` | `src/lab/mystory/control-{pre,mid,post}.toml` (0.1.0-draft), the same protocol reframed for usual use |
| Daily messages | the team's wording | the same days and structure, keeping in touch only: nothing about a break or about using social media more or less (`firebase/functions/src/dailyMessages.ts`) |
| Emails and calendar entries | "your 30-day break starts after this visit" | no break |

## In the data

* `participants.tsv` has a `group` column (`break` or `control`).
* `phenotype/checkin.tsv` has both groups' questions, with `form_id`
  saying which was answered.
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
