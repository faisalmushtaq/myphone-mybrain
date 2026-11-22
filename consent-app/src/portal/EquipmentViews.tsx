import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { ask, messageOf } from './api';
import { DEVICE_CODE, DEVICE_KINDS, DEVICE_STATUSES, deviceCode, faultText, kindLabel, severityLabel, statusLabel, type DeviceKind, type DeviceRow, type EquipmentList } from './equipment';
import { LogProblem } from './IssueViews';
import { ErrorLine, Loading, useLoad } from './TeamViews';
import { stamp, type Role } from './types';

/**
 * The equipment register (22 November 2026): every headset, laptop and iPad,
 * whether it can go on a visit, and the faults logged against it that are not
 * yet fixed. It replaces the headset spreadsheet. Everyone sees it; the
 * research team and the project manager change a device's status and mark
 * faults fixed (firebase/functions/src/issues.ts, issuesStore.ts).
 */
export function Equipment({ role, code, go }: { role: Role; code?: string; go: (h: string) => void }) {
  const team = role === 'pm' || role === 'researcher';
  const { value, error, load } = useLoad<EquipmentList>('issue-equipment');
  const [kind, setKind] = useState<DeviceKind | ''>('');
  const [adding, setAdding] = useState(false);
  const devices = value?.devices ?? [];
  const open = code ? devices.find((d) => d.code === decodeURIComponent(code)) : undefined;
  if (code && value && open) return <DeviceView device={open} role={role} reload={load} back={() => go('#equipment')} />;
  const shown = devices.filter((d) => (!kind || d.kind === kind) && d.status !== 'retired');
  const kinds = DEVICE_KINDS.filter(([k]) => devices.some((d) => d.kind === k));
  return (
    <Loading error={error}>
      <p className="mpmb-hint">Every headset, laptop and iPad, and what is wrong with each. Check here before a visit, and before logging a fault: if it is already here, add to it rather than logging it again.</p>
      {code && value && !open ? <Callout tone="warning">There is no device {decodeURIComponent(code)} in the register.</Callout> : null}
      {role === 'pm' && value && !value.listImported ? <ImportList reload={load} /> : null}
      {!value ? (
        <p>Loading…</p>
      ) : (
        <>
          <p className="mpmb-equip__counts">
            {DEVICE_STATUSES.filter(([s]) => s !== 'retired')
              .map(([s, l]) => [l, devices.filter((d) => d.status === s && (!kind || d.kind === kind)).length] as const)
              .filter(([, n]) => n)
              .map(([l, n]) => `${n} ${l.toLowerCase()}`)
              .join(' · ') || 'Nothing in the register yet.'}
          </p>
          {kinds.length > 1 ? (
            <div className="mpmb-issue__chips" role="group" aria-label="Show">
              <button type="button" className={`mpmb-issue__chip${!kind ? ' is-on' : ''}`} aria-pressed={!kind} onClick={() => setKind('')}>
                All
              </button>
              {kinds.map(([k, l]) => (
                <button key={k} type="button" className={`mpmb-issue__chip${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {l}
                </button>
              ))}
            </div>
          ) : null}
          <ul className="mpmb-equip__list">
            {shown.map((d) => (
              <li key={d.code}>
                <a className={`mpmb-equip__item is-${d.status}`} href={`#equipment/${encodeURIComponent(d.code)}`}>
                  <span className="mpmb-equip__code">
                    <strong>{d.code}</strong> {kindLabel(d.kind)}
                    {d.batch ? ` · ${d.batch}` : ''}
                  </span>
                  <span className={`mpmb-equip__status is-${d.status}`}>{statusLabel(d.status)}</span>
                  <span className="mpmb-equip__faults">
                    {d.open.length ? (
                      <>
                        {d.worst ? <span className={`mpmb-equip__sev is-${d.worst}`}>{severityLabel(d.worst)}</span> : null} {faultText(d.faults, d.channels)}
                      </>
                    ) : (
                      'No open faults'
                    )}
                  </span>
                  <span className="mpmb-hint">
                    {d.open.length ? `${d.open.length} open · ` : ''}
                    {d.lastReported ? `last reported ${stamp(d.lastReported)}` : 'never reported'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {team ? (
            adding ? (
              <DeviceForm
                onDone={() => {
                  setAdding(false);
                  void load();
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <div className="mpmb-actions">
                <Button variant="secondary" onClick={() => setAdding(true)}>
                  Add a device
                </Button>
              </div>
            )
          ) : (
            <p className="mpmb-hint">A device not listed is added when someone logs a fault with its code.</p>
          )}
        </>
      )}
    </Loading>
  );
}

function ImportList({ reload }: { reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ask('issue-equipment-import');
      await reload();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Callout tone="info" title="Bring in the headset list">
      <p>The 16 headsets from the spreadsheet of 14 November 2026, each with its faults as an open entry (the sheet’s own words kept in the note). Headsets rated high go in as out of service, low and medium as use with care. Doing it twice changes nothing.</p>
      <Button onClick={() => void run()} loading={busy}>
        Bring in the headset list
      </Button>
      <ErrorLine error={err} />
    </Callout>
  );
}

function DeviceForm({ device, onDone, onCancel }: { device?: DeviceRow; onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState(device?.code ?? '');
  const [kind, setKind] = useState<DeviceKind>(device?.kind ?? 'headset');
  const [batch, setBatch] = useState(device?.batch ?? '');
  const [status, setStatus] = useState(device?.status ?? 'ok');
  const [notes, setNotes] = useState(device?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ask('issue-equipment-save', { device: { code, kind, batch, status, notes } });
      onDone();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mpmb-equip__form" aria-label={device ? `Change ${device.code}` : 'Add a device'}>
      <h3 className="mpmb-h3">{device ? 'Change the details' : 'Add a device'}</h3>
      {device ? null : (
        <>
          <label className="mpmb-label" htmlFor="equip-code">
            Code (as on its label)
          </label>
          <input id="equip-code" className="mpmb-input" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
          {code && !DEVICE_CODE.test(deviceCode(code)) ? <p className="mpmb-hint">Letters and numbers only.</p> : null}
        </>
      )}
      <label className="mpmb-label" htmlFor="equip-kind">
        Kind
      </label>
      <select id="equip-kind" className="mpmb-select" value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
        {DEVICE_KINDS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <label className="mpmb-label" htmlFor="equip-batch">
        Batch (for headsets: old or new)
      </label>
      <input id="equip-batch" className="mpmb-input" value={batch} onChange={(e) => setBatch(e.target.value)} />
      <label className="mpmb-label" htmlFor="equip-status">
        Status
      </label>
      <select id="equip-status" className="mpmb-select" value={status} onChange={(e) => setStatus(e.target.value)}>
        {DEVICE_STATUSES.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <label className="mpmb-label" htmlFor="equip-notes">
        Notes
      </label>
      <textarea id="equip-notes" className="mpmb-input mpmb-input--full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <ErrorLine error={err} />
      <div className="mpmb-actions">
        <Button onClick={() => void save()} loading={busy} disabled={!DEVICE_CODE.test(deviceCode(code))}>
          Save
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function DeviceView({ device: d, role, reload, back }: { device: DeviceRow; role: Role; reload: () => Promise<void>; back: () => void }) {
  const team = role === 'pm' || role === 'researcher';
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [how, setHow] = useState('');
  const [after, setAfter] = useState('ok');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fix = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ask('issue-equipment-fixed', { code: d.code, note: how, status: after });
      setFixing(false);
      setHow('');
      await reload();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>
        <Button variant="link" onClick={back}>
          ‹ Equipment
        </Button>
      </p>
      <div className={`mpmb-issue__entry mpmb-equip__entry is-${d.status}`}>
        <h2 className="mpmb-h2">
          {kindLabel(d.kind)} {d.code}
        </h2>
        <p>
          <span className={`mpmb-equip__status is-${d.status}`}>{statusLabel(d.status)}</span>
          {d.batch ? ` · ${d.batch} batch` : ''}
          {d.lastReported ? ` · last reported ${stamp(d.lastReported)}` : ''}
        </p>
        {d.notes ? <p className="mpmb-issue__notebody">{d.notes}</p> : null}
        <div className="mpmb-actions">
          <Button onClick={() => setLogging(true)}>Log a problem with {d.code}</Button>
          {team ? (
            <Button variant="secondary" onClick={() => setEditing(!editing)}>
              Change status or notes
            </Button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <DeviceForm
          device={d}
          onDone={() => {
            setEditing(false);
            void reload();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      <h3 className="mpmb-h3">Open faults{d.open.length ? ` (${d.open.length})` : ''}</h3>
      {d.openEntries.length ? (
        <ul className="mpmb-issue__list">
          {d.openEntries.map((o) => (
            <li key={o.id}>
              <a className={`mpmb-issue__item is-sev-${o.severity ?? 'none'}`} href={`#notebook/${o.id}`}>
                <span className="mpmb-issue__when">
                  {stamp(o.deviceAt)} · {o.importedFrom ? 'from the headset list' : o.authorName}
                </span>
                <span className="mpmb-issue__what">
                  <strong>{faultText(o.faults, o.channels) || 'Fault'}</strong>
                  {o.severity ? ` · ${severityLabel(o.severity)}` : ''}
                </span>
                {o.note ? <span className="mpmb-issue__note">{o.note}</span> : null}
                {o.comments ? <span className="mpmb-issue__meta">{`${o.comments} comment${o.comments > 1 ? 's' : ''}`}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>None. {d.all ? `${d.all} fault${d.all > 1 ? 's' : ''} logged before, all fixed.` : 'Nothing has been logged against it.'}</p>
      )}
      {team && d.openEntries.length ? (
        fixing ? (
          <section className="mpmb-equip__form" aria-label="Mark fixed">
            <label className="mpmb-label" htmlFor="equip-how">
              What was done to fix it?
            </label>
            <textarea id="equip-how" className="mpmb-input mpmb-input--full" rows={2} value={how} onChange={(e) => setHow(e.target.value)} placeholder="e.g. new felts on O1 and O2, tested on Lu: all green" />
            <label className="mpmb-label" htmlFor="equip-after">
              Its status now
            </label>
            <select id="equip-after" className="mpmb-select" value={after} onChange={(e) => setAfter(e.target.value)}>
              {DEVICE_STATUSES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <p className="mpmb-hint">Each of the {d.openEntries.length} open faults is marked fixed, with your note as a comment. Their status for the analysis does not change.</p>
            <div className="mpmb-actions">
              <Button onClick={() => void fix()} loading={busy} disabled={!how.trim()}>
                Mark fixed
              </Button>
              <Button variant="ghost" onClick={() => setFixing(false)}>
                Cancel
              </Button>
            </div>
          </section>
        ) : (
          <div className="mpmb-actions">
            <Button variant="secondary" onClick={() => setFixing(true)}>
              Mark the faults fixed
            </Button>
          </div>
        )
      ) : null}
      <ErrorLine error={err} />
      {d.history.length ? (
        <>
          <h3 className="mpmb-h3">History</h3>
          <ul className="mpmb-issue__comments">
            {[...d.history].reverse().map((h, n) => (
              <li key={n}>
                <span className="mpmb-hint">
                  {h.byName} · {stamp(h.at)}
                </span>
                <p>
                  {Object.entries(h.changes)
                    .map(([k, c]) => (k === 'added' ? 'Added to the register' : k === 'status' ? `Status: ${c.from ? statusLabel(String(c.from)) : '(new)'} → ${statusLabel(String(c.to))}` : `${k}: ${String(c.from ?? '') || '(empty)'} → ${String(c.to ?? '') || '(empty)'}`))
                    .join('; ')}
                  {h.note ? `. ${h.note}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {logging ? <LogProblem role={role} pressedAt={new Date()} preset={{ kind: d.kind, code: d.code }} onClose={() => setLogging(false)} onSaved={() => void reload()} /> : null}
    </>
  );
}
