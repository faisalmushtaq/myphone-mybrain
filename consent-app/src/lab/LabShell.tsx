import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../components/ui/Button';
import { ErrorSummary } from '../components/ui/ErrorSummary';
import type { FieldError } from '../lib/validation';
import { labStepTitles } from './model';
import { useLab } from './store';

interface Props {
  kicker?: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  errors?: FieldError[];
  onContinue?: () => void;
  continueLabel?: string;
  continueLoading?: boolean;
  secondaryAction?: ReactNode;
  hideBack?: boolean;
  hideContinue?: boolean;
  width?: 'normal' | 'wide';
}

/** The frame for every step of the lab study's flow: focused heading, error summary, content, actions. */
export function LabShell({ kicker, title, intro, children, errors = [], onContinue, continueLabel = 'Continue', continueLoading, secondaryAction, hideBack, hideContinue, width = 'normal' }: Props) {
  const { state, dispatch } = useLab();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.title = `${labStepTitles[state.stepId]} – MyPhone/MyBrain`;
    const el = headingRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 120;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    el.focus({ preventScroll: true });
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
      {children}
      {(!hideContinue || !hideBack || secondaryAction) && (
        <div className="mpmb-actions">
          {!hideContinue && (
            <Button type="submit" variant="primary" loading={continueLoading} arrow>
              {continueLabel}
            </Button>
          )}
          {!hideBack && state.stepId !== 'welcome' && (
            <Button variant="ghost" onClick={() => dispatch({ type: 'back' })}>
              Back
            </Button>
          )}
          {secondaryAction}
        </div>
      )}
    </form>
  );
}
