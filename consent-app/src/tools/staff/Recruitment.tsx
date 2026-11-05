import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { TextField } from '../../components/ui/Field';
import { messageOf, when } from '../api';
import type { Staff } from '../StaffApp';

type Group = 'break' | 'control';
interface GroupState {
  paused: boolean;
  message: string;
  changedAt: string | null;
}
interface Waiting {
  id: string;
  email: string;
  joinedAt: string | null;
  lastTry: string | null;
}
type State = Record<Group, GroupState> & { waiting: Record<Group, Waiting[]>; result?: { sent: number; failed: number; left: number } };

const LABELS: Record<Group, { name: string; page: string }> = {
  break: { name: 'Break group', page: '/break/take-part/' },
  control: { name: 'Control group', page: '/break/control/' },
};

/**
 * Pausing recruitment (5 November 2026): when the lab times are full, the team stops new sign-ups so nobody gives
 * consent and sends their data only to find no visit to book. People already taking part carry on as normal.
 */
export function Recruitment({ staff }: { staff: Staff }) {
  const [state, setState] = useState<State | null>(null);
  const [drafts, setDrafts] = useState<Record<Group, string>>({ break: '', control: '' });
  const [busy, setBusy] = useState<Group | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const show = (r: State) => {
    setState({ ...r, waiting: r.waiting ?? { break: [], control: [] } });
    setDrafts({ break: r.break.message, control: r.control.message });
  };
  useEffect(() => {
    staff.ask<State>('recruitment').then(show, (e) => setError(messageOf(e)));
    // Once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (group: Group, paused: boolean) => {
    setBusy(group);
    setError('');
    try {
      show(await staff.ask<State>('set-recruitment', { group, paused, message: drafts[group] }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const notify = async (group: Group) => {
    const n = state?.waiting[group].length ?? 0;
    if (!window.confirm(`Email all ${n} ${n === 1 ? 'person' : 'people'} waiting for the ${LABELS[group].name.toLowerCase()} that recruitment is open again? Each address is deleted once its email has gone.`)) return;
    setBusy(group);
    setError('');
    setNote('');
    try {
      const r = await staff.ask<State>('notify-waitlist', { group });
      show(r);
      if (r.result) setNote(`Sent ${r.result.sent}.${r.result.failed ? ` ${r.result.failed} could not be sent (still on the list).` : ''}${r.result.left ? ` ${r.result.left} still to send: press the button again.` : ''}`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Remove this address from the waiting list?')) return;
    try {
      show(await staff.ask<State>('remove-waiting', { id }));
    } catch (e) {
      setError(messageOf(e));
    }
  };

  if (!state) return error ? <Callout tone="important" role="alert"><p>{error}</p></Callout> : <p className="mpmb-hint">Loading…</p>;
  return (
    <section aria-labelledby="recruit-title">
      <h2 className="mpmb-h3" id="recruit-title">
        New sign-ups
      </h2>
      <p className="mpmb-hint">
        Pause a group when the lab times are full. While it is paused, the first page of the study shows your message instead of “New to the study”, and the server refuses new consents. People who have already given consent carry on as normal: check-ins, sending data, MyStory and booking all still work.
      </p>
      {note && (
        <Callout tone="success" role="status">
          <p>{note}</p>
        </Callout>
      )}
      {error && (
        <Callout tone="important" role="alert">
          <p>{error}</p>
        </Callout>
      )}
      {(['break', 'control'] as const).map((g) => {
        const s = state[g];
        return (
          <div key={g} className="mpmb-card" style={{ marginTop: '1rem' }}>
            <div className="mpmb-tools__bar">
              <h3 className="mpmb-h3">{LABELS[g].name}</h3>
              <span className="mpmb-tag">{s.paused ? 'Paused' : 'Open'}</span>
            </div>
            <p className="mpmb-hint">
              {s.paused ? 'Not taking new participants.' : 'Taking new participants.'} {s.changedAt ? `Last changed ${when(s.changedAt)}.` : ''} Page: <a href={LABELS[g].page}>{LABELS[g].page}</a>
            </p>
            <TextField id={`recruit-msg-${g}`} label="Message shown while paused" hint="Shown under “Recruitment is paused”. Up to 400 characters." value={drafts[g]} maxLength={400} onChange={(e) => setDrafts((d) => ({ ...d, [g]: e.target.value }))} />
            <div className="mpmb-tools__bar">
              {s.paused ? (
                <>
                  <Button onClick={() => void save(g, false)} disabled={busy !== null}>
                    {busy === g ? 'Saving…' : 'Reopen recruitment'}
                  </Button>
                  {drafts[g] !== s.message && (
                    <Button variant="ghost" onClick={() => void save(g, true)} disabled={busy !== null}>
                      Save message
                    </Button>
                  )}
                </>
              ) : (
                <Button onClick={() => void save(g, true)} disabled={busy !== null}>
                  {busy === g ? 'Saving…' : 'Pause recruitment'}
                </Button>
              )}
            </div>
            <h4 className="mpmb-h3" style={{ marginTop: '1.25rem' }}>
              Waiting list: {state.waiting[g].length} {state.waiting[g].length === 1 ? 'person' : 'people'}
            </h4>
            <p className="mpmb-hint">People who left an email address while recruitment was paused. Each gets one email when you press the button below (best after reopening), and their address is then deleted. Replies go to the study contact.</p>
            {state.waiting[g].length > 0 && (
              <>
                <ul className="mpmb-tools__list">
                  {state.waiting[g].map((p) => (
                    <li key={p.id}>
                      <span className="mpmb-mono">{p.email}</span> <span className="mpmb-hint">joined {when(p.joinedAt)}{p.lastTry ? ` · last try: ${p.lastTry}` : ''}</span>{' '}
                      <Button variant="link" onClick={() => void remove(p.id)}>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button variant={s.paused ? 'ghost' : 'primary'} onClick={() => void notify(g)} disabled={busy !== null}>
                  {busy === g ? 'Sending…' : `Email the ${state.waiting[g].length} waiting that it has reopened`}
                </Button>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
