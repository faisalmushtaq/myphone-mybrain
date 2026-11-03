import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { TextField } from '../components/ui/Field';
import { callTool, messageOf } from './api';

interface DbsPerson {
  name: string;
  dbs: { certificateNumber: string; issueDate: string; updateService: boolean; enhanced: boolean; docId: string | null } | null;
}

interface DbsPage {
  schoolName: string;
  allowCopies: boolean;
  visits: { location: string; days: { date: string; start: string; end: string; people: DbsPerson[] }[] }[];
}

const longDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const SLUG = /^[a-z0-9-]{1,40}$/;

/**
 * A school's DBS page (myphonemybrain.com/schools/dbs/?school=<slug>): the
 * DBS details of the people coming to the school's visits, as the project
 * manager checked them, behind the password the project manager gave the
 * school by phone. Nothing is kept in the browser: closing the page locks it.
 */
export function SchoolDbs() {
  const slug = (new URLSearchParams(window.location.search).get('school') ?? '').trim().toLowerCase();
  const [password, setPassword] = useState('');
  const [page, setPage] = useState<DbsPage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${page ? `${page.schoolName}: ` : ''}DBS details – MyPhone/MyBrain`;
    headingRef.current?.focus({ preventScroll: true });
  }, [page]);

  if (!SLUG.test(slug)) {
    return (
      <div className="mpmb-step mpmb-tools">
        <h1 className="mpmb-h1">DBS details for MyPhone/MyBrain visits</h1>
        <Callout tone="important">
          <p>
            This link does not name a school. Please use the link the research team sent you, or email <a href="mailto:S.A.Ali1@leeds.ac.uk">S.A.Ali1@leeds.ac.uk</a>.
          </p>
        </Callout>
      </div>
    );
  }

  const open = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Enter the password the research team gave you.');
      return;
    }
    setBusy('open');
    setError(null);
    try {
      setPage(await callTool<DbsPage>('schoolDbs', { school: slug, password }));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };
  const copy = async (docId: string) => {
    setBusy(docId);
    setError(null);
    try {
      const { url } = await callTool<{ url: string }>('schoolDbs', { school: slug, password, action: 'copy', docId });
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  if (!page) {
    return (
      <div className="mpmb-step mpmb-tools">
        <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
          DBS details for MyPhone/MyBrain visits
        </h1>
        <p className="mpmb-lead">For school staff: the DBS details of the University of Leeds researchers visiting your school.</p>
        <form className="mpmb-card" onSubmit={(e) => void open(e)}>
          <TextField id="dbs-password" label="Password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} hint="The password our project manager gave you by phone. Capitals and dashes do not matter." />
          {error && (
            <p className="mpmb-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" loading={busy === 'open'}>
            Show the DBS details
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="mpmb-step mpmb-tools">
      <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
        {page.schoolName}: DBS details
      </h1>
      <p className="mpmb-lead">Everyone confirmed for your visits, day by day. All hold an enhanced DBS certificate checked by our project manager. Please do not copy these details beyond what your safeguarding records need.</p>
      {error && (
        <p className="mpmb-error" role="alert">
          {error}
        </p>
      )}
      {!page.visits.length && <p>No visits are coming up.</p>}
      {page.visits.map((v) =>
        v.days.map((d) => (
          <section key={`${v.location}-${d.date}`} className="mpmb-card" aria-label={longDate(d.date)}>
            <h2 className="mpmb-h2">
              {longDate(d.date)}, {d.start} to {d.end}
            </h2>
            <p className="mpmb-hint">{v.location}</p>
            {!d.people.length ? (
              <p>Nobody confirmed yet.</p>
            ) : (
              <div className="mpmb-portal__tablewrap">
                <table className="mpmb-portal__table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">DBS certificate number</th>
                      <th scope="col">Issued</th>
                      <th scope="col">Level</th>
                      <th scope="col">Update Service</th>
                      {page.allowCopies && <th scope="col">Copy</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {d.people.map((p) => (
                      <tr key={p.name}>
                        <th scope="row">{p.name}</th>
                        {p.dbs ? (
                          <>
                            <td>{p.dbs.certificateNumber || 'Not recorded'}</td>
                            <td>{p.dbs.issueDate ? longDate(p.dbs.issueDate) : 'Not recorded'}</td>
                            <td>Enhanced</td>
                            <td>{p.dbs.updateService ? 'Yes' : 'No'}</td>
                            {page.allowCopies && (
                              <td>
                                {p.dbs.docId ? (
                                  <Button variant="link" loading={busy === p.dbs.docId} onClick={() => void copy(p.dbs!.docId!)}>
                                    Open
                                  </Button>
                                ) : (
                                  '—'
                                )}
                              </td>
                            )}
                          </>
                        ) : (
                          <td colSpan={page.allowCopies ? 5 : 4}>DBS being checked</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )),
      )}
      <p className="mpmb-hint">
        Questions? Email <a href="mailto:S.A.Ali1@leeds.ac.uk">S.A.Ali1@leeds.ac.uk</a>. Each time this page is opened it is recorded.
      </p>
    </div>
  );
}
