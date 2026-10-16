import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { messageOf, when } from '../api';
import type { Staff } from '../StaffApp';

export interface FamilyRow {
  referenceCode: string;
  startedAt: string | null;
  schoolName: string;
  yearGroup: string;
  childName: string;
  parentName: string;
  relationship: string;
  phone: string | null;
  email: string | null;
  missing: 'choose' | 'screenshots' | 'young-part' | 'screen-time-on';
  linkOpened: boolean;
  screenTimeOff: boolean;
  reminders: { at: string | null; outcome: string; channel: string; kind: string }[];
  nextReminderAt: string | null;
  link: string;
  optedOut: boolean;
}

const MISSING: Record<FamilyRow['missing'], string> = {
  choose: 'Stopped before saying where the screen time comes from',
  screenshots: 'Screenshots from the parent’s phone',
  'young-part': 'The young person’s part',
  'screen-time-on': 'Screen time was off: should be ready now',
};

const OUTCOME: Record<string, string> = { sent: 'sent', 'not-configured': 'not sent (texts or emails not set up)', failed: 'failed', 'invalid-number': 'not a mobile number' };

function csv(rows: FamilyRow[]): string {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['reference', 'started', 'school', 'year_group', 'young_person', 'parent', 'relationship', 'mobile', 'email', 'missing', 'link_opened', 'reminders_sent', 'next_reminder', 'finish_link'];
  const lines = rows.map((r) => [r.referenceCode, r.startedAt?.slice(0, 10), r.schoolName, r.yearGroup, r.childName, r.parentName, r.relationship, r.phone, r.email, MISSING[r.missing], r.linkOpened ? 'yes' : 'no', r.reminders.filter((x) => x.outcome === 'sent').length, r.nextReminderAt?.slice(0, 10), r.link].map(cell).join(','));
  return [head.join(','), ...lines].join('\n');
}

/**
 * Families who started the schools study's form but haven't finished (16
 * October 2026): what is missing, their contact details, the reminders
 * already sent (three at most, sent automatically) and the link that
 * finishes it, so the team can contact them too. Opted-out families are
 * shown but marked: do not contact them.
 */
export function Families({ staff }: { staff: Staff }) {
  const [rows, setRows] = useState<FamilyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    staff
      .ask<{ families: FamilyRow[] }>('families')
      .then((r) => setRows(r.families))
      .catch((e) => setError(messageOf(e)));
    // Once, when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch {
      setCopied(null);
    }
  };

  const download = () => {
    if (!rows) return;
    const url = URL.createObjectURL(new Blob([csv(rows.filter((r) => !r.optedOut))], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `families-not-finished-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mpmb-tools__section">
      {error && (
        <Callout tone="important" role="alert">
          <p>{error}</p>
        </Callout>
      )}
      <section aria-labelledby="families-title">
        <h2 className="mpmb-h2" id="families-title">
          Families not finished ({rows ? rows.length : '…'})
        </h2>
        <p className="mpmb-hint">
          Started the form but the screen time hasn’t come. Each family gets up to three reminders automatically (48 hours after starting, then 5 and 12 days after that), by text, or by email when there is no mobile. You can
          contact them too: “Copy link” gives the link that finishes their form (it asks for the young person’s date of birth).
        </p>
        <div className="mpmb-actions">
          <Button variant="secondary" onClick={download} disabled={!rows?.length}>
            Download as a spreadsheet (CSV)
          </Button>
        </div>
        {rows && !rows.length && <p className="mpmb-hint">Nobody is waiting: every family that started has finished, or said no.</p>}
        <ul className="mpmb-tools__list" role="list">
          {(rows ?? []).map((r) => (
            <li key={r.referenceCode} className={`mpmb-tools__row${r.optedOut ? ' is-closed' : ''}`}>
              <span className="mpmb-tools__main">
                <strong>{r.childName}</strong>
                {` · ${r.schoolName}${r.yearGroup ? `, ${r.yearGroup}` : ''}`}
                {` · ${MISSING[r.missing]}`}
                {r.missing === 'young-part' ? (r.linkOpened ? ' (their link was opened)' : ' (their link not opened)') : ''}
                {` · started ${when(r.startedAt)} · ${r.referenceCode}`}
                <br />
                {r.parentName}
                {r.optedOut ? (
                  <strong> · opted out: do not contact</strong>
                ) : (
                  <>
                    {r.phone && (
                      <>
                        {' · '}
                        <a href={`tel:${r.phone.replace(/\s/g, '')}`}>{r.phone}</a>
                      </>
                    )}
                    {r.email && (
                      <>
                        {' · '}
                        <a href={`mailto:${r.email}`}>{r.email}</a>
                      </>
                    )}
                    {!r.phone && !r.email && ' · no contact details (started before they were asked)'}
                  </>
                )}
                <br />
                <span className="mpmb-hint">
                  {r.reminders.length ? `Reminders: ${r.reminders.map((x) => `${when(x.at)} ${x.channel === 'sms' ? 'text' : 'email'} ${OUTCOME[x.outcome] ?? x.outcome}`).join('; ')}` : 'No reminders yet'}
                  {r.nextReminderAt ? ` · next ${when(r.nextReminderAt)}` : ''}
                </span>
              </span>
              <span className="mpmb-tools__actions">
                <Button variant="link" onClick={() => void copy(r.link, r.referenceCode)}>
                  {copied === r.referenceCode ? 'Copied' : 'Copy link'}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
