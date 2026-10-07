import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { FieldWrapper, TextField } from '../components/ui/Field';
import { schoolBySlug } from '../config/schools';
import { callTool, messageOf } from './api';

interface Preview {
  columns: Record<'upn' | 'firstName' | 'lastName' | 'fullName' | 'dateOfBirth' | 'yearGroup' | 'className', string | null>;
  ignored: string[];
  pupils: number;
  valid: number;
  sample: { row: number; upn: string; firstName: string; lastName: string; dateOfBirth: string | null; yearGroup: string; className: string }[];
  classes: string[];
  problems: { row: number; message: string }[];
  problemCount: number;
}

const MAX_BYTES = 5 * 1024 * 1024;
const TEMPLATE = 'UPN,Legal forename,Legal surname,Date of birth,Year group,Class\n';
const client = () => ({ userAgent: navigator.userAgent.slice(0, 200), submittedAt: new Date().toISOString(), timezoneOffset: new Date().getTimezoneOffset() });

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function saveTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'myphone-mybrain-class-list.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const COLUMN_NAMES: [keyof Preview['columns'], string][] = [
  ['upn', 'UPN'],
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['fullName', 'Name'],
  ['dateOfBirth', 'Date of birth'],
  ['yearGroup', 'Year group'],
  ['className', 'Class'],
];

/**
 * A school's own upload page for the UPNs of the classes taking part
 * (myphonemybrain.com/schools/upload/?school=<slug>). The research team
 * gives each school the link and a password. The school chooses its file,
 * checks what was read from it, and sends it; the file goes to the
 * University of Leeds' secure storage, never anywhere public.
 */
