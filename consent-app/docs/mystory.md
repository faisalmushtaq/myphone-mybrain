# MyStory: micro-narratives in the break study

MyStory asks participants for a short story in their own words, then a few
quick questions that place the story (the SenseMaker-style "signifiers"): a
triangle (how much the story was about each of three things, in any mix),
sliders between two ends, and quick choices. Each phase of the break study
asks its own prompts and signifiers, so the stories answer what each phase
is about, without repeating MySelf.

## What is built

> Since 20 October 2026 the before and after chats happen on the website, before booking and after the second set of screenshots, using the AI interview (MyStory chat) described below. The table records the earlier structured version, kept as the written fallback.

| Phase | Structure (`src/lab/mystory.ts`) | Where it is asked |
| --- | --- | --- |
| Before the break (`pre`) | `mystory-pre`: a recent moment with the phone, a typical evening, a time social media changed how they felt; the triangle *connecting with people / passing the time / finding things out*; sliders *worse–better* and *not my choice–completely my choice*; which app; how they feel about it now | **At the first lab visit**, on the lab computer, from the link on the staff page (`/break/mystory/?phase=pre&at=lab&code=MP…`) |
| During the break (`mid`) | `mystory-mid`: a moment they wanted to open an app, what they did instead, what surprised them; the triangle *habit / people and connection / boredom or stress*; sliders *easy–very hard* and *worse–better*; where they were; how they feel now | After the one check-in on day 15 (required, no skip), and `/break/mystory/?phase=mid` |
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

## The AI chat (13 October 2026)

Every phase now runs MyStory as a **chat with Remi** ("Reflecting on Everyday
Media Interactions"): the MySelf MyStory protocol (the KCL micro-narratives
method, Skeggs et al., CHI 2025, https://doi.org/10.1145/3706598.3713999),
embedded in the break study's pages, with the team's own protocol for each
phase. The site's own form (above) stays, one click away ("I'd rather write
my story myself"), and is used automatically until the OpenAI key is stored.

**What the participant does.** Start the chat (it opens full screen, like a messaging app: Remi's name and a **Help** button with the support numbers at the top, the reply box at the bottom) → Remi introduces itself as an
AI and asks the phase's questions one at a time, with the protocol's
follow-ups → three short retellings of what they said, all in the first
person (plain, casual, reflective) → pick the closest → rate it from 0 to 10
→ below 10, edit it themselves or ask Remi to change it (and put the previous
version back) → **Keep this story**. The last page has the support numbers
the protocol points to. About fifteen minutes.

**One protocol per phase**, the team's files (Michelle Wain, 13 October 2026),
in MySelf's own TOML format, so the same file loads in MySelf's MyStory studio
and here:

| Phase | File | Questions | Extracted |
| --- | --- | --- | --- |
| Before (`pre`, first lab visit) | `src/lab/mystory/pre.toml` (`np.sm_abstinence_pre`) | 6: when they use it most (and whether feelings lead them to it), whether it impacts other areas of life, mental health, how they feel after, putting it down, how they feel about the 30 days off | 10 keys |
| During (`mid`, after each check-in) | `src/lab/mystory/mid.toml` (`np.sm_abstinence_mid`) | 5: how it has affected them so far, a moment that stood out (including anything physical), what they do instead, wanting to go on, turning to anyone for support | 14 keys |
| After (`post`, second lab visit) | `src/lab/mystory/post.toml` (`np.sm_abstinence_post`) | 5: how the 30 days have been, anything different in how social media affects their mental health, what they missed, are they back on (and has the way they use it changed), what they will take forward | 18 keys |

**Safeguarding declaration and control opening (26 October 2026; pre 0.2.2, mid and post 0.2.3, control pre and mid 0.1.2, control post 0.1.3).** The safeguarding declaration no longer says participants are anonymous and not contacted: the team holds names and contact details and reviews flagged conversations after the session. The control group's first chat opens with "before your first lab visit", as it runs before booking.

**Safeguarding declaration (27 October 2026; pre 0.2.3, mid and post 0.2.4, control pre and mid 0.1.3, control post 0.1.4).** All six protocols' `safeguarding_declaration` now says what participants are told: conversations are stored under the participant ID without the name, the team reads them only for research, does not use them to identify participants and will not contact them about what they write, and support numbers are under the Help button. The team reviews flagged conversations under the participant ID. The same wording is on the MyStory start page ("About Remi") and in the information sheets (version 2.3). Nothing else changed.

**Age range (26 October 2026; pre 0.2.1, mid and post 0.2.2, control pre and mid 0.1.1, control post 0.1.2).** All six protocols now describe participants as young adults aged 18 to 24, matching the break study's age range (they said first-year students aged 18 or 19), and `age_max` is 24. Nothing else changed.

**0.2.0 (19 October 2026): the team's update after testing (Michelle Wain).**
In all three: before each question the interviewer checks whether it has
already been answered, even in other words, and if so sums up what was said
and asks if there is anything else; asked "what do you mean?", it says the
question again more simply with an everyday example; the stories must make
sense on their own (never "it'll help" without saying what) and include what
they expect, or how it went. Before: a follow-up on whether feelings lead
them to social media; "Does social media impact other areas of your life?",
naming uni, socialising and friends only if not covered; "How are you feeling
about having 30 days off social media?" last. During: no "Hi again" (the chat
already greets them); differences in uni, work or relationships; whether they
noticed anything physically; when they already said they went on, other times
they wanted to but didn't and how they managed; a new last question, "Have
you turned to anyone for support during the break?" (two new extraction keys,
`physical_feelings` and `support_seeking`). After: "How has the 30 days off
social media been for you?", "Since the break, have you noticed anything
different about how social media affects your mental health?", and after "are
you back on social media?", "Has the way you use social media changed at all
since the break?". The support message now points to "the numbers under the
help icon at the top of the page, or on the participant information sheet"
(the online sheet gained a "Where can I get support?" section with the same
numbers), and the safeguarding reply offers to "pause for a while, stop here,
or carry on". The team's files were made from an earlier copy, so the fixes
below are kept on top of them.

