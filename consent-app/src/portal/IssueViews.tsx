import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { ask, messageOf, PortalError } from './api';
import { issueQueue, newIssueId, type QueuedEntry } from './issueQueue';
import { CHANNELS, DEVICE_CODE, deviceCode, deviceLabel, FAULTS, faultText, kindLabel, kindsFor, severityLabel, SEVERITIES, statusLabel, type DeviceKind, type EquipmentList } from './equipment';
import { ErrorLine, Loading, useLoad } from './TeamViews';
import { stamp, type Role } from './types';

/**
 * The issue log, "Notebook" (4 November 2026): "Log a problem" on every
 * screen, a quick form that works on a phone and offline, and the notebook
 * of everything logged (firebase/functions/src/issues.ts).
 */

const TYPES = [
  ['eeg', 'Headset/EEG signal'],
  ['noise', 'Noise/interruption'],
  ['equipment', 'Equipment (laptop/iPad)'],
  ['software', 'Task/software'],
  ['participant', 'Participant'],
  ['timing', 'Timing/schedule'],
  ['other', 'Other'],
] as const;
const IMPACTS = [
  ['minor', 'Minor'],
  ['may-affect', 'May affect data'],
  ['unusable', 'Data unusable'],
] as const;
const STATUSES = [
  ['open', 'Open'],
  ['actioned', 'Action taken'],
  ['cleared', 'Cleared'],
  ['handled', 'Handled in analysis'],
  ['not-relevant', 'Not relevant'],
] as const;
const DONE = ['cleared', 'handled', 'not-relevant'];
const label = (list: readonly (readonly [string, string])[], v: string) => list.find(([k]) => k === v)?.[1] ?? v;

type About = { kind: 'person'; studyId: string; label?: string } | { kind: 'typed'; name: string; studyId: string | null; label?: string } | { kind: 'room'; label?: string };
interface Context {
  today: string;
  suggested: string | null;
  names: boolean;
  visits: { visitId: string; schoolName: string; days: string[]; today: boolean; label: string }[];
}
interface Pupils {
  pupils: { studyId: string; label: string }[];
  recordings: { recordingId: string; studyId: string | null; label: string }[];
}
export interface IssueRow {
  id: string;
  uid: string;
  authorName: string;
  deviceAt: string;
  receivedAt: string;
  visitId: string | null;
  schoolId: string | null;
  schoolName: string;
  visitLabel: string;
  about: (About & { label: string })[];
  type: string;
  impact: string;
  note: string;
  recordings: string[];
  device: { kind: DeviceKind; code: string } | null;
  faults: string[];
  channels: string[];
  severity: string | null;
  fixedAt: string | null;
  fixedBy: string;
  importedFrom: string;
  status: string;
  resolution: string;
  comments: { id: string; at: string; byName: string; text: string }[];
  actions: { id: string; at: string; byName: string; text: string; status: string | null }[];
  history: { at: string; byName: string; changes: Record<string, { from: unknown; to: unknown }> }[];
  mine: boolean;
  canEdit: boolean;
}

/** Local wall-clock time for a datetime-local input. */
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const clock = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso));

/* ── Sending, now or later ────────────────────────────────────────────── */

const offline = (e: unknown) => !(e instanceof PortalError) || e.code === 'network' || (e.code === 'server' && typeof navigator !== 'undefined' && navigator.onLine === false);

async function sendEntry(entry: QueuedEntry) {
  try {
    await ask('issue-log', { entry });
    return { result: 'sent' as const };
  } catch (e) {
    if (offline(e)) return { result: 'offline' as const };
    return { result: 'refused' as const, message: messageOf(e) };
  }
}

/** Sends whatever is waiting: now, when the connection comes back, and every minute while something waits. */
export function useIssueQueue() {
  const [waiting, setWaiting] = useState(0);
  const [refused, setRefused] = useState<string[]>([]);
  const flush = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const r = await issueQueue().flush(sendEntry);
    if (r.refused.length) setRefused((x) => [...x, ...r.refused.map((f) => `An entry from ${clock(f.entry.deviceAt)} could not be saved: ${f.message}`)]);
  }, []);
  useEffect(() => issueQueue().onChange(setWaiting), []);
  useEffect(() => {
    void flush();
    const on = () => void flush();
    window.addEventListener('online', on);
    const t = window.setInterval(on, 60_000);
    return () => {
      window.removeEventListener('online', on);
      window.clearInterval(t);
    };
  }, [flush]);
  return { waiting, refused, flush, clearRefused: () => setRefused([]) };
}

/* ── The button and the form ──────────────────────────────────────────── */

