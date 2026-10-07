import { useState } from 'react';
import { finishLink } from '../lib/entryLink';
import { Button } from './ui/Button';

/**
 * The link that brings a family back to finish their record (src/steps/Resume.tsx):
 * on the thank-you page whenever the young person's part or the screenshots
 * are still to come, asking for them as soon as possible. It
 * opens the form at "Carry on with your reference", which then asks for the
 * young person's date of birth. Shown in full, so it can be written down or
 * screenshotted, with a button to share or copy it.
 */
export function CarryOnLink({ referenceCode, childName }: { referenceCode: string; childName: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'shared' | 'failed'>('idle');
  const url = finishLink(referenceCode);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const send = async () => {
    try {
      if (canShare) {
        await navigator.share({ title: 'MyPhone/MyBrain', text: `To finish ${childName}’s screen time for MyPhone/MyBrain (it asks for their date of birth):`, url });
        setStatus('shared');
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('failed');
    }
  };

  return (
    <div className="mpmb-card mpmb-carryon" role="region" aria-label="Carry on later">
      <p className="mpmb-carryon__title">Your link to finish</p>
      <p className="mpmb-mono mpmb-carryon__url">{url}</p>
      <p className="mpmb-hint">Or go to the form, choose “Carry on with your reference” and enter {referenceCode}. You will need {childName}’s date of birth.</p>
      <div className="mpmb-actions">
        <Button variant="secondary" onClick={() => void send()}>
          {canShare ? 'Share the link' : 'Copy the link'}
        </Button>
      </div>
      <p className="mpmb-hint" role="status">
        {status === 'copied' ? 'Link copied.' : status === 'shared' ? 'Shared.' : status === 'failed' ? 'It could not be copied here: write it down, or take a screenshot of this page.' : ''}
      </p>
    </div>
  );
}
