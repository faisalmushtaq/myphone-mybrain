import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { FieldWrapper, TextField } from '../components/ui/Field';
import { schoolBySlug } from '../config/schools';
import { callTool, messageOf, uploadSchoolFile } from './api';

interface Preview {
  columns: Record<string, string | null>;
  ignored: string[];
  pupils: number;
  valid: number;
  sample: { row: number; upn: string; firstName: string; lastName: string; dateOfBirth: string | null; yearGroup: string; className: string }[];
  classes: string[];
  problems: { row: number; message: string }[];
  problemCount: number;
  /** No headings in the file: each line was read from its UPN, so the names especially need checking. */
  noHeadings?: boolean;
}

interface PreviewResult {
  preview: Preview | null;
  /** Why the file could not be read automatically (it can still be sent, for the team to read by hand). */
  unreadable: string | null;
}

/** Up to 50 MB (19 October 2026). Up to 6 MB the file goes in the call itself; a larger one goes to Storage first. */
const MAX_BYTES = 50 * 1024 * 1024;
const INLINE_MAX_BYTES = 6 * 1024 * 1024;
/** The study's class-list template (the team's own, 19 October 2026), as an empty CSV that opens in Excel. */
const TEMPLATE = 'UPN,First_Name,Middle_Name,Last_Name,Date_Of_Birth,Gender,Ethnicity,School_Name,Year_Group,Form_Tutor,Address_Line_1,Address_Line_2,Address_Line_3,Address_Line_4,Postcode,School_Email,FSM (Y or N),SEN (N = no SEN; S = statement; E = EHC plan; K = SEN support)\n';
/** What the file chooser offers: spreadsheets, Word, PDF and text. Anything else can still be chosen and sent. */
const ACCEPT = '.xlsx,.xls,.csv,.ods,.docx,.doc,.odt,.pdf,.txt,.rtf,text/csv,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword';
const client = () => ({ userAgent: navigator.userAgent.slice(0, 200), submittedAt: new Date().toISOString(), timezoneOffset: new Date().getTimezoneOffset() });

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** The file as the call takes it: inline when small, otherwise put in Storage once and named by its id. */
const staged = new WeakMap<File, string>();
async function fileFor(f: File, onProgress: (fraction: number) => void) {
  const base = { name: f.name, contentType: f.type || 'application/octet-stream' };
  if (f.size <= INLINE_MAX_BYTES) return { ...base, data: await base64Of(f) };
  let uploadId = staged.get(f);
  if (!uploadId) {
    uploadId = await uploadSchoolFile(f, onProgress);
    staged.set(f, uploadId);
  }
  return { ...base, uploadId };
}

function saveTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'MyPhone-MyBrain-class-list-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const COLUMN_NAMES: [string, string][] = [
  ['upn', 'UPN'],
  ['firstName', 'First name'],
  ['middleName', 'Middle name'],
  ['lastName', 'Last name'],
  ['fullName', 'Name'],
  ['dateOfBirth', 'Date of birth'],
  ['gender', 'Gender'],
  ['ethnicity', 'Ethnicity'],
  ['schoolName', 'School'],
  ['yearGroup', 'Year group'],
  ['formTutor', 'Form tutor'],
  ['className', 'Class'],
  ['address1', 'Address'],
  ['address2', 'Address line 2'],
  ['address3', 'Address line 3'],
  ['address4', 'Address line 4'],
  ['postcode', 'Postcode'],
  ['email', 'School email'],
  ['fsm', 'FSM'],
  ['sen', 'SEN'],
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
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [uploader, setUploader] = useState({ name: '', role: '', email: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'check' | 'preview' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** How far a large file has got into Storage (0 to 1); null when nothing is uploading. */
  const [progress, setProgress] = useState<number | null>(null);
  const [sent, setSent] = useState<{ pupils: number | null; receipt: string; fileName: string } | null>(null);
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
      setProgress(null);
    }
  };

  const choose = async (f: File | null) => {
    setPreview(null);
    setUnreadable(null);
    setError(null);
    setFile(f);
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError('This file is larger than 50 MB. A class list should be much smaller: if it is a Word or PDF file with pictures, save it as Excel or CSV instead.');
      return;
    }
    setBusy('preview');
    try {
      const r = await callTool<PreviewResult>('schoolUpload', { school: school.slug, password, action: 'preview', file: await fileFor(f, setProgress), client: client() });
      setPreview(r.preview);
      setUnreadable(r.preview ? null : (r.unreadable ?? 'This file could not be read automatically.'));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const send = async () => {
    if (!file || (!preview && !unreadable)) return;
    if (!uploader.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(uploader.email.trim())) {
      setError('Enter your name and your school email address, so we can confirm we received the file.');
      return;
    }
    setBusy('send');
    setError(null);
    try {
      const r = await callTool<{ receipt: string; preview: Preview | null }>('schoolUpload', { school: school.slug, password, action: 'send', file: await fileFor(file, setProgress), uploader, note, client: client() });
      setSent({ pupils: r.preview?.pupils ?? null, receipt: r.receipt, fileName: file.name });
      setSentCount((n) => n + 1);
      setFile(null);
      setPreview(null);
      setUnreadable(null);
      setNote('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  // Who is sending, and the button: the same for a file that was read and for one the team will read by hand.
  const sendForm = (
    <>
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
          {preview ? 'Send to the research team' : 'Send it anyway'}
        </Button>
      </div>
    </>
  );

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
            <strong>{sent.fileName}</strong>: {sent.pupils !== null ? `${sent.pupils} pupils received.` : 'received. The research team will read it themselves and contact you if anything is unclear.'}{' '}
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
        <p>One file listing the pupils in the classes taking part, as your management information system (SIMS, Arbor, Bromcom…) exports it. Excel is best; CSV, Word, PDF or a text file also work. The class-list template has every column we ask for:</p>
        <ul className="mpmb-tools__columns">
          <li>
            <strong>UPN</strong>, first, middle and last name (legal names), date of birth
          </li>
          <li>Gender, ethnicity, school, year group and form tutor</li>
          <li>Home address (up to four lines) and postcode, school email</li>
          <li>Free school meals (Y or N) and SEN (N = no SEN, S = statement, E = EHC plan, K = SEN support)</li>
        </ul>
        <p className="mpmb-hint">
          If you can’t include every column, send what you have: the UPN and the pupil’s names are what matter most. A list on several sheets of one workbook is fine.{' '}
          <Button variant="link" onClick={saveTemplate}>
            Download the empty template (opens in Excel)
          </Button>
        </p>
      </section>
      <section aria-labelledby="how-protected" className="mpmb-tools__note">
        <h2 className="mpmb-h3" id="how-protected">
          How your file is protected
        </h2>
        <ul>
          <li>It is sent encrypted, straight to the University of Leeds’ storage for the study, held in the UK (London). It is never emailed and never public.</li>
          <li>Only your school’s password opens this page, and only the research team can see the file. This page never shows it back.</li>
          <li>It is used only for the MyPhone/MyBrain study: to match the study’s records with the school’s.</li>
        </ul>
      </section>
      <FieldWrapper id="school-file" label="Your file" hint="Excel, CSV, Word, PDF or text, up to 50 MB. We read it and show you what we found before you send it.">
        <input ref={fileInput} id="school-file" type="file" accept={ACCEPT} className="mpmb-input" onChange={(e) => void choose(e.target.files?.[0] ?? null)} aria-describedby="school-file-hint" />
      </FieldWrapper>
      {busy === 'preview' && (
        <p className="mpmb-hint" role="status">
          <span className="mpmb-spinner" aria-hidden="true" /> {progress !== null && progress < 1 ? `Uploading the file… ${Math.round(progress * 100)}%` : 'Reading the file…'}
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
          {preview.noHeadings && (
            <Callout tone="important">
              <p>This file has no column headings, so each line was read from the UPN on it. Please check the names below carefully; if they are wrong, add a row of headings (UPN, First_Name, Last_Name…) and choose the file again, or send it as it is and the team will check it.</p>
            </Callout>
          )}
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
          {sendForm}
        </section>
      )}
      {unreadable && file && (
        <section className="mpmb-card" aria-labelledby="school-unreadable">
          <h2 className="mpmb-h3" id="school-unreadable">
            We couldn’t read the pupils from this file automatically.
          </h2>
          <p>{unreadable}</p>
          <p>You can still send it as it is: it is stored securely in the same way, and the research team will read it themselves and contact you if anything is unclear.</p>
          {sendForm}
        </section>
      )}
      <p className="mpmb-hint">
        The file goes to the University of Leeds’ secure storage for the MyPhone/MyBrain study and is used only to match the study’s records with the school’s. {unlocked.uploads + sentCount ? `Files sent from this page so far: ${unlocked.uploads + sentCount}.` : ''} Questions: <a href="mailto:brainpop@leeds.ac.uk">brainpop@leeds.ac.uk</a>.
      </p>
    </div>
  );
}
