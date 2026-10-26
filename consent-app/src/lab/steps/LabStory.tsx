import { useState } from 'react';
import { getApi } from '../../api';
import type { LabStoryPayload, StoryAnswer } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ChoiceField, FieldWrapper, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { describeError, labClientInfo, labSession } from '../api';
import { labPages, labStudy } from '../config';
import { clearLabState } from '../persistence';
import { LabShell } from '../LabShell';
import { labMyStory, storyLimits, storyStructures, storySurveyUrl, type StoryPhase } from '../mystory';
import { Dyad, Triad, type Shares } from '../story/Signifiers';
import { ChatSupport, StoryChat, type ChatFinished } from '../story/StoryChat';
import { StoryCopy, type StoryToKeep } from '../story/StoryCopy';
import { formatTimestamp } from '../../lib/dates';
import { useLab } from '../store';
import type { FieldError } from '../validation';

const SOURCE: Record<string, LabStoryPayload['source']> = { baseline: 'baseline', checkin: 'checkin', after: 'after', story: 'story', book: 'book' };

/**
 * MyStory: a short story in the participant's own words, then a few
 * questions placing it, with its own structure for each phase of the study
 * (src/lab/mystory.ts). It follows the halfway (day 15) weekly check-in, can be told from
 * the other pages' summaries, and has a page of its own for personal links
 * (/break/mystory/?phase=…). A phase run by another survey (MySelf, for
 * example) shows that survey, given the participant ID and the phase.
 */
