import { useState } from 'react';
import { getApi } from '../../api';
import type { LabStoryPayload, StoryAnswer } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ChoiceField, FieldWrapper, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { describeError, labClientInfo, labSession } from '../api';
import { labPages, labStudy } from '../config';
import { LabShell } from '../LabShell';
import { labMyStory, storyLimits, storyStructures, storySurveyUrl, type StoryPhase } from '../mystory';
import { Dyad, Triad, type Shares } from '../story/Signifiers';
import { useLab } from '../store';
import type { FieldError } from '../validation';

const SOURCE: Record<string, LabStoryPayload['source']> = { baseline: 'baseline', checkin: 'checkin', after: 'after', story: 'story', book: 'book' };

/**
 * MyStory: a short story in the participant's own words, then a few
 * questions placing it, with its own structure for each phase of the study
 * (src/lab/mystory.ts). It follows each mid-break check-in, can be told from
 * the other pages' summaries, and has a page of its own for personal links
 * (/break/mystory/?phase=…). A phase run by another survey (MySelf, for
 * example) shows that survey, given the participant ID and the phase.
 */
export function LabStory() {
  const { state, dispatch } = useLab();
  const phase = state.phase as StoryPhase;
  const mode = labMyStory.phases[phase];
  const structure = storyStructures[phase];
  const { story } = state;
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';
  const ownPage = state.flow === 'story';
  const leave = () => dispatch({ type: 'go-to', stepId: 'done' });
  const leaveLabel = state.flow === 'checkin' ? 'Continue' : 'Back to my summary';

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

  // Another survey: shown in the page, or opened in a new tab, already given the participant ID and the phase.
  if (mode.mode !== 'native') {
    const url = storySurveyUrl(phase, state.code, mode)!;
    return (
      <LabShell kicker={labMyStory.name} title={structure.title} intro={<p>{structure.intro}</p>} hideContinue hideBack width="wide" secondaryAction={ownPage ? null : <Button variant="secondary" onClick={leave}>{state.flow === 'checkin' ? 'Skip this time' : leaveLabel}</Button>}>
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
        {state.flow === 'checkin' && (
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

  if (justSent) {
    const last = story.sent[story.sent.length - 1];
    return (
      <LabShell kicker={labMyStory.name} title="Thank you. Your story is in." hideContinue hideBack>
        <Callout tone="success" role="status">
          <p>
            “{last?.title}” has been sent, labelled with your participant ID <strong className="mpmb-mono">{state.code}</strong>. The team reads the stories together, never alongside your name.
          </p>
        </Callout>
        <div className="mpmb-actions">
          {!ownPage && (
            <Button variant="primary" arrow onClick={leave}>
              {leaveLabel}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setJustSent(false)}>
            Tell another story
          </Button>
        </div>
        {ownPage && (
          <p className="mpmb-hint">
            You can close this page. {phase === 'mid' ? <>Your next weekly <a href={labPages.checkin.path}>check-in</a> has a MyStory at the end too.</> : null}
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
      secondaryAction={
        ownPage ? null : (
          <Button variant="ghost" onClick={leave}>
            {state.flow === 'checkin' ? 'Skip this time' : 'Not now'}
          </Button>
        )
      }
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
