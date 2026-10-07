import { useEffect, useRef, useState } from 'react';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Draft } from '../components/ui/Draft';
import { parentMoreForm, parentQuestionsForm } from '../config/questions';
import { announce } from '../lib/announce';
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
 * the next step. Coming back here shows how many were answered, with a way
 * to answer again, rather than putting the answers back on screen.
 */
function QuestionsStep({ which }: { which: 'quick' | 'more' }) {
  const { state, dispatch } = useStore();
  const config = which === 'more' ? parentMoreForm : parentQuestionsForm;
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
  const last = index === total - 1;
  const text = (t: string) => t.replace(/\{child\}/g, childName);

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
      {which === 'more' ? `Some more questions about ${childName}’s phone use.` : `A few quick questions about ${childName}’s phone use.`} {config.draft && <Draft />}
    </>
  );
  const kicker = which === 'more' ? 'More questions' : 'Quick questions';
  const intro =
    which === 'more'
      ? `We won’t have ${childName}’s screen time from this form, so these questions help us understand their phone use instead: time and apps, night-time and sleep, and how it affects them. About three minutes. Answer what you can: you can skip any question. Your answers are kept with ${childName}’s code, not your name.`
      : `Optional, and about a minute. These questions are for you, not ${childName}: if ${childName} is next to you, you can skip them. Tap an answer to move to the next question. Your answers are kept with ${childName}’s code, not your name.`;

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
          <div className="mpmb-quiz__options" role="group" aria-labelledby="mpmb-quiz-question">
            {q.options.map((o) => (
              <button key={o.value} type="button" className={`mpmb-quiz__option${chosen === o.value ? ' is-selected' : ''}`} aria-pressed={chosen === o.value} onClick={() => choose(o.value)}>
                <span className="mpmb-quiz__dot" aria-hidden="true" />
                {o.label}
              </button>
            ))}
          </div>
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