Three fixes were needed for the files to load, each noted at the top of the
file: the example conversation's closing quote escaped, the closing quote on
`research_question`, and `max_turns` 22 → 20 (MySelf's own limit; its checker
refuses more). Wording fixes in `0.1.1` (14 October 2026): the before-break intro's
"what's not quite right it" corrected; every pointer to support ("the
participant information sheet", "the last page", "the study information
page") now says to tap **Help** at the top of the chat, which shows the
numbers (they are also on the last page); the mid-break question "Can you take me
through a moment…" asked as "Can you tell me about a moment…", as the
protocol's own language rule asks; "take a break, stop here, or carry on" in
all three; "secret code" replaced by "participant ID"; the select text no
longer repeats "I think I have…" straight after the outro; the adapt text
says the story can be edited directly. `{first_name}` in the on-screen text is filled in on the
participant's device from the details they typed, and left out when the page
does not know it ("Hi, I'm Remi"); it never reaches the server or the model.

To change one: edit `[collection] questions`, `[summaries.questions]` (one key
per thing to pull out of the answers), `[summaries.personas]` (the voices),
`[example]` and the words on screen in `[myself]` (`outro`, `select_text`,
`rate_text`, `adapt_text`, `debrief_text`, their `_lede`s, `fallback_text`).
Bump `[myself] version`, push, and the server picks it up at the next deploy.
Check it first with MySelf's checker, which prints every screen as a
participant reads it:
`pnpm --filter @myself/narrative check <path to the .toml>` (in the MySelf
repository). The build checks the file too and stops if one cannot run.

**How it runs.** The page sends only what the participant types and taps.
The server (`firebase/functions/src/storyChat.ts`) holds the protocol and the
OpenAI key, assembles MySelf's four prompts word for word (interviewer,
extraction, persona retelling, adaptation: `storyPrompts.ts`), asks for
structured output and checks it against the schema, and saves every step as
it happens, so a conversation left halfway is still data. As in MySelf, the
interview ends when the model says every question is answered (a field in its
output, not a word a participant could type) or at `max_turns`; the
interviewer's closing reply is discarded; extraction runs cold and uses only
the participant's words; the three personas write at the same time; a 10 skips
the changes. If the model fails, the participant's own answers are kept as
their story (`continue_without_model`).

