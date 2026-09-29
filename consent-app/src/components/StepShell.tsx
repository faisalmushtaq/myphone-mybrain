import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { FieldError } from '../lib/validation';
import { countedSteps, stepDefs } from '../model/journey';
import { useStore } from '../state/context';
import { Button } from './ui/Button';
import { ErrorSummary } from './ui/ErrorSummary';

interface Props {
  kicker?: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  errors?: FieldError[];
  onContinue?: () => void;
  continueLabel?: string;
  continueLoading?: boolean;
  /** Extra actions rendered next to Back (for example "Skip for now"). */
  secondaryAction?: ReactNode;
  hideBack?: boolean;
  hideContinue?: boolean;
  width?: 'normal' | 'wide';
}

/**
 * Common frame for every step: heading that receives focus when the step
 * appears, optional error summary, the step content, and the action bar.
 * Wrapping the content in a form means Enter in a text field also continues.
 */
export function StepShell({ kicker, title, intro, children, errors = [], onContinue, continueLabel = 'Continue', continueLoading, secondaryAction, hideBack, hideContinue, width = 'normal' }: Props) {
  const { state, dispatch } = useStore();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Name the page for the browser tab and history, then move focus to the heading.
    const steps = countedSteps(state);
    const n = steps.indexOf(state.stepId) + 1;
    document.title = `${n > 0 ? `Step ${n} of ${steps.length}: ` : ''}${stepDefs[state.stepId].title} – MyPhone/MyBrain`;
    const el = headingRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 120;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    el.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stepId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (continueLoading) return;
    setAttempt((a) => a + 1);
    onContinue?.();
  };

  return (
    <form className={`mpmb-step mpmb-step--${width}`} onSubmit={submit} noValidate>
      <ErrorSummary errors={errors} focusKey={attempt} />
      <header className="mpmb-step__header">
        {kicker && <p className="mpmb-kicker">{kicker}</p>}
        <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
          {title}
        </h1>
        {intro && <div className="mpmb-lead">{intro}</div>}
      </header>
      <div className="mpmb-step__body">{children}</div>
      {(onContinue || !hideBack || secondaryAction) && (
        <div className="mpmb-actions">
          {!hideContinue && onContinue && (
            <Button type="submit" variant="primary" arrow loading={continueLoading}>
              {continueLabel}
            </Button>
          )}
          {secondaryAction}
          {!hideBack && (
            <Button variant="link" onClick={() => dispatch({ type: 'back' })}>
              ← Back
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
