import type { ReactNode } from 'react';

interface Props {
  tone?: 'info' | 'important' | 'success' | 'warning';
  title?: string;
  children: ReactNode;
  role?: 'status' | 'alert';
  className?: string;
}

export function Callout({ tone = 'info', title, children, role, className = '' }: Props) {
  return (
    <div className={`mpmb-callout mpmb-callout--${tone} ${className}`.trim()} role={role}>
      {title && <p className="mpmb-callout__title">{title}</p>}
      <div className="mpmb-callout__body">{children}</div>
    </div>
  );
}
