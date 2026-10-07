import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { TextField } from '../components/ui/Field';
import { callTool, messageOf, type Overview } from './api';
import { Bookings } from './staff/Bookings';
import { Participants } from './staff/Participants';
import { Schools } from './staff/Schools';
import { Times } from './staff/Times';

const KEY_STORE = 'mpmb-staff-key';
type Tab = 'times' | 'bookings' | 'participants' | 'schools';
const TABS: { id: Tab; label: string }[] = [
  { id: 'times', label: 'Lab times' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'participants', label: 'Participants' },
  { id: 'schools', label: 'School uploads' },
];

function readKey(): string {
  try {
    return window.sessionStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

/** Everything a staff call needs: the key, and a way to ask with an action. */
export interface Staff {
  ask: <T>(action: string, data?: Record<string, unknown>) => Promise<T>;
  overview: Overview | null;
  reload: () => Promise<void>;
}

/**
 * The research team's page: lab times and bookings, participants and their
 * personal links, and the schools' upload passwords. Behind the staff key
 * (scripts/set-staff-key.sh), which is kept in this browser tab only, until
 * the tab is closed or "Sign out" is pressed.
 */
export function StaffApp() {
  const [key, setKey] = useState(readKey);
  const [typed, setTyped] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>('times');

  const ask = useCallback(<T,>(action: string, data: Record<string, unknown> = {}) => callTool<T>('staffApi', { ...data, staffKey: key, action }), [key]);

  const reload = useCallback(async () => {
    setOverview(await ask<Overview>('overview'));
  }, [ask]);

  const signIn = async (candidate: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await callTool<Overview>('staffApi', { staffKey: candidate, action: 'overview' });
      try {
        window.sessionStorage.setItem(KEY_STORE, candidate);
      } catch {
        /* this tab only, then */
      }
      setKey(candidate);
      setOverview(result);
      setSignedIn(true);
    } catch (e) {
      setError(messageOf(e));
      setSignedIn(false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    document.title = 'Staff – MyPhone/MyBrain';
    if (key) void signIn(key);
    // Once, with a key remembered in this tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = () => {
    try {
      window.sessionStorage.removeItem(KEY_STORE);
    } catch {
      /* nothing kept */
    }
    setKey('');
    setTyped('');
    setSignedIn(false);
    setOverview(null);
  };

  if (!signedIn) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (typed.trim()) void signIn(typed.trim());
    };
    return (
      <form className="mpmb-step mpmb-tools" onSubmit={submit}>
        <header className="mpmb-step__header">
          <p className="mpmb-kicker">MyPhone/MyBrain research team</p>
          <h1 className="mpmb-h1">Staff page</h1>
          <p className="mpmb-lead">Lab times and bookings for the social media break study, participants’ links, and the schools’ upload passwords.</p>
        </header>
        {error && (
          <Callout tone="important" role="alert">
            <p>{error}</p>
          </Callout>
        )}
        <TextField id="staff-key" label="Staff key" type="password" autoComplete="current-password" value={typed} onChange={(e) => setTyped(e.target.value)} hint="The long key the study lead shared with the team. It stays in this browser tab until you close it." />
        <div className="mpmb-actions">
          <Button type="submit" variant="primary" arrow loading={busy}>
            Sign in
          </Button>
        </div>
      </form>
    );
  }

  const staff: Staff = { ask, overview, reload };
  return (
    <div className="mpmb-step mpmb-step--wide mpmb-tools">
      <header className="mpmb-tools__head">
        <div>
          <p className="mpmb-kicker">MyPhone/MyBrain research team</p>
          <h1 className="mpmb-h1">Staff page</h1>
        </div>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </header>
      {overview && (!overview.ready.email || !overview.ready.sms) && (
        <Callout tone="info">
          <p>
            {!overview.ready.email && 'Emails are not set up yet, so no confirmations or reminders are sent (docs/booking.md). '}
            {!overview.ready.sms && 'Text reminders are not set up yet; the booking page does not offer them until they are (docs/booking.md).'}
          </p>
        </Callout>
      )}
      <nav className="mpmb-tools__tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`mpmb-tools__tab${tab === t.id ? ' is-current' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="mpmb-tools__panel">
        {tab === 'times' && <Times staff={staff} />}
        {tab === 'bookings' && <Bookings staff={staff} />}
        {tab === 'participants' && <Participants staff={staff} />}
        {tab === 'schools' && <Schools staff={staff} />}
      </div>
    </div>
  );
}
