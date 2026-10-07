import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { copyText, messageOf, when, type SchoolRow } from '../api';
import type { Staff } from '../StaffApp';

/**
 * Each school's upload page for its UPN lists: the link, a password made
 * here (shown once; only a hash is kept), closing the page, and the files
 * sent. The files themselves arrive in the export, under schools/upn-uploads/.
 */
export function Schools({ staff }: { staff: Staff }) {
  const [schools, setSchools] = useState<SchoolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [made, setMade] = useState<{ slug: string; password: string; link: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    try {
      setSchools((await staff.ask<{ schools: SchoolRow[] }>('schools')).schools);
    } catch (e) {
      setError(messageOf(e));
    }
  };
  useEffect(() => {
    void load();
    // Once, when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newPassword = async (s: SchoolRow) => {
    setBusy(s.slug);
    setError(null);
    try {
      const r = await staff.ask<{ password: string; link: string }>('school-password', { school: s.slug });
      setMade({ slug: s.slug, ...r });
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  const close = async (s: SchoolRow) => {
    setBusy(s.slug);
    setError(null);
    try {
      await staff.ask('school-revoke', { school: s.slug });
      if (made?.slug === s.slug) setMade(null);
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  const copy = async (what: string, text: string) => setCopied((await copyText(text)) ? what : null);

  return (
    <div className="mpmb-tools__section">
      <p>
        Each school gets its own upload page and password. Send the link and the password separately (for example the link by email and the password by phone). A new password replaces the old one at once. Files arrive in the export within the hour, under <span className="mpmb-mono">schools/upn-uploads/</span>, matched to the families’ records.
      </p>
      {error && (
        <Callout tone="important" role="alert">
          <p>{error}</p>
        </Callout>
      )}
      {!schools && !error && <p className="mpmb-hint">Loading…</p>}
      {(schools ?? []).map((s) => (
        <section key={s.slug} className="mpmb-card" aria-labelledby={`school-${s.slug}`}>
          <h2 className="mpmb-h3" id={`school-${s.slug}`}>
            {s.name}
          </h2>
          <p>
            <span className="mpmb-mono mpmb-tools__link">{s.link}</span>{' '}
            <Button variant="link" onClick={() => void copy(`link-${s.slug}`, s.link)}>
              {copied === `link-${s.slug}` ? 'Copied' : 'Copy link'}
            </Button>
          </p>
          <p>{s.password === 'set' ? `Uploads open; password made ${when(s.setAt)}.` : s.password === 'revoked' ? 'Uploads closed.' : 'No password yet, so the page does not accept uploads.'}</p>
          {made?.slug === s.slug && (
            <Callout tone="success" role="status">
              <p>
                New password: <strong className="mpmb-mono mpmb-tools__password">{made.password}</strong>{' '}
                <Button variant="link" onClick={() => void copy(`pw-${s.slug}`, made.password)}>
                  {copied === `pw-${s.slug}` ? 'Copied' : 'Copy'}
                </Button>
              </p>
              <p>It is shown only now. Capitals and dashes do not matter when the school types it.</p>
            </Callout>
          )}
          <div className="mpmb-actions">
            <Button variant="secondary" loading={busy === s.slug} onClick={() => void newPassword(s)}>
              {s.password === 'none' ? 'Make a password' : 'Make a new password'}
            </Button>
            {s.password === 'set' && (
              <Button variant="ghost" disabled={busy === s.slug} onClick={() => void close(s)}>
                Close uploads
              </Button>
            )}
          </div>
          <h3 className="mpmb-h3">Files sent</h3>
          {s.uploads.length ? (
            <ul className="mpmb-tools__list" role="list">
              {s.uploads.map((u) => (
                <li key={u.uploadId} className="mpmb-tools__row">
                  <span className="mpmb-tools__main">
                    {when(u.receivedAt)} · {u.fileName} · {u.pupils} pupils, {u.valid} with a usable UPN{u.problems ? `, ${u.problems} rows to check` : ''} · from {u.uploader?.name ?? 'n/a'}
                    {u.uploader?.role ? ` (${u.uploader.role})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mpmb-hint">None yet.</p>
          )}
        </section>
      ))}
      <p className="mpmb-hint">To add a school, add a line to _data/schools.json in the website; its upload page and its page for parents follow.</p>
    </div>
  );
}
