import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  kicker?: ReactNode;
  title: ReactNode;
  /** For the browser tab; defaults to the heading when it is plain text. */
  pageTitle?: string;
  intro?: ReactNode;
  children: ReactNode;
  width?: 'normal' | 'wide';
  className?: string;
}

/** Focus moves to each new screen's heading, except when the page first loads (so screen readers start at the top as usual). */
let pageJustLoaded = true;

/** The card every screen of the New Year break sits in: kicker, focused heading, intro, content. */
export function NyShell({ kicker, title, pageTitle, intro, children, width = 'wide', className = '' }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const name = pageTitle ?? (typeof title === 'string' ? title : 'New Year break');
    document.title = `${name.replace(/\.$/, '')} – New Year break (preview) – MyPhone/MyBrain`;
    if (pageJustLoaded) {
      pageJustLoaded = false;
      return;
    }
    const el = headingRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 140;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    el.focus({ preventScroll: true });
    // Once per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`mpmb-step mpmb-step--${width} ny-step ${className}`.trim()}>
      <header className="mpmb-step__header">
        {kicker && <p className="mpmb-kicker">{kicker}</p>}
        <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
          {title}
        </h1>
        {intro && <div className="mpmb-lead">{intro}</div>}
      </header>
      <div className="mpmb-step__body">{children}</div>
    </div>
  );
}

/** Marks wording that is a first draft, not yet agreed with the team or the ethics committee. Same look as the other apps' marker. */
export function NyDraft({ label = 'Draft wording' }: { label?: string }) {
  return (
    <span className="mpmb-draft" title="Draft wording for the preview: to be agreed with the team and the ethics committee before the study opens">
      {label}
    </span>
  );
}