export function SchoolUpload() {
  const school = schoolBySlug(new URLSearchParams(window.location.search).get('school'));
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState<{ uploads: number } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploader, setUploader] = useState({ name: '', role: '', email: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'check' | 'preview' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ pupils: number; receipt: string; fileName: string } | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${school ? `${school.name}: ` : ''}class lists – MyPhone/MyBrain`;
  }, [school]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [unlocked, sent]);

  if (!school) {
    return (
      <div className="mpmb-step mpmb-tools">
        <h1 className="mpmb-h1">Class lists for MyPhone/MyBrain</h1>
        <Callout tone="important">
          <p>This link does not name a school taking part. Please use the link the research team sent you, or email <a href="mailto:brainpop@leeds.ac.uk">brainpop@leeds.ac.uk</a>.</p>
        </Callout>
      </div>
    );
  }

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Enter the password the research team gave you.');
      return;
    }
    setBusy('check');
    setError(null);
    try {
      const r = await callTool<{ uploads: number }>('schoolUpload', { school: school.slug, password, action: 'check', client: client() });
      setUnlocked(r);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  const choose = async (f: File | null) => {
    setPreview(null);
    setError(null);
    setFile(f);
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError('This file is larger than 5 MB. A class list should be much smaller: export only the columns asked for.');
      return;
    }
    setBusy('preview');
    try {
      const r = await callTool<{ preview: Preview }>('schoolUpload', { school: school.slug, password, action: 'preview', file: { name: f.name, contentType: f.type || 'application/octet-stream', data: await base64Of(f) }, client: client() });
      setPreview(r.preview);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!file || !preview) return;
    if (!uploader.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(uploader.email.trim())) {
      setError('Enter your name and your school email address, so we can confirm we received the file.');
      return;
    }
    setBusy('send');
    setError(null);
    try {
      const r = await callTool<{ receipt: string; preview: Preview }>('schoolUpload', { school: school.slug, password, action: 'send', file: { name: file.name, contentType: file.type || 'application/octet-stream', data: await base64Of(file) }, uploader, note, client: client() });
      setSent({ pupils: r.preview.pupils, receipt: r.receipt, fileName: file.name });
      setSentCount((n) => n + 1);
      setFile(null);
      setPreview(null);
      setNote('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  if (!unlocked) {
    return (
      <form className="mpmb-step mpmb-tools" onSubmit={(e) => void unlock(e)} noValidate>
        <header className="mpmb-step__header">
          <p className="mpmb-kicker">{school.name}</p>
          <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
            Send the class lists for MyPhone/MyBrain.
          </h1>
          <p className="mpmb-lead">For the school’s staff: the UPNs of the pupils in the classes taking part, so the research team can match the study’s records with yours. It takes a couple of minutes.</p>
        </header>
        {error && (
          <Callout tone="important" role="alert">
            <p>{error}</p>
          </Callout>
        )}
        <TextField id="school-password" label="Password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} hint="The password the research team gave you, such as ABCD-EFGH-JKLM." />
        <div className="mpmb-actions">
          <Button type="submit" variant="primary" arrow loading={busy === 'check'}>
            Continue
          </Button>
        </div>
        <p className="mpmb-hint">
          No password, or a problem? Email the research team at <a href="mailto:brainpop@leeds.ac.uk">brainpop@leeds.ac.uk</a>.
        </p>
      </form>
    );
  }

  return (
    <div className="mpmb-step mpmb-step--wide mpmb-tools">
      <header className="mpmb-step__header">
        <p className="mpmb-kicker">{school.name}</p>
        <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
          {sent ? 'Thank you. We have your file.' : 'Send the class lists.'}
        </h1>
      </header>
      {sent && (
        <Callout tone="success" role="status">
          <p>
            <strong>{sent.fileName}</strong>: {sent.pupils} pupils received.{' '}
            {sent.receipt === 'sent' ? `We have emailed a receipt to ${uploader.email.trim()}.` : 'Keep this page as your receipt; the research team has been told.'} To correct anything, send the file again: the team uses the latest one.
          </p>
        </Callout>
      )}
      {error && (
        <Callout tone="important" role="alert">
          <p>{error}</p>
        </Callout>
      )}
      <section aria-labelledby="what-to-send">
        <h2 className="mpmb-h2" id="what-to-send">
          What to send
        </h2>
        <p>One file (CSV or Excel) listing the pupils in the classes taking part, with these columns, as your management information system (SIMS, Arbor, Bromcom…) exports them:</p>
        <ul>
          <li>UPN</li>
          <li>Legal first name and legal last name</li>
          <li>Date of birth</li>
          <li>Year group and class (or registration group)</li>
        </ul>
        <p className="mpmb-hint">
          Please leave out every other column. Any other column is not read, but it is kept with the file as you sent it.{' '}
          <Button variant="link" onClick={saveTemplate}>
            Download an empty template (.csv)
          </Button>
        </p>
      </section>
      <FieldWrapper id="school-file" label="Your file" hint="A .csv or .xlsx file of up to 5 MB.">
        <input ref={fileInput} id="school-file" type="file" accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mpmb-input" onChange={(e) => void choose(e.target.files?.[0] ?? null)} aria-describedby="school-file-hint" />
      </FieldWrapper>
      {busy === 'preview' && (
        <p className="mpmb-hint" role="status">
          <span className="mpmb-spinner" aria-hidden="true" /> Reading the file…
        </p>
      )}
      {preview && (
        <section className="mpmb-card" aria-labelledby="school-check">
          <h2 className="mpmb-h3" id="school-check">
            Check what we read
          </h2>
          <p>
            <strong>{preview.pupils} pupils</strong>, {preview.valid} with a UPN we can use{preview.classes.length ? `, in ${preview.classes.join(', ')}` : ''}.
          </p>
          <p className="mpmb-hint">
            Columns found: {COLUMN_NAMES.filter(([k]) => preview.columns[k]).map(([k, label]) => `${label} (“${preview.columns[k]}”)`).join(', ')}.{preview.ignored.length ? ` Not read: ${preview.ignored.join(', ')}.` : ''}
          </p>
          <div className="mpmb-tools__table-wrap">
            <table className="mpmb-tools__table">
              <caption className="mpmb-sr-only">The first rows read from the file</caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">UPN</th>
                  <th scope="col">First name</th>
                  <th scope="col">Last name</th>
                  <th scope="col">Date of birth</th>
                  <th scope="col">Class</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((p) => (
                  <tr key={p.row}>
                    <td>{p.row}</td>
                    <td className="mpmb-mono">{p.upn || '–'}</td>
                    <td>{p.firstName || '–'}</td>
                    <td>{p.lastName || '–'}</td>
                    <td>{p.dateOfBirth ?? '–'}</td>
                    <td>{[p.yearGroup, p.className].filter(Boolean).join(' ') || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.problemCount > 0 && (
            <Callout tone="important">
              <p>
                <strong>{preview.problemCount} row{preview.problemCount === 1 ? '' : 's'} to check.</strong> You can send the file as it is, or correct it and choose it again.
              </p>
              <ul>
                {preview.problems.slice(0, 12).map((p) => (
                  <li key={`${p.row}-${p.message}`}>
                    Row {p.row}: {p.message}
                  </li>
                ))}
                {preview.problemCount > 12 && <li>…and {preview.problemCount - 12} more.</li>}
              </ul>
            </Callout>
          )}
          <div className="mpmb-tools__grid">
            <TextField id="uploader-name" label="Your name" autoComplete="name" value={uploader.name} onChange={(e) => setUploader({ ...uploader, name: e.target.value })} />
            <TextField id="uploader-role" label="Your role" required={false} value={uploader.role} onChange={(e) => setUploader({ ...uploader, role: e.target.value })} hint="For example, Head of Year 9." />
            <TextField id="uploader-email" label="Your school email" type="email" autoComplete="email" value={uploader.email} onChange={(e) => setUploader({ ...uploader, email: e.target.value })} hint="We send a receipt here." />
          </div>
          <FieldWrapper id="uploader-note" label="Anything we should know" required={false}>
            <textarea id="uploader-note" className="mpmb-input mpmb-input--area" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldWrapper>
          <div className="mpmb-actions">
            <Button variant="primary" arrow loading={busy === 'send'} onClick={() => void send()}>
              Send to the research team
            </Button>
          </div>
        </section>
      )}
      <p className="mpmb-hint">
        The file goes to the University of Leeds’ secure storage for the MyPhone/MyBrain study and is used only to match the study’s records with the school’s. {unlocked.uploads + sentCount ? `Files sent from this page so far: ${unlocked.uploads + sentCount}.` : ''} Questions: <a href="mailto:brainpop@leeds.ac.uk">brainpop@leeds.ac.uk</a>.
      </p>
    </div>
  );
}
