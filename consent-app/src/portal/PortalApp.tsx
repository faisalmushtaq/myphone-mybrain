import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { TextField } from '../components/ui/Field';
import { ask, checkVerified, completeLink, connection, createPasswordAccount, finishGoogleRedirect, leave, messageOf, MIN_PASSWORD, needsVerifying, pendingLink, refreshToken, resendVerification, sendLink, sendPasswordReset, setOwnPassword, signInWithGoogle, signInWithPassword, watchUser } from './api';
import { disablePush, enablePush, isAndroid, isIos, isStandalone, pushState, registerPortalWorker, type PushState } from './push';
import { AvailabilityView, Documents, MyVisits, Offers, RaHome, Training } from './RaViews';
import { Reports } from './Reports';
import { Audit, People, Person, Schools, Sessions, SettingsView, TeamHome, Visits } from './TeamViews';
import { VisitView } from './VisitView';
import { ROLE_LABEL, stamp, type Me, type MySummary, type Notification, type Role } from './types';
import { AvailabilityGrid } from './AvailabilityGrid';

/**
 * The staff portal (myphonemybrain.com/portal/): sign in with an email link,
 * ask for an account, then one section per study. The schools study is the
 * first built: research assistants' documents, training, availability and
 * offers; the team's people, visits and staffing. See docs/portal.md.
 */
type Study = 'school' | 'lab' | 'online';

function useHash(): [string, (h: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash || '#home');
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash || '#home');
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((h: string) => {
    if (window.location.hash === h) setHash(h);
    else window.location.hash = h;
  }, []);
  return [hash, go];
}

export function PortalApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped once a password account's address is verified, so the portal opens without a reload. */
  const [verified, setVerified] = useState(0);

  useEffect(() => {
    document.title = 'Staff portal – MyPhone/MyBrain';
    return watchUser(setUser);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      await refreshToken();
      setMe(await ask<Me>('me'));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    if (user && !needsVerifying(user)) void loadMe();
    else setMe(null);
  }, [user, loadMe, verified]);

  if (!connection()) {
    return (
      <Shell>
        <Callout tone="warning" title="The portal is not connected in this build">
          It needs the live Firebase backend.
        </Callout>
      </Shell>
    );
  }
  if (user === undefined) return <Shell>Loading…</Shell>;
  if (!user) return <SignIn />;
  if (needsVerifying(user)) return <VerifyEmail email={user.email ?? ''} done={async () => setVerified((n) => n + 1)} />;
  if (error)
    return (
      <Shell>
        <Callout tone="warning" role="alert">
          {error}
        </Callout>
        <Button variant="secondary" onClick={() => void leave()}>
          Sign out
        </Button>
      </Shell>
    );
  if (!me) return <Shell>Loading…</Shell>;
  if (!me.user || me.user.status === 'rejected') return <RequestAccess email={me.email} rejected={me.user?.status === 'rejected'} done={loadMe} />;
  if (me.user.status === 'pending')
    return (
      <Shell>
        <h1 className="mpmb-h1">Thank you, {me.user.name.split(' ')[0]}</h1>
        <p className="mpmb-lead">Your account is waiting for the project manager to approve it. We will email {me.email} when it is ready.</p>
        <div className="mpmb-actions">
          <Button variant="secondary" onClick={() => void loadMe()}>
            Check again
          </Button>
          <Button variant="ghost" onClick={() => void leave()}>
            Sign out
          </Button>
        </div>
      </Shell>
    );
  if (me.user.status === 'archived')
    return (
      <Shell>
        <p className="mpmb-lead">This account is closed. If you think that is a mistake, please contact the project manager.</p>
        <Button variant="ghost" onClick={() => void leave()}>
          Sign out
        </Button>
      </Shell>
    );
  return <Portal me={me} reloadMe={loadMe} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mpmb-tools mpmb-portal">
      <div className="container mpmb-portal__narrow">{children}</div>
    </div>
  );
}

/* ── Signing in ───────────────────────────────────────────────────────── */

const JUNK_HINT = 'If it doesn’t arrive within a few minutes, check Junk or Quarantine; it comes from noreply@myphone-mybrain.firebaseapp.com.';

