import { useState } from 'react';
import { Button } from './ui/Button';

/**
 * Ways to send a link from this phone: the phone's own share menu where
 * there is one, WhatsApp, a text message, email, or a copy. Used for the
 * young person's link (CarryOnLink) and the parent's link (ParentLink).
 */
export function ShareLink({ url, message }: { url: string; message: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'shared' | 'failed'>('idle');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
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
    <>
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
    </>
  );
}
