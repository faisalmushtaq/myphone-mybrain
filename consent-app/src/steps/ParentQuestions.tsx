import { useEffect, useRef, useState } from 'react';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Draft } from '../components/ui/Draft';
import { parentQuestionsForm } from '../config/questions';
import { announce } from '../lib/announce';
import { useStore } from '../state/context';

/**
 * A few one-tap questions for the parent or guardian about how they see the
 * young person's phone use. Optional and clearly separate from the
 * permission. Tapping an answer moves to the next question; the last answer
 * moves on to the next step. Coming back here shows the answers given, with
 * a way to change them, rather than asking everything again.
 */
export function ParentQuestions() {
  const { state, dispatch } = useStore();
  const { survey } = state;
  const childName = state.identity.firstName.trim() || 'your child';
  const questions = parentQuestionsForm.questions;
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
    dispatch({ type: 'survey-status', status: 'completed' });
    dispatch({ type: 'next' });
  };
  const advance = () => (last ? finish() : moveTo(index + 1));
  const choose = (value: string) => {
    if (selecting !== null) return;
    dispatch({ type: 'answer-question', questionId: q.id, version: q.version, value });
    setSelecting(value);
    // A moment to see the choice land before the next question appears.
    timer.current = window.setTimeout(() => {
      setSelecting(null);
      advance();
    }, 260);
  };
  const skipQuestion = () => {
    dispatch({ type: 'skip-question', questionId: q.id });
    advance();
  };
  /** The open question is saved when its button is pressed; an empty box counts as skipped. */
  const submitText = () => {
    const value = draft.trim();
    if (value) dispatch({ type: 'answer-question', questionId: q.id, version: q.version, value: value.slice(0, q.type === 'text' ? q.maxLength : value.length) });
    else dispatch({ type: 'skip-question', questionId: q.id });
    advance();
  };
  const skipAll = () => {
    dispatch({ type: 'survey-status', status: 'skipped' });
    dispatch({ type: 'next' });
  };

  const title = (
    <>
      A few quick questions about {childName}’s phone use. {parentQuestionsForm.draft && <Draft />}
    </>
  );

  if (!asking) {
    return (
      <StepShell kicker="Quick questions" title={title} intro={<p>{survey.status === 'skipped' && !answered ? 'You skipped these questions. That is fine — they are optional.' : `You answered ${answered} of ${total}. Thank you.`}</p>} onContinue={() => dispatch({ type: 'next' })}>
        {answered > 0 && (
          <dl className="mpmb-summary__list">
            {questions.map((qq) => (
              <div className="mpmb-summary__row" key={qq.id}>
                <dt>{qq.label}</dt>
                <dd>{(qq.type === 'choice' ? qq.options.find((o) => o.value === survey.responses[qq.id]?.value)?.label : survey.responses[qq.id]?.value) ?? <span className="mpmb-summary__empty">Skipped</span>}</dd>
              </div>
            ))}
          </dl>
        )}
        <Button
          variant="link"
          onClick={() => {
            setReviewing(true);
            moveTo(0);
          }}
        >
          {answered ? 'Change my answers' : 'Answer the questions'}
        </Button>
      </StepShell>
    );
  }

  return (
    <StepShell
      kicker="Quick questions"
      title={title}
      intro={<p>Optional, and about a minute. Tap an answer to move to the next question. Your answers are research information — kept with {childName}’s code, not your name — and are not part of your permission.</p>}
      hideContinue
      secondaryAction={
        <Button variant="link" onClick={skipAll}>
          Skip these questions
        </Button>
      }
    >
      <div className="mpmb-quiz">
        <p className="mpmb-quiz__count">
          Question {index + 1} of {total}
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