/** After making an account with a password: the address must be verified from the email before the portal opens. */
function VerifyEmail({ email, done }: { email: string; done: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const check = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (await checkVerified()) await done();
      else setMessage({ tone: 'warning', text: 'Not verified yet. Open the link in the email we sent, then press this again.' });
    } catch (e) {
      setMessage({ tone: 'warning', text: messageOf(e) });
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    try {
      await resendVerification();
      setMessage({ tone: 'success', text: 'Sent again. It can take a minute or two.' });
    } catch (e) {
      setMessage({ tone: 'warning', text: messageOf(e) });
    }
  };
  return (
    <Shell>
      <p className="mpmb-kicker">MyPhone/MyBrain</p>
      <h1 className="mpmb-h1">Check your email to verify your address</h1>
      <p className="mpmb-lead">
        We sent a link to <strong>{email}</strong>. Open it to confirm the address is yours, then come back here.
      </p>
      <p className="mpmb-hint">{JUNK_HINT}</p>
      {message && (
        <Callout tone={message.tone} role="status">
          {message.text}
        </Callout>
      )}
      <div className="mpmb-actions">
        <Button variant="primary" loading={busy} onClick={() => void check()}>
          I have verified it
        </Button>
        <Button variant="secondary" onClick={() => void resend()}>
          Send the email again
        </Button>
        <Button variant="ghost" onClick={() => void leave()}>
          Sign out
        </Button>
      </div>
    </Shell>
  );
}

/** Signing in with a password, making an account with one, or resetting it (4 November 2026). */
function PasswordSignIn({ initialEmail }: { initialEmail: string }) {
  const [mode, setMode] = useState<'sign-in' | 'create' | 'reset'>('sign-in');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const switchTo = (m: 'sign-in' | 'create' | 'reset') => {
    setMode(m);
    setError(null);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Please enter your email address.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'sign-in') await signInWithPassword(email, password);
      else if (mode === 'create') await createPasswordAccount(email, password);
      else {
        await sendPasswordReset(email);
        setNotice(`If ${email.trim()} has an account, we have sent it a link to choose a new password. Open it, then sign in here.`);
        setMode('sign-in');
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mpmb-card" onSubmit={(e) => void submit(e)} noValidate>
      <h2 className="mpmb-h2">{mode === 'create' ? 'Create an account with a password' : mode === 'reset' ? 'Forgot your password?' : 'Sign in with a password'}</h2>
      {notice && (
        <Callout tone="success" role="status">
          {notice}
        </Callout>
      )}
      <TextField id="pw-email" label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode !== 'reset' && (
        <TextField id="pw-password" label="Password" type="password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} hint={mode === 'create' ? `At least ${MIN_PASSWORD} characters. We will email you to confirm your address.` : undefined} />
      )}
      {error && (
        <p className="mpmb-error" role="alert">
          {error}
        </p>
      )}
      <div className="mpmb-actions">
        <Button type="submit" variant="primary" loading={busy}>
          {mode === 'create' ? 'Create the account' : mode === 'reset' ? 'Email me a reset link' : 'Sign in'}
        </Button>
      </div>
      <p className="mpmb-hint">
        {mode !== 'reset' && (
          <Button variant="link" onClick={() => switchTo('reset')}>
            Forgot your password?
          </Button>
        )}{' '}
        {mode === 'sign-in' ? (
          <Button variant="link" onClick={() => switchTo('create')}>
            New here? Create an account with a password
          </Button>
        ) : (
          <Button variant="link" onClick={() => switchTo('sign-in')}>
            Back to signing in with a password
          </Button>
        )}
      </p>
    </form>
  );
}

