import { useState } from 'react';
import { finishLink } from '../lib/entryLink';
import { Button } from './ui/Button';

/**
 * The link that brings a family back to finish their record (src/steps/Resume.tsx):
 * on the thank-you page whenever the young person's part or the screenshots
 * are still to come, and on the handover screen when the young person isn't
 * there (forYoung: the link speaks to them and asks only their birthday). It
 * is shown in full, so it can be written down or screenshotted, with ways to
 * send it: the phone's own share menu where there is one, WhatsApp, a text
 * message, email, or a copy.
 */
export function CarryOnLink({ referenceCode, childName, forYoung = false }: { referenceCode: string; childName: string; forYoung?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'shared' | 'failed'>('idle');
  const url = finishLink(referenceCode, forYoung);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const message = forYoung ? `Hi ${childName}! Your part of MyPhone/MyBrain is ready. Tap the link and type your birthday:` : `To finish ${childName}’s screen time for MyPhone/MyBrain (it asks for their date of birth):`;
  const text = `${message} ${url}`;

  const share = async () => {
    try {
      await navigator.share({ title: 'MyPhone/MyBrain', text: message, url });
      setStatus('shared');
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('failed');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <div className="mpmb-card mpmb-carryon" role="region" aria-label={forYoung ? `Send ${childName} their link` : 'Carry on later'}>
      <p className="mpmb-carryon__title">{forYoung ? `${childName}’s link` : 'Your link to finish'}</p>
      <p className="mpmb-mono mpmb-carryon__url">{url}</p>
      <div className="mpmb-carryon__send">
        {canShare && (
          <Button variant="primary" onClick={() => void share()}>
            Share…
          </Button>
        )}
        <a className="mpmb-btn mpmb-btn--secondary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener">
          WhatsApp
        </a>
        <a className="mpmb-btn mpmb-btn--secondary" href={`sms:?&body=${encodeURIComponent(text)}`}>
          Text message
        </a>
        <a className="mpmb-btn mpmb-btn--secondary" href={`mailto:?subject=${encodeURIComponent('MyPhone/MyBrain')}&body=${encodeURIComponent(text)}`}>
          Email
        </a>
        <Button variant="secondary" onClick={() => void copy()}>
          Copy the link
        </Button>
      </div>
      <p className="mpmb-hint" role="status">
        {status === 'copied' ? 'Link copied.' : status === 'shared' ? 'Shared.' : status === 'failed' ? 'It could not be copied here: write it down, or take a screenshot of this page.' : ''}
      </p>
      <p className="mpmb-hint">
        {forYoung
          ? `It opens ${childName}’s part straight away; they only need to type their birthday.`
          : `Or go to the form, choose “Carry on with your reference” and enter ${referenceCode}. You will need ${childName}’s date of birth.`}
      </p>
    </div>
  );
}
