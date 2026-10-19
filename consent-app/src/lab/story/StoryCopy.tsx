import { useState } from 'react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { describeError, labSession } from '../api';
import { useLab } from '../store';

export interface StoryToKeep {
  storyId: string;
  title: string | null;
  text: string;
  receivedAt: string | null;
}

/**
 * Keeping a copy of the story just told (19 October 2026, from the team's testing): download it as a PDF, print it, or
 * have it emailed. On the lab computer there is no download, so nothing is left behind on it; print and email stay.
 */
export function StoryCopy({ story }: { story: StoryToKeep }) {
  const { state, dispatch, atLab } = useLab();
  const [email, setEmail] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'email' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const copy = { code: state.code, phase: state.phase, title: story.title, text: story.text, receivedAt: story.receivedAt };

  const download = async () => {
    setBusy('pdf');
    setMessage(null);
    try {
      const { buildStoryCopy } = await import('../labPdf');
      const { downloadBlob } = await import('../../lib/consentPdf');
      const { blob, fileName } = await buildStoryCopy(copy);
      downloadBlob(blob, fileName);
      announce(`Downloaded ${fileName}.`);
    } catch {
      setMessage({ tone: 'error', text: 'The PDF could not be made on this device. You can print the page instead.' });
    } finally {
      setBusy(null);
    }
  };

  const print = () => {
    // Only the story is printed (app.css, .mpmb-print-story).
    document.documentElement.classList.add('mpmb-print-story');
    const done = () => {
      document.documentElement.classList.remove('mpmb-print-story');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    window.setTimeout(done, 1000);
  };

  const send = async () => {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setMessage({ tone: 'error', text: 'Enter a full email address, such as name@example.com.' });
      return;
    }
    setBusy('email');
    setMessage(null);
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const res = await getApi().emailLabStory(session, { participantCode: state.code, storyId: story.storyId, email: to });
      if (res.email === 'sent') {
        setMessage({ tone: 'ok', text: `Sent to ${to}. It can take a few minutes; check your junk folder if it doesn’t arrive.` });
        setEmail('');
        setEmailOpen(false);
      } else setMessage({ tone: 'error', text: atLab ? 'The email could not be sent just now. You can print it instead, or ask the researcher.' : 'The email could not be sent just now. You can download it or print it instead.' });
    } catch (error) {
      setMessage({ tone: 'error', text: describeError(error, 'the email') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mpmb-story-copy" aria-labelledby="story-copy-title">
      <div className="mpmb-story-copy__print">
        <p className="mpmb-hint">MyPhone/MyBrain · MyStory · Participant ID {state.code}</p>
        {story.title && <h2 className="mpmb-h3">{story.title}</h2>}
        <blockquote className="mpmb-story-copy__text">{story.text}</blockquote>
      </div>
      <h2 className="mpmb-h3" id="story-copy-title">
        Keep a copy
      </h2>
      <div className="mpmb-actions mpmb-story-copy__actions">
        {!atLab && (
          <Button variant="secondary" loading={busy === 'pdf'} onClick={() => void download()}>
            Download as PDF
          </Button>
        )}
        <Button variant="secondary" onClick={print}>
          Print
        </Button>
        <Button variant="secondary" aria-expanded={emailOpen} onClick={() => setEmailOpen((o) => !o)}>
          Email it to me
        </Button>
      </div>
      {emailOpen && (
        <div className="mpmb-story-copy__email">
          <TextField id="story-copy-email" label="Your email address" hint="Used only to send this copy. It is not kept." type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button variant="primary" loading={busy === 'email'} onClick={() => void send()}>
            Send me my story
          </Button>
        </div>
      )}
      {message && (
        <p className={message.tone === 'ok' ? 'mpmb-hint' : 'mpmb-error'} role={message.tone === 'ok' ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </section>
  );
}
