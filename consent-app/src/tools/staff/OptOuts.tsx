import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { SelectField, TextField } from '../../components/ui/Field';
import { messageOf, when } from '../api';
import type { Staff } from '../StaffApp';

export interface OptOutRow {
  optOutId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  schoolId: string;
  schoolName: string;
  yearGroup: string;
  className: string;
  parentName: string;
  receivedOn: string;
  afterWorkshop: boolean;
  notes: string;
  status: 'active' | 'cancelled';
  cancelReason: string | null;
  recordedAt: string | null;
  onWebsite: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = { firstName: '', lastName: '', dateOfBirth: '', schoolId: '', yearGroup: '', className: '', parentName: '', receivedOn: today(), afterWorkshop: false, notes: '' };

/**
 * The opt-outs from the workshop that parents and carers email to
 * brainpop@leeds.ac.uk (decided 7 October 2026: by email only, no form, no
 * paper slip). Log each one here as it arrives; the hourly export then flags
 * the young person in the family records and the schools' UPN lists, and
 * lists every opt-out in schools/identifying/opt_outs.tsv. An opt-out after
 * the workshop withdraws the data too, as far as possible.
 */
export function OptOuts({ staff }: { staff: Staff }) {
  const [rows, setRows] = useState<OptOutRow[] | null>(null);
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = async () => {
    try {
      const r = await staff.ask<{ optOuts: OptOutRow[]; schools: { id: string; name: string }[] }>('opt-outs');
      setRows(r.optOuts);
      setSchools(r.schools);
    } catch (e) {
      setError(messageOf(e));
    }
  };
  useEffect(() => {
    void load();
    // Once, when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    setBusy('add');
    setError(null);
    setNotice(null);
    try {
      await staff.ask('add-opt-out', { optOut: { ...form, dateOfBirth: form.dateOfBirth || null } });
      setNotice(`Logged: ${form.firstName.trim()} ${form.lastName.trim()} is opted out. The export flags them from the next hour.`);
      setForm({ ...blank, receivedOn: today() });
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (row: OptOutRow) => {
    setBusy(row.optOutId);
    setError(null);
    try {
      await staff.ask('cancel-opt-out', { optOutId: row.optOutId, reason });
      setCancelling(null);
      setReason('');
      setNotice(`${row.firstName} ${row.lastName} is back in: the opt-out is kept, marked cancelled.`);
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const active = (rows ?? []).filter((r) => r.status === 'active');

  return (
    <div className="mpmb-tools__section">
      {error && (
        <Callout tone="important" role="alert">
          <p>{error}</p>
        </Callout>
      )}
      {notice && (
        <Callout tone="success" role="status">
          <p>{notice}</p>
        </Callout>
      )}

      <section className="mpmb-card" aria-labelledby="optout-add">
        <h2 className="mpmb-h3" id="optout-add">
          Log an opt-out email
        </h2>
        <p className="mpmb-hint">Parents and carers opt their child out of the workshop by emailing brainpop@leeds.ac.uk, after two warnings on the website. Only a parent or carer can opt a child out. Opting out also means no linking with records, and no data at all.</p>
        <div className="mpmb-tools__grid">
          <TextField id="oo-first" label="Young person’s first name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <TextField id="oo-last" label="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <SelectField id="oo-school" label="School" value={form.schoolId} onChange={(e) => setForm({ ...form, schoolId: e.target.value })} placeholder="Choose the school" options={schools.map((x) => ({ value: x.id, label: x.name }))} />
          <TextField id="oo-year" label="Year group" required={false} value={form.yearGroup} onChange={(e) => setForm({ ...form, yearGroup: e.target.value })} />
          <TextField id="oo-class" label="Class" required={false} value={form.className} onChange={(e) => setForm({ ...form, className: e.target.value })} />
          <TextField id="oo-dob" label="Date of birth, if given" required={false} type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
          <TextField id="oo-parent" label="Parent or carer’s name" required={false} value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} />
          <TextField id="oo-received" label="Email received on" type="date" value={form.receivedOn} onChange={(e) => setForm({ ...form, receivedOn: e.target.value })} />
          <TextField id="oo-notes" label="Notes" required={false} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} hint="For example, who replied to confirm." />
        </div>
        <label className="mpmb-notsure">
          <input type="checkbox" checked={form.afterWorkshop} onChange={(e) => setForm({ ...form, afterWorkshop: e.target.checked })} /> It came after the workshop: withdraw the data already collected, as far as possible
        </label>
        <div className="mpmb-actions">
          <Button variant="primary" loading={busy === 'add'} disabled={!form.firstName.trim() || !form.lastName.trim() || !form.schoolId} onClick={() => void add()}>
            Log the opt-out
          </Button>
        </div>
      </section>

      <section aria-labelledby="optout-list">
        <h2 className="mpmb-h2" id="optout-list">
          Opted out ({rows ? active.length : '…'})
        </h2>
        {rows && !rows.length && <p className="mpmb-hint">None logged.</p>}
        <ul className="mpmb-tools__list" role="list">
          {(rows ?? []).map((r) => (
            <li key={r.optOutId} className={`mpmb-tools__row${r.status === 'cancelled' ? ' is-closed' : ''}`}>
              <span className="mpmb-tools__main">
                <strong>
                  {r.firstName} {r.lastName}
                </strong>
                {' · '}
                {r.schoolName}
                {r.yearGroup || r.className ? `, ${[r.yearGroup, r.className].filter(Boolean).join(' ')}` : ''}
                {r.dateOfBirth ? ` · born ${r.dateOfBirth}` : ''}
                {` · email of ${r.receivedOn}${r.parentName ? ` from ${r.parentName}` : ''}`}
                {r.afterWorkshop ? ' · after the workshop: withdraw the data' : ''}
                {r.onWebsite ? ' · has a record on the website' : ''}
                {r.status === 'cancelled' ? ` · cancelled${r.cancelReason ? ` (${r.cancelReason})` : ''}` : ''}
                {r.notes ? ` · ${r.notes}` : ''}
                {r.recordedAt ? ` · logged ${when(r.recordedAt)}` : ''}
              </span>
              {r.status === 'active' && (
                <span className="mpmb-tools__actions">
                  {cancelling === r.optOutId ? (
                    <>
                      <TextField id={`oo-reason-${r.optOutId}`} label="Why" required={false} value={reason} onChange={(e) => setReason(e.target.value)} hint="For example, the parent opted back in." />
                      <Button variant="danger" loading={busy === r.optOutId} onClick={() => void cancel(r)}>
                        Cancel the opt-out
                      </Button>
                      <Button variant="ghost" onClick={() => setCancelling(null)}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button variant="link" onClick={() => setCancelling(r.optOutId)}>
                      Opted back in?
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