/** Your details: set a password (signed in by link or Google), or change it. */
function PasswordSettings() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await setOwnPassword(password);
      setPassword('');
      setMessage({ tone: 'success', text: 'Password saved. You can now sign in with it, as well as with the email link.' });
    } catch (err) {
      setMessage({ tone: 'warning', text: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mpmb-card mpmb-portal__narrow" onSubmit={(e) => void save(e)}>
      <h2 className="mpmb-h2">Set or change your password</h2>
      <p className="mpmb-hint">Optional: a password lets you sign in without waiting for an email link. At least {MIN_PASSWORD} characters.</p>
      <TextField id="set-password" label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {message && (
        <Callout tone={message.tone} role="status">
          {message.text}
        </Callout>
      )}
      <div className="mpmb-actions">
        <Button type="submit" variant="secondary" loading={busy} disabled={password.length < MIN_PASSWORD}>
          Save password
        </Button>
      </div>
    </form>
  );
}

function SignIn() {
  const link = pendingLink();
  const [email, setEmail] = useState(link?.email ?? '');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishing = Boolean(link);

  useEffect(() => {
    // Opened from the link on the same browser: finish straight away.
    if (link?.email) {
      setBusy(true);
      void completeLink(link.email).catch((e) => {
        setError(messageOf(e));
        setBusy(false);
      });
    }
  }, []);

  useEffect(() => {
    void finishGoogleRedirect().catch((err) => setError(messageOf(err)));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Please enter your email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (finishing) await completeLink(email);
      else {
        await sendLink(email);
        setSent(true);
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <p className="mpmb-kicker">MyPhone/MyBrain</p>
      <h1 className="mpmb-h1">Staff portal</h1>
      {sent ? (
        <Callout tone="success" title="Check your email" role="status">
          <p>
            We sent a sign-in link to <strong>{email}</strong>. Open it on this device to sign in. It works once, for an hour.
          </p>
          <p className="mpmb-hint">{JUNK_HINT}</p>
          <Button variant="link" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </Callout>
      ) : finishing ? (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <p className="mpmb-lead">Confirm your email address to finish signing in.</p>
          <TextField id="portal-email" label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error ?? undefined} />
          <Button type="submit" variant="primary" arrow loading={busy}>
            Sign in
          </Button>
        </form>
      ) : (
        <>
          <p className="mpmb-lead">For the research team and research assistants.</p>
          {/* 1. A password: the quickest (5 November 2026). */}
          <PasswordSignIn initialEmail={email} />
          {/* 2. Google. */}
          <div className="mpmb-card">
            <p className="mpmb-hint">Or, if your email is a Google account (Gmail or Google Workspace):</p>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setError(null);
                void signInWithGoogle().catch((err) => setError(messageOf(err)));
              }}
            >
              Sign in with Google
            </Button>
          </div>
          {/* 3. The email link: slowest, so last. */}
          <form className="mpmb-card" onSubmit={(e) => void submit(e)} noValidate>
            <p className="mpmb-hint">Or get a one-time link by email (can take a few minutes to arrive).</p>
            <TextField id="portal-email" label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error ?? undefined} />
            <Button type="submit" variant="secondary" loading={busy}>
              Email me a sign-in link
            </Button>
          </form>
          <p className="mpmb-hint">New here? Create an account with a password above, or use Google or the email link, then ask for an account. Use the email address the team knows you by.</p>
        </>
      )}
    </Shell>
  );
}

function RequestAccess({ email, rejected, done }: { email: string; rejected: boolean; done: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', phone: '', requested: 'ra' as 'ra' | 'team' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ask('request-access', form);
      await done();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <h1 className="mpmb-h1">Ask for an account</h1>
      {rejected && <Callout tone="warning">Your earlier request was not approved. You can ask again.</Callout>}
      <p className="mpmb-lead">Signed in as {email}. The project manager approves each account.</p>
      <form onSubmit={(e) => void submit(e)}>
        <TextField id="ra-name" label="Your full name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextField id="ra-phone" label="Mobile number" required={false} autoComplete="tel" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} hint="So the team can reach you on the day of a visit." />
        <fieldset className="mpmb-field">
          <legend className="mpmb-label">I am joining as</legend>
          <label className="mpmb-portal__inline">
            <input type="radio" name="requested" checked={form.requested === 'ra'} onChange={() => setForm({ ...form, requested: 'ra' })} /> A research assistant
          </label>
          <label className="mpmb-portal__inline">
            <input type="radio" name="requested" checked={form.requested === 'team'} onChange={() => setForm({ ...form, requested: 'team' })} /> A staff member
          </label>
        </fieldset>
        {error && (
          <p className="mpmb-error" role="alert">
            {error}
          </p>
        )}
        <div className="mpmb-actions">
          <Button type="submit" variant="primary" loading={busy}>
            Ask for an account
          </Button>
          <Button variant="ghost" onClick={() => void leave()}>
            Sign out
          </Button>
        </div>
      </form>
    </Shell>
  );
}

/* ── Signed in ────────────────────────────────────────────────────────── */

