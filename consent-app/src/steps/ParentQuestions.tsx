import { useEffect, useRef, useState } from 'react';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Draft } from '../components/ui/Draft';
import { moreFormFor, multiValues, optionsFor, parentMoreForm, parentNoPhoneForm, parentQuestionOrder, parentQuestionsForm, type Question } from '../config/questions';
import { announce } from '../lib/announce';
import { childAge, longerWithQuick, phoneSourceApplies } from '../model/journey';
import { useStore } from '../state/context';

/** The parent or carer's questions: the quick ones and the longer ones, as one set (15 October 2026). */
export function ParentQuestions() {
  return <QuestionsStep which="quick" />;
}

/** The no-phone questions, for a young person with no phone of their own. */
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
  // One set, one count (15 October 2026): with a phone of their own, the longer questions follow the quick ones on this same step. Each
  // answer is still kept in its own record (the quick questions' and the longer questions'), so the data and the export are unchanged.
  const withLonger = which === 'quick' && longerWithQuick(state) && state.more.formId === parentMoreForm.id;
  // In the one set the questions go facts first (parentQuestionOrder, 15 October 2026), with the open "anything else?" last; any question
  // the order does not name keeps its place before the open one.
  const own: { q: Question; form: 'quick' | 'more'; topic?: string }[] = [
    ...config.questions.map((q) => ({ q, form: which })),
    ...(withLonger ? parentMoreForm.questions.map((q) => ({ q, form: 'more' as const })) : []),
  ];
  const items = withLonger
    ? [
        ...parentQuestionOrder.flatMap((o) => own.filter((i) => i.q.id === o.id).map((i) => ({ ...i, topic: o.topic }))).filter((i) => i.q.id !== 'anything-else'),
        ...own.filter((i) => !parentQuestionOrder.some((o) => o.id === i.q.id)),
        ...own.filter((i) => i.q.id === 'anything-else'),
      ]
    : own;
  const age = childAge(state);
  const forms: ('quick' | 'more')[] = withLonger ? ['quick', 'more'] : [which];
  const recordOf = (f: 'quick' | 'more') => (f === 'more' ? state.more : state.survey);
  const survey = recordOf(which);
  const childName = state.identity.firstName.trim() || 'your child';
  const questions = items.map((i) => i.q);
  const total = questions.length;
  const answered = items.filter((i) => recordOf(i.form).responses[i.q.id]).length;
  const finished = forms.every((f) => recordOf(f).status === 'completed' || recordOf(f).status === 'skipped');
  const [reviewing, setReviewing] = useState(false);
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((i) => !recordOf(i.form).responses[i.q.id])));
  const [selecting, setSelecting] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const questionRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<number | null>(null);
  const asking = !finished || reviewing;
  const q = questions[Math.min(index, total - 1)];
  const topic = items[Math.min(index, total - 1)].topic ?? q.topic;
  const form = items[Math.min(index, total - 1)].form;
  const responses = recordOf(form).responses;
  const chosen = selecting ?? responses[q.id]?.value ?? null;
  const ticked = q.type === 'multi' ? multiValues(responses[q.id]?.value) : [];
  const last = index === total - 1;
  const text = (t: string) => t.replace(/\{child\}/g, childName);
  /** The question, with the words that tell it apart from its neighbours in bold. */
  const shown = (question: Question) => {
    const t = text(question.text);
    const at = question.emphasis ? t.indexOf(question.emphasis) : -1;
    if (at < 0) return t;
    return (
      <>
        {t.slice(0, at)}
        <strong className="mpmb-quiz__em">{question.emphasis}</strong>
        {t.slice(at + question.emphasis!.length)}
      </>
    );
  };
  // Not every young person has a phone (team feedback, 9 October 2026), so the parent is asked first, before any question about it.
  // "No" gives the no-phone questions (in the longer questions' slot) instead of the quick and the longer ones. Under 16 only: at 16 or
  // over the young person answers for themselves. Not asked again once the quick questions are under way or the screen time is decided.
  const saidYes = Boolean(state.ownPhoneYes);
  const gate = which === 'quick' && !saidYes && (state.phoneSource === 'no-phone' || (phoneSourceApplies(state) && state.phoneSource === null && survey.status === 'not-started'));

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  // The text box starts with whatever was written before, so coming back never loses it.
  useEffect(() => {
    if (q.type === 'text') setDraft(responses[q.id]?.value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const moveTo = (i: number) => {
    setIndex(i);
    announce(`Question ${i + 1} of ${total}.`);
    window.requestAnimationFrame(() => questionRef.current?.focus());
  };
  const finish = () => {
    for (const f of forms) dispatch({ type: 'survey-status', status: 'completed', form: f });
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
    // Skipping the rest keeps what was answered: a record with answers is finished, one with none is skipped.
    for (const f of forms) {
      if (recordOf(f).status === 'completed') continue;
      const has = Object.keys(recordOf(f).responses).length > 0;
      dispatch({ type: 'survey-status', status: withLonger && has ? 'completed' : 'skipped', form: f });
    }
    dispatch({ type: 'next' });
  };

  const title = (
    <>
      {noPhone ? 'Some questions about phones and social media.' : `Some questions about ${childName}’s phone use.`} {(config.draft || (withLonger && parentMoreForm.draft)) && <Draft />}
    </>
  );
  const kicker = 'Questions';
  const intro = noPhone
    ? `${childName} doesn’t have a phone of their own, so these are about what you think of phones and social media, and what ${childName} uses instead. About a minute. You can skip any question. Your answers are kept with ${childName}’s code, not your name.`
    : `About ${childName}’s phone and social media: how they use it, time and apps, night-time and sleep, and how it affects them. About ${withLonger ? 'three minutes' : 'a minute'}. Tap an answer to go to the next question. You can skip any of them, or all of them if ${childName} is next to you. Your answers are kept with ${childName}’s code, not your name.`;

  if (gate) {
    const answer = (has: boolean) => {
      if (has) {
        if (state.phoneSource === 'no-phone') dispatch({ type: 'set-phone-source', source: null });
        dispatch({ type: 'own-phone-yes' });
        window.requestAnimationFrame(() => questionRef.current?.focus());
        return;
      }
      if (state.phoneSource !== 'no-phone') dispatch({ type: 'set-phone-source', source: 'no-phone' });
      dispatch({ type: 'next' });
    };
    return (
      <StepShell kicker="Questions" title={<>First: does {childName} have a phone of their own?</>} intro={<p>A smartphone that is theirs, not shared with anyone else. Not every young person has one, and that’s fine.</p>} hideContinue>
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
      <StepShell kicker={kicker} title={title} intro={<p>{forms.every((f) => recordOf(f).status === 'skipped') && !answered ? 'You skipped these questions. That is fine: they are optional.' : `You answered ${answered} of ${total}. Thank you. Your answers are not shown again on this phone.`}</p>} onContinue={() => dispatch({ type: 'next' })}>
        <Button
          variant="link"
          onClick={() => {
            // Starting again from blank, so earlier answers are never put back on screen.
            for (const it of items) if (recordOf(it.form).responses[it.q.id]) dispatch({ type: 'skip-question', questionId: it.q.id, form: it.form });
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
          {topic ? `${topic} · ` : ''}Question {index + 1} of {total}
        </p>
        <h2 className="mpmb-h3 mpmb-quiz__question" id="mpmb-quiz-question" tabIndex={-1} ref={questionRef}>
          {shown(q)}
        </h2>
        {q.type === 'choice' ? (
          <div className={`mpmb-quiz__options${q.compact ? ' mpmb-quiz__options--compact' : ''}`} role="group" aria-labelledby="mpmb-quiz-question">
            {optionsFor(q, age).map((o) => (
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
                {last ? 'Continue' : 'Next'}
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
              {last ? 'Continue' : 'Next'}
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
            {last ? 'Skip this one and continue' : 'Skip this question'}
          </Button>
        </div>
      </div>
    </StepShell>
  );
}
