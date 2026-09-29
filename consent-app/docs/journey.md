# Consent and screen-time donation: user journey (v2)

This document defines who does what, in which order, and where the device
changes hands. `src/model/journey.ts` is the executable version.

Version 2 shortens the journey from ten screens to five (six on the young
person's route) after testing showed the first version was clear but slower
than it needed to be. What changed and why is at the end.

## Design principles

1. **One screen per purpose, no read-only screens.** Every screen asks for
   something. Explanations sit beside the question they support, folded
   until needed.
2. **Always clear who is holding the phone.** Every step has an *actor*. A
   full-screen handover appears whenever the device must change hands, and
   the strip under the progress bar names whose section is open.
3. **Consent is captured from the parent directly.** Name, relationship,
   parental responsibility, active choices, and a signature. A young person
   cannot tick a box saying a parent agreed.
4. **The required statements are one confirmation; the permissions are
   separate choices.** The four statements needed to take part sit under one
   tick (each is still recorded individually, marked `via: 'group'`). The
   three optional permissions (screenshots, linking with records already held through Connected West Yorkshire, and recontact) are explicit Yes/No rows with no default.
5. **The young person's agreement is their signature.** The three things it
   means are listed above the box. Saying no and deciding later are equally
   visible. Sharing screenshots is agreed by doing it (pressing send), and
   skipping is always available.
6. **Review is available, not compulsory.** The send screen shows a four-line
   summary; the full record with change links is one tap away.
7. **Identifying details are kept apart from research data**, in the model,
   the payload, the database collections and on screen.
8. **Nothing sensitive stays in the browser.** Progress lives in
   `sessionStorage` for the tab, expires after two hours or 30 minutes of
   inactivity, and is cleared on send. Images are never stored in the browser.

## The two ways in

| | Route P: parent or guardian starts | Route Y: young person starts |
|---|---|---|
| Typical situation | Parent opens the link at home | Young person opens it with a parent present |
| Details | One screen: the child's details and the parent's own | The young person's details, then a handover, then the parent's own |
| Handovers | Parent → young person, after permission | Young person → parent before the parent's details; parent → young person after permission |

## Steps

Actors: **P** parent/guardian, **Y** young person, **A** anyone.

| # | Step id | Actor | What happens |
|---|---|---|---|
| — | `welcome` | A | Choose who is starting; what the study is (folded); three reassurances. Not counted as a step. |
| 1 | `child-details` | route | Names, date of birth, school, year group. Route P also asks for the parent's name, relationship, parental-responsibility confirmation and email here (phone and postcode folded, optional). |
| — | *handover Y→P* | | Route Y only. |
| 2 | `parent-details` | P | Route Y only: check the child's details, then the parent's own. |
| 3 | `parent-consent` | P | **One screen.** Six one-line information summaries (each opens to the full wording, with links to the full sheet and privacy notice and the information version); the four required statements under one tick; three Yes/No permissions; name (pre-filled from the details), signature, date. |
| — | *handover P→Y* | | Route P offers "{child} isn't here right now" (agreement deferred, screen-time skipped). |
| 4 | `child-assent` | Y | Three-line recap; "Signing your name means…" with the three statements; signature (draw, or type first name). "I don't want to take part" and "I'd like to decide later" alongside. |
| 5 | `phone-use` | A | **One screen.** Why we ask (folded); which phone (chips); how to find the summary (illustrated steps, open until images are added); add, check, hide parts of, and send screenshots; skip. |
| 6 | `send` | A | Four-line summary (young person, permission with yes/no choices, agreement, screen time), "Review everything before sending" (full record with change links, contact details masked), Send. |
| — | `done` | A | Reference code, what happens next, changing your mind, independent contact, "Finish and clear this device". |

Route P is five counted steps; route Y is six.

### Branching rules

* Parent declines screenshots → step 5 removed; the send screen says "Not sharing".
* Young person presses "I don't want to take part" → `assent-declined`: "Let the team know" (sends a minimal record: names, school, parent's name and email, no permission record) or "Finish without sending anything".
* Young person presses "I'd like to decide later", or the parent says the young person isn't here → agreement `deferred` (with who deferred it), step 5 removed, the send screen says so.
* Age outside 11–17 → specific message (an 18-year-old consents for themselves; the team will send that form).
* A permission statement changed after signing → signature cleared, "please sign again".

### Handover screens

Addressed to the person receiving the device, with their name on the button.
The parent → young person handover explains why a parent also signs ("because
you're under 18, research rules need their permission as well as yours — your
answer still counts") and asks the parent to let the young person answer
themselves. Handover confirmation and agreement start/finish times are
recorded so the server can flag an agreement completed within seconds.

## What changed from v1, and why

| v1 | v2 | Why |
|---|---|---|
| Welcome, then "About the study" | About folded into Welcome | The about screen asked for nothing; the same three facts now sit under the route cards. |
| Child details, then parent details (both routes) | One details screen on the parent route | The same person was filling in both. |
| Information screen, then consent screen | One permission screen | Reading and agreeing belong together; the summaries are visible and the detail opens in place. |
| Four required checkboxes | One confirmation tick over a list (configurable) | Four ticks for statements that must all be yes added nothing but time. Each is still recorded individually. |
| Optional permissions as large cards with Yes/No buttons | Compact Yes/No rows | Same explicit choice, a third of the height. |
| Young person: two checkboxes, two Yes/No choices, typed name | One signature over a three-line list; screenshot consent by sending | Signing is a single clear act; the "phone-use" statement is now recorded by the action it refers to. |
| Phone type, then walkthrough, then upload (three screens) | One screen | Most families know where Screen Time is; the instructions open when needed and fold once images are added. |
| Full review page before sending | Four-line summary with the full record one tap away | Families who want to check everything still can; everyone else sends. |
| Name typed again on the consent screen | Pre-filled from the details | Same person, moments later. |
| Phone and postcode always shown | Folded behind "Add a phone number or home postcode (optional)" | Shorter screen; both remain available. |
