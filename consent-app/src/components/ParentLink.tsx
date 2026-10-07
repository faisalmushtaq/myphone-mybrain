import { useState } from 'react';
import { schools } from '../config/schools';
import { useStore } from '../state/context';
import { Button } from './ui/Button';

/**
 * For an under-16 whose parent or carer isn't with them: they must not fill
 * in the parent's part themselves, so this offers a link that opens the
 * form for the parent on their own phone (with the school filled in when it
 * is known).
 */
export function ParentLinkPanel({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { state } = useStore();
  const [status, setStatus] = useState<'idle' | 'copied' | 'shared' | 'show'>('idle');
  const slug = schools.find((s) => s.id === state.identity.schoolId)?.slug;
  const url = `${window.location.origin}/take-part/consent/?who=parent${slug ? `&school=${slug}` : ''}`;
  const text = 'Could you give permission for me to share my screen time with MyPhone/MyBrain? It takes about five minutes.';

  const send = async () => {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'MyPhone/MyBrain', text, url });
        setStatus('shared');
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setStatus('copied');
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('show');
    }
  };

  return (
    <div className={`mpmb-parentlink mpmb-parentlink--${tone}`} role="region" aria-label="If your parent or carer isn’t here">
      <p className="mpmb-parentlink__title">That’s OK.</p>
      <p>Only your parent or carer can do their part, so please don’t fill it in for them. You can:</p>
      <ul className="mpmb-parentlink__list">
        <li>send them a link, so they can do their part on their own phone. If they choose to, they can ask you to send your screen time when you are together;</li>
        <li>or do it together another time. It takes about 5 minutes.</li>
      </ul>
      <Button variant="primary" onClick={() => void send()}>
        Send my parent or carer the link
      </Button>
      <p className="mpmb-parentlink__status" role="status">
        {status === 'shared' ? 'Sent. Thank you.' : status === 'copied' ? 'Link copied. Paste it into a message to your parent or carer.' : status === 'show' ? <>Send them this link: <span className="mpmb-mono">{url}</span></> : ''}
      </p>
      <p className="mpmb-parentlink__note">Don’t want to share your screen time? You don’t need to fill anything in. Nobody will mind.</p>
    </div>
  );
}
