import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { TextField } from '../components/ui/Field';
import { ask, messageOf } from './api';
import { ErrorLine } from './TeamViews';
import { stamp } from './types';

/* ── The email to a school: who is coming on which days (names only) ──── */

interface SchoolPreview {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  intro: string;
  includeDbs: boolean;
  warnings: string[];
  hasDbsPassword: boolean;
  update: boolean;
  lastSent: { at: string | null; byName: string; to: string[]; includeDbs: boolean } | null;
}

/**
 * "Email the school": a preview of what the school gets (the days, times and
 * place, and the full names of those confirmed each day; with DBS details on,
 * a link to the school's password-protected DBS page, never the numbers). The
 * opening is editable and kept as the school's own.
 */
export function SchoolEmail({ visitId, update, pm, onSent, close }: { visitId: string; update: boolean; pm: boolean; onSent: (message: string) => void; close: () => void }) {
  const [preview, setPreview] = useState<SchoolPreview | null>(null);
  const [intro, setIntro] = useState<string | null>(null);
  const [includeDbs, setIncludeDbs] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      ask<SchoolPreview>('school-email-preview', { visitId, update, ...(intro !== null ? { intro } : {}), ...(includeDbs !== null ? { includeDbs } : {}) })
        .then((p) => {
          if (!live) return;
          setPreview(p);
          setError(null);
        })
        .catch((e) => live && setError(messageOf(e)));
    }, intro === null ? 0 : 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [visitId, update, intro, includeDbs]);
  const send = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await ask('send-school-email', { visitId, update: preview.update, intro: intro ?? preview.intro, includeDbs: preview.includeDbs });
      onSent(`Emailed ${preview.to.join(', ')}${preview.cc.length ? `, copying ${preview.cc.join(', ')}` : ''}.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mpmb-card mpmb-portal__dialog" aria-labelledby="se-h">
      <h3 className="mpmb-h3" id="se-h">
        {update ? 'Send the school an update' : 'Email the school'}
      </h3>
      {!preview ? (
        <p>{error ?? 'Making the email…'}</p>
      ) : (
        <>
          <p className="mpmb-hint">
            To {preview.to.join(', ') || 'nobody yet'} · Copy to {preview.cc.join(', ')} · Replies go to brainpop@leeds.ac.uk. Sent from the study’s email account as “MyPhone/MyBrain team”.
          </p>
          {preview.lastSent && (
            <p className="mpmb-hint">
              Last sent {stamp(preview.lastSent.at)} by {preview.lastSent.byName} to {preview.lastSent.to.join(', ')}
              {preview.lastSent.includeDbs ? ', with the DBS page' : ''}.
            </p>
          )}
          <label className="mpmb-portal__inline">
            <input type="checkbox" checked={preview.includeDbs} onChange={(e) => setIncludeDbs(e.target.checked)} /> Include DBS details (a link to the school’s password-protected DBS page; numbers are never emailed)
          </label>
          {preview.warnings.map((w) => (
            <Callout key={w} tone="warning">
              {w}
              {pm && w.includes('no DBS page password') && (
                <>
                  {' '}
                  <a href="#schools">Make one under Schools</a>.
                </>
              )}
            </Callout>
          ))}
          <label className="mpmb-label" htmlFor="se-intro">
            Opening (kept for this school next time)
          </label>
          <textarea id="se-intro" className="mpmb-input" rows={4} value={intro ?? preview.intro} onChange={(e) => setIntro(e.target.value)} />
          <p className="mpmb-label">Subject: {preview.subject}</p>
          <pre className="mpmb-portal__email" aria-label="The email">
            {preview.body}
          </pre>
        </>
      )}
      <ErrorLine error={preview ? error : null} />
      <div className="mpmb-actions">
        <Button variant="primary" loading={busy} disabled={!preview || !preview.to.length} onClick={() => void send()}>
          Send to the school
        </Button>
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
      </div>
    </section>
  );
}

/* ── The allocations email to the team ──────────────────────────────── */

interface Sections {
  subject: string;
  intro: string;
  allocations: string;
  travel: string;
  checks: string;
  closing: string;
}

interface TeamPreview {
  schoolId: string;
  schoolName: string;
  from: string;
  to: string;
  sections: Sections;
  made: Sections;
  update: boolean;
  recipients: { name: string; email: string }[];
  lastSent: { at: string | null; byName: string } | null;
  changed: boolean;
}

const SECTION_LABEL: Record<keyof Sections, string> = { subject: 'Subject', intro: 'Opening', allocations: 'Allocations', travel: 'Travel arrangements', checks: 'DBS and ID checks', closing: 'Closing' };

/**
 * "Email the team": the allocations email for a visit, or for a school between
 * two dates. Every part is made from the portal and can be edited; the opening
 * and closing can be kept as the sender's own.
 */
export function TeamEmail({ target, update, onSent, close }: { target: { visitId: string } | { schoolId: string; from: string; to: string }; update: boolean; onSent: (message: string) => void; close: () => void }) {
  const [preview, setPreview] = useState<TeamPreview | null>(null);
  const [edits, setEdits] = useState<Partial<Sections>>({});
  const [showRoles, setShowRoles] = useState(false);
  const [includeTeam, setIncludeTeam] = useState(false);
  const [mode, setMode] = useState<'individual' | 'bcc'>('bcc');
  const [saveTemplates, setSaveTemplates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(target);
  useEffect(() => {
    let live = true;
    ask<TeamPreview>('team-email-preview', { ...(JSON.parse(key) as Record<string, unknown>), update, showRoles, includeTeam })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setError(null);
      })
      .catch((e) => live && setError(messageOf(e)));
    return () => {
      live = false;
    };
  }, [key, update, showRoles, includeTeam]);
  const value = (k: keyof Sections) => edits[k] ?? preview?.sections[k] ?? '';
  const send = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ask<{ sent: number; mode: string }>('send-team-email', { ...target, update: preview.update, showRoles, includeTeam, mode, saveTemplates, sections: Object.fromEntries((Object.keys(SECTION_LABEL) as (keyof Sections)[]).map((k) => [k, value(k)])) });
      onSent(r.mode === 'bcc' ? `Sent as one email to ${r.sent} people in blind copy. They also have a notification.` : `Sent to ${r.sent} people, one email each. They also have a notification.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mpmb-card mpmb-portal__dialog" aria-labelledby="te-h">
      <h3 className="mpmb-h3" id="te-h">
        {update ? 'Send the team updated allocations' : 'Email the team'}
      </h3>
      {!preview ? (
        <p>{error ?? 'Making the email…'}</p>
      ) : (
        <>
          <p className="mpmb-hint">
            {preview.schoolName} · To {preview.recipients.length} {preview.recipients.length === 1 ? 'person' : 'people'}: {preview.recipients.map((r) => r.name).join(', ') || 'nobody confirmed yet'}. Replies go to brainpop@leeds.ac.uk.
            {preview.lastSent ? ` Team last told ${stamp(preview.lastSent.at)} by ${preview.lastSent.byName}.` : ''}
          </p>
          {preview.changed && <Callout tone="important">Allocations have changed since the team was last told, so this goes as an update.</Callout>}
          <div className="mpmb-actions">
            <label className="mpmb-portal__inline">
              <input type="checkbox" checked={showRoles} onChange={(e) => (setShowRoles(e.target.checked), setEdits({ ...edits, allocations: undefined }))} /> Show EEG and co-production
            </label>
            <label className="mpmb-portal__inline">
              <input type="checkbox" checked={includeTeam} onChange={(e) => setIncludeTeam(e.target.checked)} /> Also send to the research team
            </label>
          </div>
          <div className="mpmb-actions" role="radiogroup" aria-label="How to send">
            <label className="mpmb-portal__inline">
              <input type="radio" name="te-mode" checked={mode === 'bcc'} onChange={() => setMode('bcc')} /> One email, everyone in blind copy
            </label>
            <label className="mpmb-portal__inline">
              <input type="radio" name="te-mode" checked={mode === 'individual'} onChange={() => setMode('individual')} /> One email each
            </label>
          </div>
          {(Object.keys(SECTION_LABEL) as (keyof Sections)[]).map((k) =>
            k === 'subject' ? (
              <TextField key={k} id="te-subject" label={SECTION_LABEL[k]} value={value(k)} onChange={(e) => setEdits({ ...edits, subject: e.target.value })} />
            ) : (
              <div key={k}>
                <label className="mpmb-label" htmlFor={`te-${k}`}>
                  {SECTION_LABEL[k]}
                  {!preview.sections[k] && <span className="mpmb-label__tag"> (left out when empty)</span>}
                </label>
                <textarea id={`te-${k}`} className="mpmb-input" rows={Math.min(14, Math.max(2, value(k).split('\n').length + 1))} value={value(k)} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
              </div>
            ),
          )}
          <label className="mpmb-portal__inline">
            <input type="checkbox" checked={saveTemplates} onChange={(e) => setSaveTemplates(e.target.checked)} /> Keep my opening and closing for next time
          </label>
        </>
      )}
      <ErrorLine error={preview ? error : null} />
      <div className="mpmb-actions">
        <Button variant="primary" loading={busy} disabled={!preview || !preview.recipients.length} onClick={() => void send()}>
          Send to the team
        </Button>
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
      </div>
    </section>
  );
}
