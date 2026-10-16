import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { TextField } from '../components/ui/Field';
import { callTool, messageOf, when, type Overview } from './api';
import { Bookings } from './staff/Bookings';
import { Dashboard } from './staff/Dashboard';
import { Families } from './staff/Families';
import { OptOuts } from './staff/OptOuts';
import { Participants } from './staff/Participants';
import { Schools } from './staff/Schools';
import { Times } from './staff/Times';
import { Usage } from './staff/Usage';

const KEY_STORE = 'mpmb-staff-key';
/** The export runs every hour (five past); older than three hours means a run, or more, has failed. */
const EXPORT_STALE_MS = 3 * 3_600_000;
type Tab = 'schools-dashboard' | 'families' | 'schools' | 'opt-outs' | 'break-dashboard' | 'times' | 'bookings' | 'participants' | 'usage';
type Area = 'schools' | 'break' | 'site';
/**
 * The two studies kept apart (16 October 2026): the schools study (parents,
 * young people, schools) and the social media break study (adults at the
 * lab) each have their own tabs and their own dashboard; website use is the
 * site's, for both.
 */
const AREAS: { id: Area; label: string; tabs: { id: Tab; label: string }[] }[] = [
  {
    id: 'schools',
    label: 'Schools study (parents and young people)',
    tabs: [
      { id: 'schools-dashboard', label: 'How it’s going' },
      { id: 'families', label: 'Families not finished' },
      { id: 'schools', label: 'School uploads' },
      { id: 'opt-outs', label: 'Opt-outs' },
    ],
  },
  {
    id: 'break',
    label: 'Social media break study',
    tabs: [
      { id: 'break-dashboard', label: 'How it’s going' },
      { id: 'times', label: 'Lab times' },
      { id: 'bookings', label: 'Bookings' },
      { id: 'participants', label: 'Participants' },
    ],
  },
  { id: 'site', label: 'Website', tabs: [{ id: 'usage', label: 'Website use' }] },
];
const AREA_STORE = 'mpmb-staff-area';

function readArea(): Area {
  try {
    const v = window.sessionStorage.getItem(AREA_STORE);
    return v === 'break' || v === 'site' ? v : 'schools';
  } catch {
    return 'schools';
  }
}

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
  const [area, setAreaState] = useState<Area>(readArea);
  const [tab, setTab] = useState<Tab>(() => AREAS.find((a) => a.id === readArea())!.tabs[0].id);
  const setArea = (next: Area) => {
    setAreaState(next);
    setTab(AREAS.find((a) => a.id === next)!.tabs[0].id);
    try {
      window.sessionStorage.setItem(AREA_STORE, next);
    } catch {
      /* Remembered for this tab only, when it can be. */
    }
  };
  const tabs = AREAS.find((a) => a.id === area)!.tabs;

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
  const exportedAt = overview?.lastExportAt ?? null;
  const exportStale = !exportedAt || Date.now() - Date.parse(exportedAt) > EXPORT_STALE_MS;
  return (
    <div className="mpmb-step mpmb-step--wide mpmb-tools">
      <header className="mpmb-tools__head">
        <div>
          <p className="mpmb-kicker">MyPhone/MyBrain research team</p>
          <h1 className="mpmb-h1">Staff page</h1>
          {overview && (
            <p className={`mpmb-tools__export${exportStale ? ' is-stale' : ''}`} role={exportStale ? 'status' : undefined}>
              Data export last ran: {exportedAt ? when(exportedAt) : 'not known'}
              {exportStale && ' — more than 3 hours ago or unreadable, so OneDrive is not up to date (see docs/firebase.md, the hourly export)'}
            </p>
          )}
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
      <nav className="mpmb-tools__areas" aria-label="Studies">
        {AREAS.map((a) => (
          <button key={a.id} type="button" className={`mpmb-tools__area${area === a.id ? ' is-current' : ''}`} aria-current={area === a.id ? 'page' : undefined} onClick={() => setArea(a.id)}>
            {a.label}
          </button>
        ))}
      </nav>
      <nav className="mpmb-tools__tabs" aria-label="Sections">
        {tabs.map((t) => (
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
        {tab === 'schools-dashboard' && <Dashboard staff={staff} study="schools" />}
        {tab === 'break-dashboard' && <Dashboard staff={staff} study="break" />}
        {tab === 'families' && <Families staff={staff} />}
        {tab === 'opt-outs' && <OptOuts staff={staff} />}
        {tab === 'usage' && <Usage staff={staff} />}
      </div>
    </div>
  );
}
