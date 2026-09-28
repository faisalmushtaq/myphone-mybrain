import type { ReactNode } from 'react';
import logo from './assets/logo-white.png';

const SITE = 'https://myphonemybrain.com';

/**
 * A simplified copy of the site's masthead and footer, used only in the
 * standalone preview build so the form can be reviewed in context. In the
 * real site the Jekyll layout provides the header and footer.
 */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="mpmb-site-header">
        <div className="mpmb-site-header__inner">
          <a className="mpmb-site-logo" href={`${SITE}/`} aria-label="MyPhone/MyBrain home">
            <img src={logo} alt="MyPhone MyBrain" width="205" height="62" />
          </a>
          <nav className="mpmb-site-nav" aria-label="Main navigation">
            <a href={`${SITE}/study/`}>About the study</a>
            <a href={`${SITE}/schools/`}>For schools</a>
            <a href={`${SITE}/families/`}>For families</a>
            <a href={`${SITE}/team/`}>Meet the team</a>
            <a href={`${SITE}/faq/`}>Questions</a>
            <a href={`${SITE}/contact/`} className="mpmb-site-nav__cta">
              Contact
            </a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="mpmb-site-footer">
        <div className="mpmb-site-footer__inner">
          <p>Researching how digital lives and adolescent brain development connect, with young people and schools in Bradford and Leeds.</p>
          <nav aria-label="Footer navigation">
            <a href={`${SITE}/privacy/`}>Data and privacy</a>
            <a href={`${SITE}/documents/`}>Documents and safeguards</a>
            <a href={`${SITE}/contact/`}>Contact</a>
          </nav>
        </div>
        <div className="mpmb-site-footer__meta">
          <span>© {new Date().getFullYear()} University of Leeds</span>
          <span>Funded by the Huo Family Foundation</span>
        </div>
      </footer>
    </>
  );
}
