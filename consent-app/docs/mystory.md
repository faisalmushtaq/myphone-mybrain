# MyStory: micro-narratives in the break study

MyStory asks participants for a short story in their own words, then a few
quick questions that place the story (the SenseMaker-style "signifiers"): a
triangle (how much the story was about each of three things, in any mix),
sliders between two ends, and quick choices. Each phase of the break study
asks its own prompts and signifiers, so the stories answer what each phase
is about, without repeating MySelf.

## What is built

| Phase | Structure (`src/lab/mystory.ts`) | Where it is asked |
| --- | --- | --- |
| Before the break (`pre`) | `mystory-pre`: a recent moment with the phone, a typical evening, a time social media changed how they felt; the triangle *connecting with people / passing the time / finding things out*; sliders *worse–better* and *not my choice–completely my choice*; which app; how they feel about it now | **At the first lab visit**, on the lab computer, from the link on the staff page (`/break/mystory/?phase=pre&at=lab&code=MP…`) |
| During the break (`mid`) | `mystory-mid`: a moment they wanted to open an app, what they did instead, what surprised them; the triangle *habit / people and connection / boredom or stress*; sliders *easy–very hard* and *worse–better*; where they were; how they feel now | **After every weekly check-in** (optional, with "Skip this time"), and `/break/mystory/?phase=mid` |
| After the break (`post`) | `mystory-post`: the moment that mattered most, the first time back on the apps, what they will do differently; the triangle *my time / my mood / my relationships*; sliders *harder–easier than expected* and *much less–much more than before*; would they do it again; how they feel now | **At the second lab visit**, on the lab computer, from the link on the staff page (`/break/mystory/?phase=post&at=lab&code=MP…`) |

Every signifier can be left out or answered "not sure", as in SenseMaker. The
triangle works by touch, mouse and keyboard (arrow keys), and says its value
in words for screen readers ("Mostly Habit (60%), then …").

The prompts and signifiers are **drafts** written for this site (version
`0.1-draft`), to be replaced by the team's own. Changing them is editing
`src/lab/mystory.ts`: bump the `version`, and the server, the validation and
the export's data dictionary follow at the next build.

Stories are stored in Firestore `labStories/`, labelled by participant ID and
phase, linked to the check-in they followed, and exported every hour as
`social-media-break/donations/phenotype/mystory_pre.tsv`, `mystory_mid.tsv`
and `mystory_post.tsv`, each with a `.json` data dictionary: one row per
story, the triangle as three shares adding up to 1, the sliders from 0 to
100, the choices as their values, and for every signifier a `_status`
column (`answered`, `not-sure`, `skipped`).

## Using MySelf's own micro-narrative instead

Each phase can be switched, independently, to another survey (MySelf, for
example) in `labMyStory.phases` in `src/lab/mystory.ts`:

```ts
mid: { mode: 'link', name: 'MySelf', url: 'https://leeds.eu.qualtrics.com/jfe/form/SV_xxxxxxxx', idParam: 'pid', phaseParam: 'phase' },
```

- `mode: 'native'`: this site's own form (as now).
- `mode: 'link'`: a button opens the survey in a new tab.
- `mode: 'embed'`: the survey is shown inside the page (an iframe), with a
  link to open it in a new tab if it does not show properly. Optional
  `height` in pixels.

In both `link` and `embed`, the survey's address gets the participant ID and
the phase added: `…/SV_xxxxxxxx?pid=MP2670FF90A5F2&phase=mid`. Everything else
stays the same: the check-in still ends with MyStory, the emails and the
staff page carry the same personal links, and the participant ID matches the
one MySelf builds from the same four details (`docs/participant-id.md`).

## Options, compared

**1. This site's own MyStory (built, live tonight).** The stories are
told in the website's look, inside the flow (after each check-in), with the
participant ID filled in, and land with the rest of the break study's data,
already in the export with a data dictionary. Separate structures per phase
are a few lines of configuration. What it does not do by itself: put the
stories into MySelf's dataset. If the two need analysing together, the
export's TSVs load beside MySelf's data by participant ID, or (option 4) the
server can also write each story into a Qualtrics survey.

**2. Link out to MySelf with the ID (one line of configuration).** If MySelf
runs on Qualtrics: in the MySelf survey's Survey flow, add an **Embedded
Data** element at the very top with two fields, `pid` and `phase`, each "Value
will be set from Panel or URL" ([how](https://research-it.wharton.upenn.edu/tools/qualtrics/longitudinal-surveys-in-qualtrics/)).
Qualtrics then records both with every response. Branch on `phase` to show
each phase its own micro-narrative block, so one survey serves all three
phases without duplicating MySelf's other blocks. Set `mode: 'link'` here
with that survey's address. Least work for the team; participants leave the
site's look for Qualtrics' (which can be themed, below).

**3. Show MySelf inside the page (embed).** The same survey and fields as
option 2, shown in an iframe within the site (`mode: 'embed'`). To make it
look like the site, set the survey's **Look & Feel** to the site's colours and
fonts, or paste custom CSS there (for example a transparent background so the
page shows through; [Qualtrics: Look & Feel](https://www.qualtrics.com/support/survey-platform/survey-module/look-feel/advanced-look-feel-settings/)).
Two things to check first with a test survey: that the University's
Qualtrics allows its surveys in frames on another site (most do; some
organisations block it), and the height (Qualtrics pages vary in length, so
a fixed height may need scrolling inside the frame). Mobile browsers handle
this well; the "open in a new tab" link covers the rest.

**4. This site's form, written into MySelf's Qualtrics survey (not built;
about a day).** Keep option 1's form and flow, and have the server also post
each story to the MySelf survey through the Qualtrics API ("Create a new
response", or the [response import](https://developers.qodex.ai/qualtrics-public/surveys-response-import-export-api/surveys-surveyid-import-responses/start-response-import-1)),
mapping prompt, title, story and signifiers to the survey's question IDs.
Needs an API token for the Leeds Qualtrics account (the University's licence
must allow API access), kept in Secret Manager like the other keys. Best of
both: the site's look and flow, and the stories in MySelf's dataset too.

**5. A dedicated SenseMaker-style platform.** If MySelf's micro-narrative is
built on SenseMaker (The Cynefin Co) or a similar tool, its own capture page
can be linked or embedded exactly as in options 2 and 3, as long as it can
read the participant ID from the address. Its signifier designer is richer
(stones, canvases), at a licence cost.

**Recommendation.** Run with option 1 now (it works today, keeps everything
in one place and in the site's look), and send the team's MySelf prompts and
signifiers to replace the drafts. If MySelf's micro-narrative must stay the
single source, switch the phase to option 2 or 3 (one line each); if the
data should live in both, option 4 is the clean way.

## The pages

Decided 7 October 2026 (`decisions.md`): MyStory runs on this site's own
form; during the break it follows **every weekly check-in**; before and after
the break it is told **at the lab visits**, on a lab computer. The drafts
stay until MySelf's prompts and signifiers arrive.

- After each check-in: `/break/check-in/` → MyStory → summary.
- At a lab visit: on the staff page, **Participants** → the participant →
  **At the lab** → copy the link for that visit, open it on the lab
  computer, press Continue to confirm the ID, and hand it over. The page
  keeps nothing on the computer; after **Send my story**, **Finish** clears
  it for the next person.
- On its own, from a personal link: `/break/mystory/?phase=mid&code=MP…`
  (the staff page lists it; the `pre` and `post` pages also work this way,
  for anyone who could not tell their story at the visit).