interface NavItem {
  hash: string;
  label: string;
}

function navFor(role: Role): NavItem[] {
  if (role === 'ra')
    return [
      { hash: '#home', label: 'Checklist' },
      { hash: '#offers', label: 'Offers' },
      { hash: '#my-visits', label: 'My visits' },
      { hash: '#availability', label: 'Availability' },
      { hash: '#documents', label: 'Documents' },
      { hash: '#training', label: 'Training' },
    ];
  return [
    { hash: '#home', label: 'Overview' },
    { hash: '#visits', label: 'Visits' },
    { hash: '#grid', label: 'Availability' },
    { hash: '#people', label: 'People' },
    { hash: '#sessions', label: 'Training and pilots' },
    { hash: '#schools', label: 'Schools' },
    { hash: '#reports', label: 'Reports' },
    ...(role === 'pm' ? [{ hash: '#settings', label: 'Settings' }, { hash: '#audit', label: 'Audit log' }] : []),
  ];
}

function Portal({ me, reloadMe }: { me: Me; reloadMe: () => Promise<void> }) {
  const user = me.user!;
  const role = user.role!;
  const [hash, go] = useHash();
  const [study, setStudy] = useState<Study>('school');
  const [summary, setSummary] = useState<MySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const loadSummary = useCallback(async () => {
    try {
      setSummary(await ask<MySummary>('my-summary'));
      setSummaryError(null);
    } catch (e) {
      setSummaryError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    if (role === 'ra') void loadSummary();
  }, [role, loadSummary]);
  // The service worker opens the portal when a notification is tapped.
  useEffect(() => registerPortalWorker(), []);
  const reload = async () => {
    await Promise.all([loadSummary(), reloadMe()]);
  };

  const nav = navFor(role);
  const [route, arg] = hash.slice(1).split('/');
  const current = `#${route}`;

  const content = () => {
    if (route === 'notifications') return <Notifications go={go} reloadMe={reloadMe} />;
    if (route === 'profile') return <Profile me={me} reload={reloadMe} />;
    if (role === 'ra') {
      if (!summary) return summaryError ? <Callout tone="warning">{summaryError}</Callout> : <p>Loading…</p>;
      switch (route) {
        case 'documents':
          return <Documents summary={summary} reload={reload} />;
        case 'availability':
          return <AvailabilityView summary={summary} reload={reload} />;
        case 'offers':
          return <Offers summary={summary} reload={reload} />;
        case 'my-visits':
          return <MyVisits summary={summary} />;
        case 'training':
          return <Training summary={summary} reload={reload} />;
        default:
          return (
            <>
              <RaHome summary={summary} go={go} />
              <HomeScreenHelp />
            </>
          );
      }
    }
    switch (route) {
      case 'people':
        return <People role={role} go={go} />;
      case 'person':
        return <Person uid={arg} role={role} go={go} />;
      case 'visits':
        return <Visits go={go} />;
      case 'grid':
        return <AvailabilityGrid go={go} />;
      case 'visit':
        return <VisitView visitId={arg} role={role === 'pm' ? 'pm' : 'researcher'} go={go} />;
      case 'sessions':
        return <Sessions />;
      case 'schools':
        return <Schools role={role} />;
      case 'reports':
        return <Reports />;
      case 'settings':
        return role === 'pm' ? <SettingsView /> : null;
      case 'audit':
        return role === 'pm' ? <Audit /> : null;
      default:
        return <TeamHome role={role} go={go} />;
    }
  };
  const title = nav.find((n) => n.hash === current)?.label ?? (route === 'notifications' ? 'Notifications' : route === 'profile' ? 'Your details' : route === 'person' ? 'Person' : route === 'visit' ? 'Visit' : nav[0].label);

  return (
    <div className="mpmb-tools mpmb-portal">
      <div className="container">
        <header className="mpmb-tools__head mpmb-portal__head">
          <div>
            <p className="mpmb-kicker">MyPhone/MyBrain staff portal</p>
            <p className="mpmb-portal__who">
              {user.name} · {ROLE_LABEL[role]}
            </p>
          </div>
          <div className="mpmb-actions">
            <Button variant="ghost" onClick={() => go('#notifications')} aria-label={`Notifications, ${me.unread} unread`}>
              🔔 {me.unread > 0 ? <span className="mpmb-portal__count">{me.unread}</span> : null}
            </Button>
            <Button variant="ghost" onClick={() => go('#profile')}>
              Your details
            </Button>
            <Button variant="ghost" onClick={() => void leave()}>
              Sign out
            </Button>
          </div>
        </header>
        <nav className="mpmb-portal__studies" aria-label="Studies">
          {(
            [
              ['school', 'School study'],
              ['lab', 'Lab study'],
              ['online', 'Online study'],
            ] as [Study, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" className={`mpmb-portal__study${study === id ? ' is-current' : ''}`} aria-current={study === id ? 'page' : undefined} onClick={() => setStudy(id)}>
              {label}
            </button>
          ))}
        </nav>
        {study === 'lab' && (
          <Callout title="Lab study (social media break)">
            <p>The lab study’s tools (times, bookings and participants) are on the staff page for now, behind the staff key. They will move here next.</p>
            <a className="mpmb-btn mpmb-btn--secondary" href="/staff/">
              <span>Open the staff page</span>
            </a>
          </Callout>
        )}
        {study === 'online' && <Callout title="Online study">Not live yet. Its section will appear here when it is.</Callout>}
        {study === 'school' && (
          <>
            <nav className="mpmb-tools__tabs" aria-label="School study">
              {nav.map((n) => (
                <a key={n.hash} href={n.hash} className={`mpmb-tools__tab mpmb-portal__tab${current === n.hash || (n.hash === '#visits' && route === 'visit') || (n.hash === '#people' && route === 'person') ? ' is-current' : ''}`} aria-current={current === n.hash ? 'page' : undefined}>
                  {n.label}
                  {role === 'ra' && n.hash === '#offers' && summary && summary.assignments.some((a) => a.status === 'offered') ? <span className="mpmb-portal__count">{summary.assignments.filter((a) => a.status === 'offered').length}</span> : null}
                </a>
              ))}
            </nav>
            <h1 className="mpmb-h1 mpmb-portal__title">{title}</h1>
            {content()}
          </>
        )}
      </div>
    </div>
  );
}

function Notifications({ go, reloadMe }: { go: (h: string) => void; reloadMe: () => Promise<void> }) {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        setItems((await ask<{ notifications: Notification[] }>('notifications')).notifications);
        await ask('mark-read');
        await reloadMe();
      } catch (e) {
        setError(messageOf(e));
      }
    })();
  }, [reloadMe]);
  if (error) return <Callout tone="warning">{error}</Callout>;
  if (!items) return <p>Loading…</p>;
  if (!items.length) return <p>Nothing yet.</p>;
  return (
    <ul className="mpmb-tools__list">
      {items.map((n) => (
        <li key={n.id} className={`mpmb-tools__row mpmb-tools__row--stack${n.read ? '' : ' mpmb-portal__unread'}`}>
          <a href={n.link} onClick={(e) => (e.preventDefault(), go(n.link))}>
            <strong>{n.title}</strong>
          </a>
          <span>{n.body}</span>
          <span className="mpmb-hint">{stamp(n.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function Profile({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const u = me.user!;
  const [form, setForm] = useState({ name: u.name, phone: u.phone, smsOptIn: u.smsOptIn, notifyPrefs: u.notifyPrefs ?? { newDatesPush: true, newDatesEmail: true } });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ask('update-profile', form);
      await reload();
      setMessage('Saved.');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form className="mpmb-portal__narrow" onSubmit={(e) => void save(e)}>
      <p>Email: {u.email}</p>
      <TextField id="p-name" label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <TextField id="p-phone" label="Mobile number" required={false} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <label className="mpmb-portal__inline">
        <input type="checkbox" checked={form.smsOptIn} disabled={!form.phone} onChange={(e) => setForm({ ...form, smsOptIn: e.target.checked })} /> Also text me when I am selected for a visit
      </label>
      <fieldset className="mpmb-portal__prefs">
        <legend className="mpmb-label">When new school dates are put out</legend>
        <label className="mpmb-portal__inline">
          <input type="checkbox" checked={form.notifyPrefs.newDatesPush} onChange={(e) => setForm({ ...form, notifyPrefs: { ...form.notifyPrefs, newDatesPush: e.target.checked } })} /> Send a notification to my devices
        </label>
        <label className="mpmb-portal__inline">
          <input type="checkbox" checked={form.notifyPrefs.newDatesEmail} onChange={(e) => setForm({ ...form, notifyPrefs: { ...form.notifyPrefs, newDatesEmail: e.target.checked } })} /> Email me
        </label>
        <p className="mpmb-hint">Offers, changes to visits you’re booked on, and dates you’ve answered about always come by notification and email.</p>
      </fieldset>
      {error && (
        <p className="mpmb-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="mpmb-actions">
        <Button type="submit" variant="primary" loading={busy}>
          Save
        </Button>
      </div>
      <PushSettings />
      <HomeScreenHelp always />
      </form>
      <PasswordSettings />
    </>
  );
}

/** Notifications on this device: on or off, with a test, and why when they can't be. */
function PushSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void pushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);
  const act = async (fn: () => Promise<PushState | void>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fn();
      if (r) setState(r);
      if (done) setNote(done);
    } catch (e) {
      setNote(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const words: Record<PushState, string> = {
    on: 'Notifications are on for this device.',
    off: 'Notifications are off for this device.',
    denied: 'Notifications are blocked for this site in your settings. Allow them in the settings for this app or browser, then come back here.',
    'not-set-up': 'Notifications are not switched on for the portal yet. You will still get emails.',
    'needs-home-screen': 'On an iPhone or iPad, notifications only work from the portal saved to your Home Screen (see below). Open it from there, then turn them on.',
    unsupported: 'This browser can’t show notifications from the portal. You will still get emails.',
  };
  return (
    <section className="mpmb-card mpmb-portal__push" aria-labelledby="push-h">
      <h2 className="mpmb-h3" id="push-h">
        Notifications on this device
      </h2>
      <p role="status">{state ? words[state] : 'Checking…'}</p>
      <div className="mpmb-actions">
        {state === 'off' && (
          <Button type="button" variant="primary" loading={busy} onClick={() => void act(enablePush)}>
            Turn on notifications
          </Button>
        )}
        {state === 'on' && (
          <>
            <Button type="button" variant="secondary" loading={busy} onClick={() => void act(async () => void (await ask<{ sent: number }>('push-test')), 'Test sent: it should appear in a few seconds.')}>
              Send a test notification
            </Button>
            <Button type="button" variant="ghost" loading={busy} onClick={() => void act(disablePush)}>
              Turn off on this device
            </Button>
          </>
        )}
      </div>
      {note && <p className="mpmb-hint">{note}</p>}
    </section>
  );
}

/**
 * How to save the portal to the Home Screen, so it opens like an app and
 * (on iPhone) can show notifications. Shown when the portal is open in a
 * browser tab; `always` shows it in "Your details" even then.
 */
export function HomeScreenHelp({ always = false }: { always?: boolean }) {
  if (isStandalone()) return always ? <p className="mpmb-hint">You’re using the portal from your Home Screen.</p> : null;
  const ios = isIos();
  const android = isAndroid();
  return (
    <section className="mpmb-card mpmb-portal__homescreen" aria-labelledby="home-h">
      <h2 className="mpmb-h3" id="home-h">
        Save the portal to your Home Screen
      </h2>
      <p>It then opens like an app, and can tell you about new school dates and offers straight away.</p>
      {(ios || !android) && (
        <>
          <h3 className="mpmb-label">iPhone or iPad</h3>
          <ol className="mpmb-list">
            <li>Open this page in Safari.</li>
            <li>
              Tap the Share button <span aria-hidden="true">(the square with an arrow)</span>, then <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </li>
            <li>Open the portal from the new icon, sign in, and go to Your details → Turn on notifications.</li>
          </ol>
          <p className="mpmb-hint">Notifications need iOS 16.4 or later, and only work from the Home Screen icon.</p>
        </>
      )}
      {(android || !ios) && (
        <>
          <h3 className="mpmb-label">Android</h3>
          <ol className="mpmb-list">
            <li>Open this page in Chrome.</li>
            <li>
              Tap the menu <span aria-hidden="true">(⋮)</span>, then <strong>Add to Home screen</strong> or <strong>Install app</strong>.
            </li>
            <li>Then go to Your details → Turn on notifications.</li>
          </ol>
        </>
      )}
    </section>
  );
}