**Speaking instead of typing** (14 October 2026, MySelf's voice feature,
ported from `apps/mystory-lab/web/main.ts` and `apps/functions/src/transcribe.ts`).
With the reply box empty, the microphone shows in its place. **Hold** it to
talk, as in WhatsApp: slide left to cancel, slide up to lock it on; let go and
it is written down. A quick **tap** starts a recording that stays on, for
anyone the hold does not suit; tap again (the square) to stop. While
recording: a timer, a live waveform of their voice, Cancel, and a send button
that stops, writes it down and sends in one press. Otherwise the words arrive
in the reply box, highlighted, to be read and corrected before sending; the
sent answer shows the recording as a voice note they can play back. Clips are
capped at 2 minutes and 4 MB, 40 per conversation. The clip goes to the
site's own server (`labStoryVoice` in `storyChat.ts`), which keeps it in
Storage at `labStoryVoice/{chatId}/{clipId}` (readable by nobody through the
website) and has OpenAI's `gpt-4o-mini-transcribe` write it down: never the
browser's own recogniser, which would send the voice to Apple or Google. Each
clip is recorded on the conversation (`voiceClips`: length, size, what it was
written down as); the export counts them in `voice_clips` and copies the
recordings to the study's `identifying/` folder, never `donations/`, because a
voice identifies a person (16 October 2026; before, they were under
`donations/sourcedata/voice/`): `identifying/mystory_voice/sub-<CODE>/ses-<phase>/sub-<CODE>_ses-<phase>_chat-<chatId>_clip-<nn>.<ext>`,
numbered in the conversation's order and listed in `mystory_voice/clips.tsv`.

**Settings and limits.** Model, temperature, token and time limits come from
the TOML file (`gpt-4o`, 0.7, 400 tokens, 30 seconds, 3 attempts, 20 turns). OpenAI is
asked not to store the calls (`store: false`). A device can start 6 chats an
hour; the whole study makes at most 3,000 model calls a day (about 250
conversations; `MPMB_STORY_CALLS_PER_DAY` changes it); 5 changes per story.

**Safeguarding.** The `[[myself.safeguarding]]` lexicon rules are checked on
everything the participant types; a match is recorded on the conversation and
logged by rule (never the words) for the team to review. Nothing is shown to
the participant and nobody is contacted automatically, as the protocol's
declaration says; the chat shows the protocol's disclosure line, and the protocol's own instructions tell Remi to stop the questions and give the support numbers if someone discloses distress.

**Pacing, as in MySelf** (14 October 2026). Remi's messages arrive one at a
time, each after the "…" dots, with "typing…" in the header: the dots stay up
about as long as it takes to type the message (9 ms a character over half a
second, at most 3.8 seconds, MySelf's `typingPause`), and the time already
spent waiting for the server counts towards it. The opening messages, the
lead-in to the three versions, and the versions themselves (a shorter pause,
as they are handed over rather than typed) arrive one after another. Nothing
can be sent while Remi is "typing". `typingPause`/`deliver` in
`src/lab/story/StoryChat.tsx`.

**Keeping the stories to what they said** (14 October 2026, from the live
test, where the reflective retelling added "this new routine has lasted" and "a
healthier relationship"). Done the way the method's authors designed and
checked it (Skeggs et al., CHI 2025, section 3.2.1 and Pilot 1; the original
code, `llm_config.py` and `scenario.py`; and the social media harms preprint,
2025, "LLM Model Validation"):

- *The retelling is their answers, joined up.* The method's design is that the
  story "directly incorporates what users said in their own words" and adds "as
  little additional information as possible", the three versions differing
  "only in the tone of the connective text". Each persona in the protocols now
  says exactly that (0.1.2), and the reflective one keeps its reflection in the
  tone, not the content. The original's pilots found the same failure (feelings
  added where answers were brief), and participants minded it.
- *Only the answers given are sent to write the story.* The original built the
  story from the answers; MySelf also listed every unanswered question as "(they
  did not say)". With 18 things to extract from 5 questions, most of that list
  was gaps, which the model either filled or recited ("I haven't mentioned..."),
  so the gaps are no longer sent.
