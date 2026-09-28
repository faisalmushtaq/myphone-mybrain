import type { ReactNode } from 'react';

interface Props {
  summary?: string;
  children: ReactNode;
  className?: string;
}

/** "Find out more" using the native details element, so it works with keyboards and screen readers. */
export function Disclosure({ summary = 'Find out more', children, className = '' }: Props) {
  return (
    <details className={`mpmb-disclosure ${className}`.trim()}>
      <summary className="mpmb-disclosure__summary">
        <span className="mpmb-disclosure__chevron" aria-hidden="true" />
        {summary}
      </summary>
      <div className="mpmb-disclosure__body">{children}</div>
    </details>
  );
}