export function LogProblemButton({ role, waiting, onOpen }: { role: Role; waiting: number; onOpen: (pressedAt: Date) => void }) {
  void role;
  return (
    <button type="button" className="mpmb-issue__button" onClick={() => onOpen(new Date())} data-testid="log-problem">
      <span aria-hidden="true">✎</span> Log a problem
      {waiting ? (
        <span className="mpmb-issue__badge" role="status">
          {waiting} waiting to send
        </span>
      ) : null}
    </button>
  );
}

export function LogProblem({ role, pressedAt, onClose, editing, onSaved, preset }: { role: Role; pressedAt: Date; onClose: () => void; editing?: IssueRow; onSaved?: () => void; preset?: { kind: DeviceKind; code: string } }) {
  const team = role === 'pm' || role === 'researcher';
  const ctx = useLoad<Context>('issue-context');
  const [when, setWhen] = useState(() => localInput(editing ? new Date(editing.deviceAt) : pressedAt));
  const [whenTouched, setWhenTouched] = useState(false);
  const [visitId, setVisitId] = useState<string>(editing ? (editing.visitId ?? 'none') : '');
  const [about, setAbout] = useState<About[]>(editing ? editing.about : []);
  const [type, setType] = useState(editing?.type ?? (preset ? (preset.kind === 'headset' ? 'eeg' : 'equipment') : ''));
  const [impact, setImpact] = useState(editing?.impact ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [recordings, setRecordings] = useState<string[]>(editing?.recordings ?? []);
  // The device at fault (22 November 2026): from the register, or a code typed in.
  const equipment = useLoad<EquipmentList>('issue-equipment');
  const [device, setDevice] = useState<{ kind: DeviceKind; code: string } | null>(editing?.device ?? preset ?? null);
  const [deviceKind, setDeviceKind] = useState<DeviceKind | ''>(editing?.device?.kind ?? preset?.kind ?? '');
  const [typingCode, setTypingCode] = useState(false);
  const [codeText, setCodeText] = useState('');
  const [faults, setFaults] = useState<string[]>(editing?.faults ?? []);
  const [channels, setChannels] = useState<string[]>(editing?.channels ?? []);
  const [severity, setSeverity] = useState(editing?.severity ?? '');
  /** "Same problem": the note goes on that entry as a comment instead of a new entry. */
  const [addTo, setAddTo] = useState<string | null>(null);
  const kinds = kindsFor(type);
  const kind: DeviceKind | '' = kinds.length === 1 ? kinds[0] : deviceKind && kinds.includes(deviceKind) ? deviceKind : '';
  const registered = (equipment.value?.devices ?? []).filter((d) => d.kind === kind && d.status !== 'retired');
  const known = device ? (equipment.value?.devices ?? []).find((d) => d.code === device.code) : undefined;
  const alreadyOpen = (known?.openEntries ?? []).filter((o) => o.id !== editing?.id);
  const chooseDevice = (d: { kind: DeviceKind; code: string } | null) => {
    setDevice(d);
    setAddTo(null);
    if (d) setFaults((f) => f.filter((k) => FAULTS.some((x) => x.key === k && x.kinds.includes(d.kind))));
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  // While the sheet is open the page behind it stays still (20 November 2026: on an iPhone it scrolled and bounced).
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<Pupils | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Today's or the confirmed visit, once the list is in.
  useEffect(() => {
    if (!visitId && ctx.value) setVisitId(ctx.value.suggested ?? (ctx.value.visits.find((v) => v.today)?.visitId ?? 'none'));
  }, [ctx.value, visitId]);
  const day = when.slice(0, 10);
  const search = useCallback(
    async (text: string) => {
      try {
        setFound(await ask<Pupils>('issue-pupils', { q: text, visitId: visitId === 'none' ? '' : visitId, day }));
      } catch {
        setFound(null);
      }
    },
    [visitId, day],
  );
  useEffect(() => {
    const t = window.setTimeout(() => void search(q), 250);
    return () => window.clearTimeout(t);
  }, [q, search]);
  const chosen = about.filter((a): a is Extract<About, { kind: 'person' }> => a.kind === 'person').map((a) => a.studyId);
  const suggestedRecordings = (found?.recordings ?? []).filter((r) => r.studyId && (chosen.includes(r.studyId) || about.some((a) => a.kind === 'typed' && a.studyId === r.studyId)));
  const otherRecordings = (found?.recordings ?? []).filter((r) => !suggestedRecordings.includes(r));
  const reset = () => {
    setAbout([]);
    setType('');
    setImpact('');
    setNote('');
    setRecordings([]);
    setFaults([]);
    setChannels([]);
    setSeverity('');
    setAddTo(null);
    if (!preset) chooseDevice(null);
    void equipment.load();
    setQ('');
    setTyped('');
    setWhen(localInput(new Date()));
    setWhenTouched(false);
  };
  const save = async () => {
    setError(null);
    setDone(null);
    const deviceAt = whenTouched || editing ? new Date(when).toISOString() : pressedAt.toISOString();
    const usedDevice = device && kinds.includes(device.kind) ? device : null;
    const usedFaults = usedDevice ? faults : [];
    if (addTo && usedDevice) {
      // The same problem again: one entry, with each time it happened in its comments.
      if (!note.trim() && !usedFaults.length) return setError('Say what happened this time.');
      const visit = ctx.value?.visits.find((v) => v.visitId === visitId);
      const text = `Seen again ${stamp(deviceAt)}${visit ? ` at ${visit.label}` : ''}${usedFaults.length ? `: ${faultText(usedFaults, channels)}` : ''}${note.trim() ? `. ${note.trim()}` : ''}`;
      setBusy(true);
      try {
        await ask('issue-comment', { id: addTo, text });
        setDone(`Added to the entry already logged for ${usedDevice.code}.`);
        onSaved?.();
        reset();
      } catch (e) {
        setError(offline(e) ? 'No connection, so this can’t be added to that entry now. Untick “Same problem” to save it as a new entry on this phone.' : messageOf(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!type) return setError('Choose what kind of problem it was.');
    if (!impact) return setError('Choose how much it affects the data.');
    if (!note.trim() && !about.length && !usedFaults.length) return setError('Say what happened, or who it was about.');
    const entry: QueuedEntry = { id: editing?.id ?? newIssueId(), deviceAt, visitId: visitId === 'none' ? null : visitId, about: about.map(({ label: _l, ...a }) => a), type, impact, note: note.trim(), recordings, device: usedDevice, faults: usedFaults, channels: usedDevice?.kind === 'headset' && usedFaults.includes('channels') ? channels : [], severity: usedDevice && usedFaults.length && severity ? severity : null };
    setBusy(true);
    try {
      if (editing) {
        await ask('issue-edit', { id: editing.id, entry });
        onSaved?.();
        onClose();
        return;
      }
      const r = await sendEntry(entry);
      if (r.result === 'refused') {
        setError(r.message ?? 'It could not be saved.');
        return;
      }
      if (r.result === 'offline') {
        await issueQueue().add(entry);
        setDone(`Saved on this phone at ${clock(deviceAt)}: it will send when you are back online.`);
      } else setDone(`Logged at ${clock(deviceAt)}.`);
      onSaved?.();
      reset();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mpmb-issue__sheet" role="dialog" aria-modal="true" aria-labelledby="issue-title">
      <div className="mpmb-issue__panel">
        <div className="mpmb-issue__top">
          <h2 id="issue-title" className="mpmb-h2">
            {editing ? 'Change this entry' : 'Log a problem'}
          </h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="mpmb-issue__safe" role="note">
          <strong>Worried about a child’s safety or welfare?</strong> Tell the school’s DSL the same day, as the safeguarding procedure says, then <a href="#safeguarding-log/new" onClick={onClose}>log a safeguarding concern</a>. It goes to a separate log that only the PI and the project coordinator can read, not here.
        </p>
        <label className="mpmb-label" htmlFor="issue-when">
          Time
        </label>
        <input id="issue-when" type="datetime-local" className="mpmb-input" value={when} onChange={(e) => (setWhen(e.target.value), setWhenTouched(true))} />
        <label className="mpmb-label" htmlFor="issue-visit">
          Visit
        </label>
        <select id="issue-visit" className="mpmb-select" value={visitId} onChange={(e) => setVisitId(e.target.value)}>
          {(ctx.value?.visits ?? []).map((v) => (
            <option key={v.visitId} value={v.visitId}>
              {v.label}
              {v.today ? ' (today)' : ''}
            </option>
          ))}
          <option value="none">Not at a visit</option>
        </select>
        <fieldset className="mpmb-issue__fieldset">
          <legend className="mpmb-label">About (optional)</legend>
          <div className="mpmb-issue__chips">
            {about.map((a, i) => (
              <button key={i} type="button" className="mpmb-issue__chip is-on" onClick={() => setAbout(about.filter((_, j) => j !== i))} aria-label={`Remove ${a.label ?? ''}`}>
                {a.kind === 'room' ? 'Whole room/session' : a.kind === 'typed' ? a.name : (a.label ?? a.studyId)} ✕
              </button>
            ))}
            {!about.some((a) => a.kind === 'room') ? (
              <button type="button" className="mpmb-issue__chip" onClick={() => setAbout([...about, { kind: 'room', label: 'Whole room/session' }])}>
                + Whole room/session
              </button>
            ) : null}
          </div>
          {team ? (
            <>
              <input className="mpmb-input" placeholder="Search: name or study ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search for a pupil" />
              {q.length >= 2 && found ? (
                <div className="mpmb-issue__chips">
                  {found.pupils.filter((p) => !chosen.includes(p.studyId)).map((p) => (
                    <button key={p.studyId} type="button" className="mpmb-issue__chip" onClick={() => (setAbout([...about, { kind: 'person', studyId: p.studyId, label: p.label }]), setQ(''))}>
                      + {p.label}
                    </button>
                  ))}
                  {!found.pupils.length ? <span className="mpmb-hint">No one found.</span> : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="mpmb-issue__typed">
              <input className="mpmb-input" placeholder="First name and surname" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Pupil’s first name and surname" />
              <Button variant="secondary" disabled={!typed.trim()} onClick={() => (setAbout([...about, { kind: 'typed', name: typed.trim(), studyId: null }]), setTyped(''))}>
                Add
              </Button>
            </div>
          )}
        </fieldset>
        <fieldset className="mpmb-issue__fieldset">
          <legend className="mpmb-label">Type</legend>
          <div className="mpmb-issue__chips">
            {TYPES.map(([k, l]) => (
              <button key={k} type="button" className={`mpmb-issue__chip${type === k ? ' is-on' : ''}`} aria-pressed={type === k} onClick={() => setType(k)}>
                {l}
              </button>
            ))}
          </div>
        </fieldset>
        {kinds.length ? (
          <fieldset className="mpmb-issue__fieldset mpmb-issue__device">
            <legend className="mpmb-label">Which device? (optional)</legend>
            {kinds.length > 1 ? (
              <div className="mpmb-issue__chips">
                {kinds.map((k) => (
                  <button key={k} type="button" className={`mpmb-issue__chip${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k} onClick={() => (setDeviceKind(k), device?.kind !== k && chooseDevice(null))}>
                    {kindLabel(k)}
                  </button>
                ))}
              </div>
            ) : null}
            {kind ? (
              typingCode || (!registered.length && !device) ? (
                <div className="mpmb-issue__typed">
                  <input className="mpmb-input" placeholder={kind === 'headset' ? 'Code on the headset, e.g. E50211F7' : 'Code or name on its label'} value={codeText} onChange={(e) => setCodeText(e.target.value)} aria-label={`The ${kindLabel(kind).toLowerCase()}’s code`} autoCapitalize="characters" />
                  <Button variant="secondary" disabled={!DEVICE_CODE.test(deviceCode(codeText))} onClick={() => (chooseDevice({ kind, code: deviceCode(codeText) }), setTypingCode(false), setCodeText(''))}>
                    Use
                  </Button>
                </div>
              ) : (
                <select
                  className="mpmb-select"
                  aria-label={`Which ${kindLabel(kind).toLowerCase()}`}
                  value={device && device.kind === kind ? device.code : ''}
                  onChange={(e) => (e.target.value === '__type' ? setTypingCode(true) : chooseDevice(e.target.value ? { kind, code: e.target.value } : null))}
                >
                  <option value="">{equipment.value ? 'Choose…' : 'Loading the list…'}</option>
                  {device && device.kind === kind && !registered.some((d) => d.code === device.code) ? <option value={device.code}>{device.code} (new)</option> : null}
                  {registered.map((d) => (
                    <option key={d.code} value={d.code}>
                      {deviceLabel(d)}
                      {d.batch ? ` (${d.batch})` : ''} · {statusLabel(d.status)}
                      {d.open.length ? ` · ${d.open.length} open` : ''}
                    </option>
                  ))}
                  <option value="__type">Not in the list: type its code…</option>
                </select>
              )
            ) : null}
            {device && alreadyOpen.length ? (
              <div className="mpmb-issue__known" role="status">
                <p>
                  <strong>
                    Already logged for {device.code}
                    {known ? ` (${statusLabel(known.status)})` : ''}:
                  </strong>
                </p>
                <ul>
                  {alreadyOpen.map((o) => (
                    <li key={o.id}>
                      <button type="button" className={`mpmb-issue__knownitem${addTo === o.id ? ' is-on' : ''}`} aria-pressed={addTo === o.id} onClick={() => setAddTo(addTo === o.id ? null : o.id)}>
                        <span className="mpmb-hint">
                          {stamp(o.deviceAt)} · {o.importedFrom ? 'headset list' : o.authorName}
                          {o.severity ? ` · ${severityLabel(o.severity)}` : ''}
                        </span>
                        <span>{faultText(o.faults, o.channels) || o.note}</span>
                        <span className="mpmb-issue__knownact">{addTo === o.id ? '✓ Adding to this one' : 'Same problem: add to this one'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {addTo ? <p className="mpmb-hint">Your note goes on that entry as a comment, with the time. Nothing new is logged.</p> : <p className="mpmb-hint">If it’s one of these, tap it instead of logging it again.</p>}
              </div>
            ) : null}
            {device ? (
              <>
                <p className="mpmb-label">What’s wrong with it?</p>
                <div className="mpmb-issue__chips">
                  {FAULTS.filter((f) => f.kinds.includes(device.kind)).map((f) => (
                    <button key={f.key} type="button" className={`mpmb-issue__chip${faults.includes(f.key) ? ' is-on' : ''}`} aria-pressed={faults.includes(f.key)} onClick={() => setFaults(toggle(faults, f.key))}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {device.kind === 'headset' && faults.includes('channels') ? (
                  <>
                    <p className="mpmb-label">Which channels?</p>
                    <div className="mpmb-issue__channels">
                      {CHANNELS.map((c) => (
                        <button key={c} type="button" className={`mpmb-issue__chip${channels.includes(c) ? ' is-on' : ''}`} aria-pressed={channels.includes(c)} onClick={() => setChannels(toggle(channels, c))}>
                          {c}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {faults.length && !addTo ? (
                  <>
                    <p className="mpmb-label">How bad is it for the {device.kind === 'headset' ? 'headset' : 'device'}?</p>
                    <div className="mpmb-issue__chips">
                      {SEVERITIES.map(([k, l, d]) => (
                        <button key={k} type="button" className={`mpmb-issue__chip mpmb-issue__sev is-${k}${severity === k ? ' is-on' : ''}`} aria-pressed={severity === k} onClick={() => setSeverity(severity === k ? '' : k)}>
                          {l}: {d}
                        </button>
                      ))}
                    </div>
                    {severity === 'high' ? <p className="mpmb-hint">A high fault marks it out of service, so no one takes it on a visit until it’s fixed.</p> : null}
                  </>
                ) : null}
              </>
            ) : null}
          </fieldset>
        ) : null}
        <fieldset className="mpmb-issue__fieldset">
          <legend className="mpmb-label">Impact</legend>
          <div className="mpmb-issue__chips">
            {IMPACTS.map(([k, l]) => (
              <button key={k} type="button" className={`mpmb-issue__chip mpmb-issue__impact is-${k}${impact === k ? ' is-on' : ''}`} aria-pressed={impact === k} onClick={() => setImpact(k)}>
                {l}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="mpmb-label" htmlFor="issue-note">
          Note
        </label>
        <p className="mpmb-hint" id="issue-note-hint">
          What happened. Please don’t write pupils’ names here: use “About” above.
        </p>
        <textarea id="issue-note" className="mpmb-input mpmb-input--full" rows={4} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="issue-note-hint" />
        {suggestedRecordings.length || otherRecordings.length || recordings.length ? (
          <fieldset className="mpmb-issue__fieldset">
            <legend className="mpmb-label">Affected recordings (optional)</legend>
            <div className="mpmb-issue__chips">
              {[...suggestedRecordings, ...otherRecordings.filter((r) => recordings.includes(r.recordingId))].map((r) => (
                <button key={r.recordingId} type="button" className={`mpmb-issue__chip${recordings.includes(r.recordingId) ? ' is-on' : ''}`} aria-pressed={recordings.includes(r.recordingId)} onClick={() => setRecordings(recordings.includes(r.recordingId) ? recordings.filter((x) => x !== r.recordingId) : [...recordings, r.recordingId])}>
                  {r.label}
                </button>
              ))}
              {otherRecordings.length ? (
                <select className="mpmb-select" value="" onChange={(e) => e.target.value && setRecordings([...new Set([...recordings, e.target.value])])} aria-label="Add another recording">
                  <option value="">Another recording…</option>
                  {otherRecordings.filter((r) => !recordings.includes(r.recordingId)).map((r) => (
                    <option key={r.recordingId} value={r.recordingId}>
                      {r.label}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </fieldset>
        ) : null}
        <ErrorLine error={error} />
        {done ? (
          <p className="mpmb-issue__done" role="status">
            {done}
          </p>
        ) : null}
        <div className="mpmb-actions mpmb-issue__save">
          <Button onClick={() => void save()} loading={busy} block>
            {editing ? 'Save the change' : addTo ? 'Add to that entry' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── The notebook ─────────────────────────────────────────────────────── */

export function Notebook({ role, entryId, go }: { role: Role; entryId?: string; go: (h: string) => void }) {
  const team = role === 'pm' || role === 'researcher';
  const { value, error, load } = useLoad<{ issues: IssueRow[]; authors: { uid: string; name: string }[] }>('issue-list');
  const { waiting, flush } = useIssueQueue();
  const [f, setF] = useState({ school: '', visit: '', from: '', to: '', pupil: '', type: '', impact: '', status: 'todo', author: '', device: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const issues = value?.issues ?? [];
  const shown = useMemo(
    () =>
      issues.filter((i) => {
        const day = i.deviceAt.slice(0, 10);
        return (!f.school || i.schoolName === f.school) && (!f.visit || i.visitId === f.visit) && (!f.from || day >= f.from) && (!f.to || day <= f.to) && (!f.pupil || i.about.some((a) => a.label.toLowerCase().includes(f.pupil.toLowerCase()))) && (!f.type || i.type === f.type) && (!f.impact || i.impact === f.impact) && (!f.status || (f.status === 'todo' ? !DONE.includes(i.status) : i.status === f.status)) && (!f.author || i.uid === f.author) && (!f.device || i.device?.code === f.device);
      }),
    [issues, f],
  );
  const open = entryId ? issues.find((i) => i.id === entryId) : undefined;
  const schools = [...new Set(issues.map((i) => i.schoolName).filter(Boolean))].sort();
  const visits = [...new Map(issues.filter((i) => i.visitId).map((i) => [i.visitId!, `${i.schoolName} · ${i.visitLabel}`])).entries()];
  const devices = [...new Set(issues.flatMap((i) => (i.device ? [i.device.code] : [])))].sort().map((c): [string, string] => [c, c]);
  if (open) return <Entry issue={open} role={role} reload={load} back={() => go('#notebook')} />;
  return (
    <Loading error={error}>
      <p className="mpmb-hint">Every problem anyone in the team has logged, newest first, so you can see what is already known before logging it again. Faults with headsets, laptops and iPads are also listed device by device under <a href="#equipment">Equipment</a>. Each is kept with the time on the device that logged it; the team marks each one handled in the analysis, or not relevant.</p>
      {waiting ? (
        <Callout tone="warning" title={`${waiting} waiting to send`}>
          <p>Saved on this device and sent as soon as there is a connection.</p>
          <Button variant="secondary" onClick={() => void flush().then(load)}>
            Try now
          </Button>
        </Callout>
      ) : null}
      {role === 'pm' ? <DigestSettings /> : null}
      <details className="mpmb-issue__filters" open={team}>
        <summary>Filters</summary>
        <div className="mpmb-issue__filtergrid">
          <Select label="School" value={f.school} onChange={set('school')} options={schools.map((s) => [s, s])} />
          <Select label="Visit" value={f.visit} onChange={set('visit')} options={visits} />
          <label>
            From
            <input type="date" className="mpmb-input" value={f.from} onChange={set('from')} />
          </label>
          <label>
            To
            <input type="date" className="mpmb-input" value={f.to} onChange={set('to')} />
          </label>
          <label>
            Pupil
            <input className="mpmb-input" value={f.pupil} onChange={set('pupil')} placeholder="Name or study ID" />
          </label>
          <Select label="Type" value={f.type} onChange={set('type')} options={TYPES.map(([k, l]) => [k, l])} />
          <Select label="Impact" value={f.impact} onChange={set('impact')} options={IMPACTS.map(([k, l]) => [k, l])} />
          <Select label="Status" value={f.status} onChange={set('status')} options={[['todo', 'Still to do'], ...STATUSES.map(([k, l]): [string, string] => [k, l])]} />
          <Select label="Device" value={f.device} onChange={set('device')} options={devices} />
          <Select label="Logged by" value={f.author} onChange={set('author')} options={(value?.authors ?? []).map((a) => [a.uid, a.name])} />
        </div>
      </details>
      {!value ? (
        <p>Loading…</p>
      ) : !shown.length ? (
        <p>{issues.length ? 'Nothing matches the filters.' : 'Nothing logged yet.'}</p>
      ) : (
        <ul className="mpmb-issue__list">
          {shown.map((i) => (
            <li key={i.id}>
              <a className={`mpmb-issue__item is-${i.impact}`} href={`#notebook/${i.id}`}>
                <span className="mpmb-issue__when">
                  {stamp(i.deviceAt)}
                  {i.schoolName ? ` · ${i.schoolName}` : ' · Not at a visit'}
                </span>
                <span className="mpmb-issue__what">
                  <strong>{label(TYPES, i.type)}</strong> · {label(IMPACTS, i.impact)}
                  {i.device ? ` · ${i.device.code}` : ''}
                  {i.about.length ? ` · ${i.about.map((a) => a.label).join(', ')}` : ''}
                </span>
                {i.faults.length ? (
                  <span className="mpmb-issue__note">
                    {faultText(i.faults, i.channels)}
                    {i.severity ? ` · ${severityLabel(i.severity)}` : ''}
                    {i.fixedAt ? ' · fixed' : ''}
                  </span>
                ) : null}
                {i.note ? <span className="mpmb-issue__note">{i.note}</span> : null}
                <span className="mpmb-issue__meta">
                  <span className={`mpmb-issue__status is-${i.status}`}>{label(STATUSES, i.status)}</span> {i.authorName}
                  {i.comments.length ? ` · ${i.comments.length} comment${i.comments.length > 1 ? 's' : ''}` : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Loading>
  );
}

function Select({ label: l, value, onChange, options }: { label: string; value: string; onChange: (e: { target: { value: string } }) => void; options: [string, string][] }) {
  return (
    <label>
      {l}
      <select className="mpmb-select" value={value} onChange={onChange}>
        <option value="">All</option>
        {options.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

function Entry({ issue: i, role, reload, back }: { issue: IssueRow; role: Role; reload: () => Promise<void>; back: () => void }) {
  const team = role === 'pm' || role === 'researcher';
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState(i.status === 'open' ? 'actioned' : i.status);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [resolving, setResolving] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ studyId: string; label: string }[]>([]);
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
      await reload();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (resolving === null || q.length < 2) return setFound([]);
    const t = window.setTimeout(() => void ask<{ pupils: { studyId: string; label: string }[] }>('issue-pupils', { q, visitId: i.visitId ?? '' }).then((r) => setFound(r.pupils)), 250);
    return () => window.clearTimeout(t);
  }, [q, resolving, i.visitId]);
  return (
    <>
      <p>
        <Button variant="link" onClick={back}>
          ‹ Notebook
        </Button>
      </p>
      <div className={`mpmb-issue__entry is-${i.impact}`}>
        <h2 className="mpmb-h2">
          {label(TYPES, i.type)} · {label(IMPACTS, i.impact)}
        </h2>
        <p className="mpmb-hint">
          {stamp(i.deviceAt)} (on the device{i.receivedAt.slice(0, 16) !== i.deviceAt.slice(0, 16) ? `; received ${stamp(i.receivedAt)}` : ''}) · {i.schoolName ? `${i.schoolName} · ${i.visitLabel}` : 'Not at a visit'} · {i.authorName}
        </p>
        {i.device ? (
          <p>
            <strong>
              {kindLabel(i.device.kind)} <a href={`#equipment/${encodeURIComponent(i.device.code)}`}>{i.device.code}</a>
            </strong>
            {i.faults.length ? `: ${faultText(i.faults, i.channels)}` : ''}
            {i.severity ? ` · ${severityLabel(i.severity)}` : ''}
            {i.fixedAt ? ` · fixed ${stamp(i.fixedAt)} (${i.fixedBy})` : ''}
          </p>
        ) : null}
        {i.importedFrom ? <p className="mpmb-hint">Brought in from the {i.importedFrom.charAt(0).toLowerCase() + i.importedFrom.slice(1)}.</p> : null}
        {i.note ? <p className="mpmb-issue__notebody">{i.note}</p> : null}
        {i.about.length ? (
          <ul className="mpmb-issue__about">
            {i.about.map((a, n) => (
              <li key={n}>
                {a.label}
                {team && a.kind === 'typed' && !a.studyId ? (
                  <Button variant="link" onClick={() => (setResolving(n), setQ(a.name))}>
                    Resolve pupil
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {resolving !== null ? (
          <div className="mpmb-issue__resolve">
            <input className="mpmb-input" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the registry" />
            <div className="mpmb-issue__chips">
              {found.map((p) => (
                <button key={p.studyId} type="button" className="mpmb-issue__chip" onClick={() => void act(() => ask('issue-resolve-pupil', { id: i.id, index: resolving, studyId: p.studyId })).then(() => setResolving(null))}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {i.recordings.length ? <p>Recordings: {i.recordings.join(', ')}</p> : null}
        {i.canEdit ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Change
          </Button>
        ) : null}
      </div>
      <section className="mpmb-issue__triage" aria-labelledby="issue-actions">
        <h3 className="mpmb-h3" id="issue-actions">
          What’s been done · <span className={`mpmb-issue__status is-${i.status}`}>{label(STATUSES, i.status)}</span>
        </h3>
        {i.actions.length ? (
          <ul className="mpmb-issue__comments">
            {i.actions.map((a) => (
              <li key={a.id}>
                <span className="mpmb-hint">
                  {a.byName} · {stamp(a.at)}
                  {a.status ? ` · ${label(STATUSES, a.status)}` : ''}
                </span>
                <p>{a.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mpmb-hint">Nothing recorded yet.</p>
        )}
        {i.resolution && !i.actions.some((a) => a.text === i.resolution) ? <p>Resolution: {i.resolution}</p> : null}
        {team ? (
          <>
            <label className="mpmb-label" htmlFor="issue-action">
              Log an action
            </label>
            <textarea id="issue-action" className="mpmb-input mpmb-input--full" rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done, e.g. “Swapped the felts and tested: all green”" />
            <p className="mpmb-label">And it is now</p>
            <div className="mpmb-issue__chips">
              {STATUSES.filter(([k]) => k !== 'open').map(([k, l]) => (
                <button key={k} type="button" className={`mpmb-issue__chip${status === k ? ' is-on' : ''}`} aria-pressed={status === k} onClick={() => setStatus(k)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="mpmb-actions">
              <Button onClick={() => void act(() => ask('issue-action', { id: i.id, text: resolution, status })).then(() => setResolution(''))} loading={busy} disabled={!resolution.trim()}>
                Log the action
              </Button>
              {i.status !== 'open' ? (
                <Button variant="ghost" onClick={() => void act(() => ask('issue-action', { id: i.id, text: 'Reopened', status: 'open' }))}>
                  Reopen
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </section>
      <h3 className="mpmb-h3">Comments</h3>
      <ul className="mpmb-issue__comments">
        {i.comments.map((c) => (
          <li key={c.id}>
            <span className="mpmb-hint">
              {c.byName} · {stamp(c.at)}
            </span>
            <p>{c.text}</p>
          </li>
        ))}
      </ul>
      <textarea className="mpmb-input mpmb-input--full" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Add a comment" placeholder="Add a comment" />
      <div className="mpmb-actions">
        <Button variant="secondary" disabled={!comment.trim()} loading={busy} onClick={() => void act(() => ask('issue-comment', { id: i.id, text: comment })).then(() => setComment(''))}>
          Comment
        </Button>
      </div>
      <ErrorLine error={err} />
      {i.history.length ? (
        <>
          <h3 className="mpmb-h3">Changes</h3>
          <ul className="mpmb-issue__comments">
            {i.history.map((h, n) => (
              <li key={n}>
                <span className="mpmb-hint">
                  {h.byName} · {stamp(h.at)}
                </span>
                {Object.entries(h.changes).map(([k, c]) => (
                  <p key={k}>
                    {k}: <s>{show(c.from)}</s> → {show(c.to)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {editing ? <LogProblem role={role} pressedAt={new Date(i.deviceAt)} editing={i} onClose={() => setEditing(false)} onSaved={() => void reload()} /> : null}
    </>
  );
}

const show = (v: unknown) => (typeof v === 'string' ? v || '(empty)' : Array.isArray(v) ? (v.length ? v.map((x) => (typeof x === 'object' && x ? ((x as { name?: string; studyId?: string }).name ?? (x as { studyId?: string }).studyId ?? (x as { kind?: string }).kind) : String(x))).join(', ') : '(none)') : v === null ? '(none)' : String(v));

function DigestSettings() {
  const { value, load } = useLoad<{ settings: { to: string[]; sendEmpty: boolean } }>('issue-digest-settings');
  const [to, setTo] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!value) return null;
  const s = value.settings;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ask('issue-save-digest', { to: (to ?? '').split(/[\s,;]+/).filter(Boolean), sendEmpty: empty });
      setTo(null);
      await load();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const now = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await ask<{ sent: boolean; entries: number; to: string[] }>('issue-digest-now', { force: true });
      setMsg(r.sent ? `Sent to ${r.to.join(', ')} (${r.entries} today).` : 'Not sent.');
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="mpmb-issue__filters">
      <summary>Daily problems email (6 pm)</summary>
      {to === null ? (
        <>
          <p>
            To: {s.to.join(', ')}. {s.sendEmpty ? 'Sent even when nothing was logged.' : 'Not sent when nothing was logged.'}
          </p>
          <div className="mpmb-actions">
            <Button variant="secondary" onClick={() => (setTo(s.to.join(', ')), setEmpty(s.sendEmpty))}>
              Change
            </Button>
            <Button variant="ghost" onClick={() => void now()} loading={busy}>
              Send today’s now
            </Button>
          </div>
        </>
      ) : (
        <>
          <label className="mpmb-label" htmlFor="digest-to">
            Daily problems email to
          </label>
          <input id="digest-to" className="mpmb-input mpmb-input--full" value={to} onChange={(e) => setTo(e.target.value)} />
          <label className="mpmb-check">
            <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Send even when there’s nothing
          </label>
          <div className="mpmb-actions">
            <Button onClick={() => void save()} loading={busy}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setTo(null)}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {msg ? <p role="status">{msg}</p> : null}
      <ErrorLine error={err} />
    </details>
  );
}