- *Each retelling, and each rewrite asked for, is checked before it is shown.* A second call (`pt.check`,
  temperature 0) goes through it sentence by sentence, quoting the participant's
  words for each, and marks any sentence that adds something, ties it to the
  wrong thing or time, or makes it more or less certain. Those sentences are
  fixed (`pt.revise`) and checked once more; any still not right are cut, word
  for word, and a version with nothing left is not offered. (A first version
  that only listed what was added missed some on the live site.) The draft, what
  was found and what is still there are kept on each retelling, and exported
  (`retellings_added`, `retellings_still_added`); a rewrite is checked against
  everything they said, asked for or wrote themselves, and what was found is
  kept with the request. Found live: asked to make a story shorter, the rewrite
  turned "it makes me a bit anxious" into "I feel less anxious". This is new:
  the original team checked by hand, after the event.
- *How close each story is to their words is measured, as the original team
  did* (cosine similarity of embeddings; theirs: real pairs M = 0.79, chance
  0.37). Recorded for the retellings and the filed story (`chosen_similarity`,
  `final_similarity`) so the team can read the lowest by hand, as they did. It
  decides nothing on its own, and the numbers depend on the embedding model
  (`text-embedding-3-small` here), so compare within this study.

The participant still chooses, rates and corrects the story, which the original
relies on as the last check. The protocols also now ask for British English, and
tell Remi to look back over the whole conversation before every follow-up so it
never asks about something already mentioned.

**Stopping early.** If the interview closes before every question is
answered, and either the participant said something the distress rules flag
or fewer than half the questions were answered (they asked to stop, say),
**no retellings are written**. Writing a story from a disclosure, and asking
them to choose and rate it, is the wrong thing to do. The site (not the model)
says it is fine to stop and that their words are saved, shows the people they
can contact, and offers Finish. Their own answers are filed as the story with
ending `stopped-early` (`endedEarly` in `storyPrompts.ts`). Found when testing
the live chat on 13 October 2026.

**The key.** In Cloud Shell, once:
`bash consent-app/firebase/scripts/set-openai-key.sh myphone-mybrain`, and
paste the key when asked (never into a chat, an email or the repository). It
can be the key MySelf uses, or one of its own, which is easier to watch and
cap in OpenAI's dashboard. The chat works within about ten minutes; no
redeploy is needed.

**The data.** `labStoryChats/{id}`: the transcript, every model call (prompt,
model, tokens, success), the extraction, the three retellings, the choice, the
rating, each change asked for and each edit, the flags and how it ended. The
finished story is also filed in `labStories/` like MyStory's other stories
(`mode: chat`). The hourly export adds
`social-media-break/donations/phenotype/mystory_chat_<phase>.tsv` (one row per
conversation, finished or not: its number in the phase (`chat_n`), everything
the participant said (`own_words`), the answers by key in their own words, the
questions covered, the persona chosen, the rating, changes, retellings whose
check could not run, the final story, flags, tokens) with a `.json`
dictionary, and every conversation in full in
`sourcedata/raw/labStoryChats.jsonl`. `ending` has one set of levels for every
conversation: `rated-full-marks`, `kept` or `edited` when finished;
`stopped-early` (the participant stopped) or `model-unavailable` whether or
not they then pressed Finish (`status` says which); `abandoned` when they left
partway. Finish is refused when there is neither a story nor anything typed,
so no empty story is filed.

**In the emulator** a stand-in model answers (it asks the questions in order
and builds the retellings from the answers), so the whole chat is tested end
to end without a key or any cost.

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

Since 20 October 2026 (`decisions.md`): MyStory is **required** and is a
**chat with Remi** (the written form only when the chat cannot start): before
the break straight after the data and before booking the visits; during it
after the one check-in on day 15; after it straight after the after-break
data. The lab computer links stay for anyone who has not told it. The drafts
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