export function LabStory() {
  const { state, dispatch, atLab } = useLab();
  const phase = state.phase as StoryPhase;
  const mode = labMyStory.phases[phase];
  const structure = storyStructures[phase];
  const { story } = state;
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [justSent, setJustSent] = useState(false);
  // The AI chat, unless it is not set up or the participant would rather write it themselves: then MyStory's own form.
  const [ownForm, setOwnForm] = useState(false);
  const [chatDone, setChatDone] = useState<ChatFinished | null>(null);
  // The story just sent, so the participant can keep a copy (download, print, email).
  const [kept, setKept] = useState<StoryToKeep | null>(null);
  // One story for each phase (19 October 2026); the team's test accounts may tell more, to try things out.
  const canRetell = state.progress?.storyRepeatAllowed === true;
  const toldAt = state.progress?.storiesAt?.[phase] ?? null;
  const alreadyTold = !justSent && !canRetell && (state.progress?.stories?.[phase] ?? 0) > 0;
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';
  const ownPage = state.flow === 'story';
  // MyStory is required at each phase (20 October 2026): no skipping. Once told: before the break, on to booking the visits; otherwise the summary.
  const leave = () => dispatch({ type: 'go-to', stepId: state.flow === 'baseline' ? 'book' : 'done' });
  const leaveLabel = state.flow === 'baseline' ? 'Book my lab visits' : 'Continue';

  if (!ready) {
    return (
      <LabShell kicker={labMyStory.name} title="First, tell us who you are." intro={<p>Your details find your record, so your story joins up with the rest of your data, labelled with your participant ID.</p>} hideContinue hideBack>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'participant-id' })}>
            Enter my details
          </Button>
        </div>
      </LabShell>
    );
  }

  if (alreadyTold && mode.mode !== 'link' && mode.mode !== 'embed') {
    return (
      <LabShell kicker={labMyStory.name} title="Your story is already in." hideContinue hideBack>
        <Callout tone="success" role="status">
          <p>
            You have already sent your story for this part of the study{toldAt ? `, on ${formatTimestamp(toldAt)}` : ''}. Each person tells one story for each part, so there is nothing more to do here.
          </p>
        </Callout>
        <p>
          If you need to change it, contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a> and quote your participant ID <strong className="mpmb-mono">{state.code}</strong>.
        </p>
        <div className="mpmb-actions">
          {atLab ? (
            <Button variant="primary" onClick={finishAtLab}>
              Finish
            </Button>
          ) : (
            !ownPage && (
              <Button variant="primary" arrow onClick={leave}>
                {leaveLabel}
              </Button>
            )
          )}
        </div>
        {ownPage && !atLab && <p className="mpmb-hint">You can close this page.</p>}
      </LabShell>
    );
  }

  if (mode.mode === 'chat' && !ownForm && !justSent) {
    return (
      <StoryChat
        source={SOURCE[state.flow] ?? 'story'}
        onUnavailable={() => setOwnForm(true)}
        onFinished={(done) => {
          dispatch({ type: 'story-sent', storyId: done.storyId, title: done.story.length > 60 ? `${done.story.slice(0, 57).trimEnd()}…` : done.story, receivedAt: done.receivedAt });
          setChatDone(done);
          if (done.storyId) setKept({ storyId: done.storyId, title: null, text: done.story, receivedAt: done.receivedAt });
          setJustSent(true);
          announce('Your story has been sent. Thank you.');
          window.scrollTo({ top: 0 });
        }}
        onLeave={null}
        leaveLabel=""
      />
    );
  }

  // Another survey: shown in the page, or opened in a new tab, already given the participant ID and the phase.
  if (mode.mode === 'link' || mode.mode === 'embed') {
    const url = storySurveyUrl(phase, state.code, mode)!;
    return (
      <LabShell kicker={labMyStory.name} title={structure.title} intro={<p>{structure.intro}</p>} hideContinue hideBack width="wide" secondaryAction={null}>
        {mode.mode === 'embed' ? (
          <>
            <iframe className="mpmb-story-frame" src={url} title={`${mode.name}: ${structure.title}`} style={{ height: `${mode.height ?? 900}px` }} allow="clipboard-write" />
            <p className="mpmb-hint">
              Not showing properly? <a href={url} target="_blank" rel="noopener noreferrer">Open {mode.name} in a new tab</a>. It already knows your participant ID.
            </p>
          </>
        ) : (
          <div className="mpmb-actions">
            <a className="mpmb-btn mpmb-btn--primary" href={url} target="_blank" rel="noopener noreferrer">
              <span>Open {mode.name}</span>
              <span className="mpmb-btn__arrow" aria-hidden="true">
                →
              </span>
            </a>
            <p className="mpmb-hint">It opens in a new tab, already set up with your participant ID {state.code}, never your name.</p>
          </div>
        )}
        {!ownPage && (
          <div className="mpmb-actions">
            <Button variant="primary" arrow onClick={leave}>
              I’ve finished
            </Button>
          </div>
        )}
      </LabShell>
    );
  }

  const answerOf = (id: string) => story.answers[id] ?? null;
  const setAnswer = (id: string, value: StoryAnswer | null) => dispatch({ type: 'story-answer', id, value });

  const validate = (): FieldError[] => {
    const found: FieldError[] = [];
    if (!structure.prompts.some((p) => p.id === story.promptId)) found.push({ field: `story-prompt-${structure.prompts[0].id}`, message: 'Choose one of the questions to answer.' });
    if (story.story.trim().length < storyLimits.storyMin) found.push({ field: 'story-text', message: story.story.trim() ? 'Tell us a little more: a sentence or two is plenty.' : 'Write your story in the box.' });
    else if (story.story.length > storyLimits.storyMax) found.push({ field: 'story-text', message: `Please keep your story under ${storyLimits.storyMax} characters.` });
    if (!story.title.trim()) found.push({ field: 'story-title', message: 'Give your story a title: a few words is fine.' });
    return found;
  };

  const send = async () => {
    const found = validate();
    setErrors(found);
    if (found.length) return;
    setBusy(true);
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const answers = Object.fromEntries(structure.signifiers.filter((s) => story.answers[s.id] !== undefined).map((s) => [s.id, story.answers[s.id]]));
      const result = await getApi().submitLabStory(session, {
        participantCode: state.code,
        phase,
        structureId: structure.id,
        structureVersion: structure.version,
        promptId: story.promptId,
        title: story.title.trim(),
        story: story.story.trim(),
        answers,
        source: SOURCE[state.flow] ?? 'story',
        checkInId: state.flow === 'checkin' ? state.checkIn.checkInId : null,
        client: labClientInfo(),
      });
      setKept({ storyId: result.storyId, title: story.title.trim(), text: story.story.trim(), receivedAt: result.receivedAt });
      dispatch({ type: 'story-sent', storyId: result.storyId, title: story.title.trim(), receivedAt: result.receivedAt });
      setJustSent(true);
      announce('Your story has been sent. Thank you.');
      window.scrollTo({ top: 0 });
    } catch (error) {
      setErrors([{ field: 'story-text', message: describeError(error, 'your story') }]);
    } finally {
      setBusy(false);
    }
  };

  // At the lab: the page forgets this participant (nothing was kept on the computer) and opens clean for the next.
  function finishAtLab() {
    clearLabState();
    // The participant ID left the address when the page opened; the phase and the lab mode stay.
    window.location.replace(`${window.location.pathname}${window.location.search}`);
  }

  // After the chat: the story they made, or, if they stopped partway or Remi could not carry on, a word about that.
  const stoppedEarly = chatDone?.ending === 'stopped-early';
  const chatTitle = chatDone && (stoppedEarly || chatDone.ending === 'model-unavailable') ? 'Thank you for talking to Remi.' : 'Thank you. Your story is saved.';
  const chatStory = chatDone ? (
    <div className="mpmb-chat__debrief">
      {stoppedEarly ? (
        <p className="mpmb-lead">You stopped partway, and that’s completely fine. What you said is saved, and nothing more will be asked in this chat.</p>
      ) : (
        <>
          <p className="mpmb-lead">{chatDone.ending === 'model-unavailable' ? 'Remi couldn’t carry on this time, so your own answers are saved as your story.' : chatDone.debriefText}</p>
          <blockquote className="mpmb-chat__story">{chatDone.story}</blockquote>
        </>
      )}
    </div>
  ) : null;

  if (justSent && atLab) {
    const last = story.sent[story.sent.length - 1];
    return (
      <LabShell kicker={labMyStory.name} title={chatDone ? chatTitle : 'Thank you. Your story is saved.'} hideContinue hideBack>
        {chatStory}
        <Callout tone="success" role="status">
          <p>
            {chatDone ? 'It’s' : `“${last?.title}” is`} saved under your participant ID, never your name. Please hand the computer back to the researcher.
          </p>
        </Callout>
        {chatDone && <ChatSupport />}
        {kept && <StoryCopy story={kept} />}
        <div className="mpmb-actions">
          <Button variant="primary" onClick={finishAtLab}>
            Finish
          </Button>
          {canRetell && (
            <Button variant="secondary" onClick={() => { setJustSent(false); setChatDone(null); setKept(null); }}>
              Tell another story
            </Button>
          )}
        </div>
        <p className="mpmb-hint">Finish clears this page for the next person. Nothing about you is kept on this computer.</p>
      </LabShell>
    );
  }

  if (justSent) {
    const last = story.sent[story.sent.length - 1];
    return (
      <LabShell kicker={labMyStory.name} title={chatDone ? chatTitle : 'Thank you. Your story is saved.'} hideContinue hideBack>
        {chatStory}
        <Callout tone="success" role="status">
          <p>
            {chatDone ? 'It’s' : `“${last?.title}” is`} saved under your participant ID <strong className="mpmb-mono">{state.code}</strong>, never your name. The team reads the stories together, and if you ever want yours removed, that ID is how we find it.
          </p>
        </Callout>
        {chatDone && <ChatSupport />}
        {kept && <StoryCopy story={kept} />}
        <div className="mpmb-actions">
          {!ownPage && (
            <Button variant="primary" arrow onClick={leave}>
              {leaveLabel}
            </Button>
          )}
          {canRetell && (
            <Button variant="secondary" onClick={() => { setJustSent(false); setChatDone(null); setKept(null); }}>
              Tell another story
            </Button>
          )}
        </div>
        {ownPage && (
          <p className="mpmb-hint">
            You can close this page. {phase === 'mid' && canRetell ? <>Your next weekly <a href={labPages.checkin.path}>check-in</a> has a MyStory at the end too.</> : null}
          </p>
        )}
      </LabShell>
    );
  }

  return (
    <LabShell
      kicker={labMyStory.name}
      title={structure.title}
      intro={<p>{structure.intro}</p>}
      errors={errors}
      onContinue={() => void send()}
      continueLabel="Send my story"
      continueLoading={busy}
      hideBack
      width="wide"
    >
      {story.sent.length > 0 && (
        <p className="mpmb-hint" role="status">
          Sent from this page so far: {story.sent.map((s) => `“${s.title}”`).join(', ')}.
        </p>
      )}
      <fieldset className={`mpmb-choice mpmb-choice--stack${errs[`story-prompt-${structure.prompts[0].id}`] ? ' has-error' : ''}`}>
        <legend className="mpmb-choice__legend">1. Choose one to answer</legend>
        {errs[`story-prompt-${structure.prompts[0].id}`] && (
          <p className="mpmb-error">
            <span className="mpmb-sr-only">Error: </span>
            {errs[`story-prompt-${structure.prompts[0].id}`]}
          </p>
        )}
        <div className="mpmb-choice__options">
          {structure.prompts.map((p) => (
            <label key={p.id} className={`mpmb-choice__option${story.promptId === p.id ? ' is-selected' : ''}`} htmlFor={`story-prompt-${p.id}`}>
              <input id={`story-prompt-${p.id}`} type="radio" name="story-prompt" className="mpmb-choice__input" checked={story.promptId === p.id} onChange={() => dispatch({ type: 'story-field', patch: { promptId: p.id } })} />
              <span className="mpmb-choice__dot" aria-hidden="true" />
              <span>{p.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <FieldWrapper id="story-text" label="2. Your story" hint={structure.storyHint} error={errs['story-text']}>
        <textarea id="story-text" className="mpmb-input mpmb-input--area mpmb-story__text" rows={7} maxLength={storyLimits.storyMax} value={story.story} onChange={(e) => dispatch({ type: 'story-field', patch: { story: e.target.value } })} aria-describedby="story-text-hint story-text-count" aria-invalid={errs['story-text'] ? true : undefined} />
        <p className="mpmb-hint mpmb-story__count" id="story-text-count">
          {story.story.length.toLocaleString('en-GB')} of {storyLimits.storyMax.toLocaleString('en-GB')} characters
        </p>
      </FieldWrapper>

      <TextField id="story-title" label="3. Give it a title" hint="A few words, as if it were a headline." maxLength={storyLimits.titleMax} value={story.title} onChange={(e) => dispatch({ type: 'story-field', patch: { title: e.target.value } })} error={errs['story-title']} />

      <section aria-labelledby="story-about" className="mpmb-story__signifiers">
        <div className="mpmb-story__about">
          <h2 className="mpmb-choice__legend" id="story-about">
            4. About your story
          </h2>
          <p className="mpmb-hint">Quick questions about the story you told. There are no right answers; choose “not sure” for any that don’t fit.</p>
        </div>
        {structure.signifiers.map((sig) =>
          sig.type === 'triad' ? (
            <Triad key={sig.id} id={`story-${sig.id}`} question={sig.question} corners={sig.corners} value={answerOf(sig.id) as Shares | 'na' | null} onChange={(v) => setAnswer(sig.id, v)} />
          ) : sig.type === 'dyad' ? (
            <Dyad key={sig.id} id={`story-${sig.id}`} question={sig.question} left={sig.left} right={sig.right} value={answerOf(sig.id) as number | 'na' | null} onChange={(v) => setAnswer(sig.id, v)} />
          ) : (
            <ChoiceField key={sig.id} id={`story-${sig.id}`} name={`story-${sig.id}`} legend={sig.question} value={(answerOf(sig.id) as string | null) ?? null} onChange={(v) => setAnswer(sig.id, v)} options={sig.options} />
          ),
        )}
      </section>
      <p className="mpmb-hint">
        Sent to the study’s secure storage at the University of Leeds, labelled with your participant ID <strong className="mpmb-mono">{state.code}</strong>. Please leave out names and anything that could identify someone. Questions? Contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>.
      </p>
    </LabShell>
  );
}
