import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'link' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  arrow?: boolean;
  block?: boolean;
  children: ReactNode;
}

/**
 * While loading the button is aria-disabled rather than disabled, so it keeps
 * keyboard focus and screen readers can still find it and hear the busy state.
 */
export function Button({ variant = 'primary', loading = false, arrow = false, block = false, className = '', children, disabled, type = 'button', onClick, ...rest }: Props) {
  const classes = ['mpmb-btn', `mpmb-btn--${variant}`, block ? 'mpmb-btn--block' : '', loading ? 'is-loading' : '', className].filter(Boolean).join(' ');
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button type={type} className={classes} disabled={disabled} aria-disabled={loading || undefined} aria-busy={loading || undefined} onClick={handleClick} {...rest}>
      {loading && <span className="mpmb-spinner" aria-hidden="true" />}
      <span>{children}</span>
      {arrow && !loading && (
        <span className="mpmb-btn__arrow" aria-hidden="true">
          →
        </span>
      )}
    </button>
  );
}
