import { useEffect, useRef, useState } from 'react';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Draft } from '../components/ui/Draft';
import { moreFormFor, multiValues, parentNoPhoneForm, parentQuestionsForm } from '../config/questions';
import { announce } from '../lib/announce';
import { phoneSourceApplies } from '../model/journey';
import { useStore } from '../state/context';

/** The quick questions every parent or carer is asked. */
export function ParentQuestions() {
  return <QuestionsStep which="quick" />;
}

/** The longer questions, when the young person's screen time is not coming through this form. */
export function ParentMore() {
  return <QuestionsStep which="more" />;
}

/**
 * One-tap questions for the parent or carer about how they see the young
 * person's phone use: the quick ones every parent is asked, or the longer
 * ones (time and apps, night-time and sleep, effects) when the screen time
 * itself is not coming. Every question can be skipped, and so can the lot.
 * Tapping an answer moves to the next question; the last answer moves on to
 * the next step. A question that takes more than one answer has tick boxes
 * and a Next button. Coming back here shows how many were answered, with a
 * way to answer again, rather than putting the answers back on screen.
 */
function QuestionsStep({ which }: { which: 'quick' | 'more' }) {
  const { state, dispatch } = useStore();
  const config = which === 'more' ? moreFormFor(state.more.formId) : parentQuestionsForm;
  const noPhone = config.id === parentNoPhoneForm.id;
  const survey = which === 'more' ? state.more : state.survey;
  const form = which;
  const childName = state.identity.firstName.trim() || 'your child';
  const questions = config.questions;
  const total = questions.length;
  const answered = questions.filter((q) => survey.responses[q.id]).length;
  const finished = survey.status === 'completed' || survey.status === 'skipped';
  const [reviewing, setReviewing] = useState(false);
  const [index, setIndex] = useState(() => Math.max(0, questions.findIndex((q) => !survey.responses[q.id])));
  const [selecting, setSelecting] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const questionRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<number | null>(null);
  const asking = !finished || reviewing;
  const q = questions[index];
  const chosen = selecting ?? survey.responses[q.id]?.value ?? null;
  const ticked = q.type === 'multi' ? multiValues(survey.responses[q.id]?.value) : [];
  const last = index === total - 1;
  const text = (t: string) => t.replace(/\{child\}/g, childName);
  // Not every young person has a phone (team feedback, 9 October 2026), so the parent is asked first, before any question about it.
  // "No" gives the no-phone questions (in the longer questions' slot) instead of the quick and the longer ones. Under 16 only: at 16 or
  // over the young person answers for themselves. Not asked again once the quick questions are under way or the screen time is decided.
  const [saidYes, setSaidYes] = useState(false);
  const gate = which === 'quick' && !saidYes && (state.phoneSource === 'no-phone' || (phoneSourceApplies(state) && state.phoneSource === null && survey.status === 'not-started'));

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  // The text box starts with whatever was written before, so coming back never loses it.
  useEffect(() => {
    if (q.type === 'text') setDraft(survey.responses[q.id]?.value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const moveTo = (i: number) => {
    setIndex(i);
    announce(`Question ${i + 1} of ${total}.`);
    window.requestAnimationFrame(() => questionRef.current?.focus());
  };
  const finish = () => {
    dispatch({ type: 'survey-status', status: 'completed', form });
    dispatch({ type: 'next' });
  };
  const advance = () => (last ? finish() : moveTo(index + 1));
  const choose = (value: string) => {
    if (selecting !== null) return;
    dispatch({ type: 'answer-question', questionId: q.id, version: q.version, value, form });
    setSelecting(value);
    // A moment to see the choice land before the next question appears.
    timer.current = window.setTimeout(() => {
      setSelecting(null);
      advance();
    }, 260);
  };
  /** More than one answer: each tap adds or removes one; "I don't know" stands alone. */
  const toggle = (value: string) => {
    const next = ticked.includes(value) ? ticked.filter((v) => v !== value) : value === 'unsure' ? ['unsure'] : [...ticked.filter((v) => v !== 'unsure'), value];
    const ordered = q.type === 'multi' ? q.options.map((o) => o.value).filter((v) => next.includes(v)) : next;
    if (ordered.length) dispatch({ type: 'answer-question', questionId: q.id, version: q.version, value: ordered.join(';'), form });
    else dispatch({ type: 'skip-question', questionId: q.id, form });
  };
  const skipQuestion = () => {
    dispatch({ type: 'skip-question', questionId: q.id, form });
    advance();
  };
  /** The open question is saved when its button is pressed; an empty box counts as skipped. */
  const submitText = () => {
    const value = draft.trim();
    if (value) dispatch({ type: 'answer-question', questionId: q.id, version: q.version, value: value.slice(0, q.type === 'text' ? q.maxLength : value.length), form });
    else dispatch({ type: 'skip-question', questionId: q.id, form });
    advance();
  };
  const skipAll = () => {
    dispatch({ type: 'survey-status', status: 'skipped', form });
    dispatch({ type: 'next' });
  };

  const title = (
    <>
      {noPhone ? 'Some questions about phones and social media.' : which === 'more' ? `Some more questions about ${childName}’s phone use.` : `A few quick questions about ${childName}’s phone use.`} {config.draft && <Draft />}
    </>
  );
  const kicker = noPhone ? 'Questions' : which === 'more' ? 'More questions' : 'Quick questions';
  const intro = noPhone
    ? `${childName} doesn’t have a phone of their own, so these are about what you think of phones and social media, and what ${childName} uses instead. About a minute. You can skip any question. Your answers are kept with ${childName}’s code, not your name.`
    : which === 'more'
      ? `About ${childName}’s phone and social media: time and apps, night-time and sleep, and how it affects them. About two minutes. Answer what you can: you can skip any question. Your answers are kept with ${childName}’s code, not your name.`
      : `About a minute. Tap an answer to go to the next question. You can skip any of them, or all of them if ${childName} is next to you. Your answers are kept with ${childName}’s code, not your name.`;

  if (gate) {
    const answer = (has: boolean) => {
      if (has) {
        if (state.phoneSource === 'no-phone') dispatch({ type: 'set-phone-source', source: null });
        setSaidYes(true);
        window.requestAnimationFrame(() => questionRef.current?.focus());
        return;
      }
      if (state.phoneSource !== 'no-phone') dispatch({ type: 'set-phone-source', source: 'no-phone' });
      dispatch({ type: 'next' });
    };
    return (
      <StepShell kicker="Quick questions" title={<>First: does {childName} have a phone of their own?</>} intro={<p>A smartphone that is theirs, not shared with anyone else. Not every young person has one, and that’s fine.</p>} hideContinue>
        <div className="mpmb-quiz__options" role="group" aria-label={`Does ${childName} have a phone of their own?`}>
          <button type="button" className={`mpmb-quiz__option${saidYes ? ' is-selected' : ''}`} aria-pressed={false} onClick={() => answer(true)}>
            <span className="mpmb-quiz__dot" aria-hidden="true" />
            Yes
          </button>
          <button type="button" className={`mpmb-quiz__option${state.phoneSource === 'no-phone' ? ' is-selected' : ''}`} aria-pressed={state.phoneSource === 'no-phone'} onClick={() => answer(false)}>
            <span className="mpmb-quiz__dot" aria-hidden="true" />
            No, not yet
          </button>
        </div>
      </StepShell>
    );
  }

  if (!asking) {
    return (
      <StepShell kicker={kicker} title={title} intro={<p>{survey.status === 'skipped' && !answered ? 'You skipped these questions. That is fine: they are optional.' : `You answered ${answered} of ${total}. Thank you. Your answers are not shown again on this phone.`}</p>} onContinue={() => dispatch({ type: 'next' })}>
        <Button
          variant="link"
          onClick={() => {
            // Starting again from blank, so earlier answers are never put back on screen.
            for (const qq of questions) if (survey.responses[qq.id]) dispatch({ type: 'skip-question', questionId: qq.id, form });
            setReviewing(true);
            moveTo(0);
          }}
        >
          {answered ? 'Answer them again' : 'Answer the questions'}
        </Button>
      </StepShell>
    );
  }

  return (
    <StepShell
      kicker={kicker}
      title={title}
      intro={<p>{intro}</p>}
      hideContinue
      secondaryAction={
        <Button variant="link" onClick={skipAll}>
          Skip these questions
        </Button>
      }
    >
      <div className="mpmb-quiz">
        <p className="mpmb-quiz__count">
          {q.topic ? `${q.topic} · ` : ''}Question {index + 1} of {total}
        </p>
        <h2 className="mpmb-h3 mpmb-quiz__question" id="mpmb-quiz-question" tabIndex={-1} ref={questionRef}>
          {text(q.text)}
        </h2>
        {q.type === 'choice' ? (
          <div className={`mpmb-quiz__options${q.compact ? ' mpmb-quiz__options--compact' : ''}`} role="group" aria-labelledby="mpmb-quiz-question">
            {q.options.map((o) => (
              <button key={o.value} type="button" className={`mpmb-quiz__option${chosen === o.value ? ' is-selected' : ''}${q.compact && o.label.length > 12 ? ' mpmb-quiz__option--wide' : ''}`} aria-pressed={chosen === o.value} onClick={() => choose(o.value)}>
                <span className="mpmb-quiz__dot" aria-hidden="true" />
                {o.label}
              </button>
            ))}
          </div>
        ) : q.type === 'multi' ? (
          <>
            <p className="mpmb-hint" id="mpmb-quiz-multi-hint">
              {q.hint}
            </p>
            <div className="mpmb-quiz__options" role="group" aria-labelledby="mpmb-quiz-question" aria-describedby="mpmb-quiz-multi-hint">
              {q.options.map((o) => (
                <button key={o.value} type="button" className={`mpmb-quiz__option mpmb-quiz__option--tick${ticked.includes(o.value) ? ' is-selected' : ''}`} aria-pressed={ticked.includes(o.value)} onClick={() => toggle(o.value)}>
                  <span className="mpmb-quiz__box" aria-hidden="true" />
                  {o.label}
                </button>
              ))}
            </div>
            <div className="mpmb-quiz__next">
              <Button variant="primary" arrow onClick={advance}>
                {last ? 'Finish' : 'Next'}
              </Button>
            </div>
          </>
        ) : (
          <div className="mpmb-field">
            <p className="mpmb-hint" id="mpmb-quiz-text-hint">
              {q.hint}
            </p>
            <textarea id="mpmb-quiz-text" className="mpmb-input mpmb-input--area" rows={4} maxLength={q.maxLength} value={draft} onChange={(e) => setDraft(e.target.value)} aria-labelledby="mpmb-quiz-question" aria-describedby="mpmb-quiz-text-hint mpmb-quiz-text-count" />
            <p className="mpmb-hint mpmb-quiz__count-chars" id="mpmb-quiz-text-count" aria-live="polite">
              {q.maxLength - draft.length} characters left
            </p>
            <Button variant="primary" arrow onClick={submitText}>
              {last ? 'Finish' : 'Next'}
            </Button>
          </div>
        )}
        <div className="mpmb-quiz__nav">
          {index > 0 && (
            <Button variant="link" onClick={() => moveTo(index - 1)}>
              ← Previous question
            </Button>
          )}
          <Button variant="link" onClick={skipQuestion}>
            {last ? 'Skip this one and finish' : 'Skip this question'}
          </Button>
        </div>
      </div>
    </StepShell>
  );
}
