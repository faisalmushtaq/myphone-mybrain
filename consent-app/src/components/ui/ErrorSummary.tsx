import { useEffect, useRef } from 'react';
import type { FieldError } from '../../lib/validation';

interface Props {
  errors: FieldError[];
  title?: string;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Lists every problem on the step and links to the field. Receives focus when
 * the set of problems changes so keyboard and screen-reader users know why
 * "Continue" did not work.
 */
export function ErrorSummary({ errors, title = 'There is a problem' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Keyed on content, not array identity, so re-renders never steal focus.
  const key = errors.map((e) => `${e.field}:${e.message}`).join('|');
  useEffect(() => {
    if (key) ref.current?.focus();
  }, [key]);

  if (!errors.length) return null;

  const focusField = (field: string) => {
    const el = document.getElementById(field);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    (el as HTMLElement).focus({ preventScroll: true });
  };

  return (
    <div className="mpmb-error-summary" role="alert" tabIndex={-1} ref={ref} aria-labelledby="mpmb-error-summary-title">
      <h2 className="mpmb-error-summary__title" id="mpmb-error-summary-title">
        {title}
      </h2>
      <ul className="mpmb-error-summary__list">
        {errors.map((e) => (
          <li key={e.field + e.message}>
            <a
              href={`#${e.field}`}
              onClick={(ev) => {
                ev.preventDefault();
                focusField(e.field);
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
