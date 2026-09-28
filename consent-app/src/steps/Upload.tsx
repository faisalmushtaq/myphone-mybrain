import { useCallback, useEffect, useState } from 'react';
import { ImageCapture } from '../components/ImageCapture';
import { ImageEditor } from '../components/ImageEditor';
import { StepShell } from '../components/StepShell';
import { UploadList } from '../components/UploadList';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { study } from '../config/study';
import type { DonationImage } from '../model/types';
import { useStore } from '../state/context';
import { useUploader } from '../state/useUploader';

/**
 * Add screenshots, check them, hide parts, then send. Nothing is uploaded
 * until "These are ready" is pressed, so the family can check every image
 * first.
 */
export function Upload() {
  const { state, dispatch } = useStore();
  const uploader = useUploader();
  const [editing, setEditing] = useState<DonationImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const images = state.donation.images;
  const waiting = images.filter((i) => i.status !== 'uploaded');
  const failed = images.some((i) => i.status === 'failed');

  // Once the problem the message described has gone away, take the message away too.
  useEffect(() => {
    if (error && images.length && !failed) setError(null);
  }, [error, failed, images.length]);

  const next = async () => {
    if (!images.length) {
      setError('Add at least one screenshot, or choose “Skip this for now”.');
      return;
    }
    setError(null);
    setSending(true);
    const ok = await uploader.uploadPending();
    setSending(false);
    if (!ok) {
      setError('One of your images did not upload. Try again, or remove it.');
      return;
    }
    dispatch({ type: 'donation-status', status: 'completed' });
    dispatch({ type: 'next' });
  };

  const skip = () => {
    dispatch({ type: 'donation-status', status: 'skipped' });
    dispatch({ type: 'next' });
  };

  const closeEditor = useCallback(() => setEditing(null), []);
  const applyEdit = useCallback(
    (blob: Blob, flags: { redacted: boolean; cropped: boolean }) => {
      if (editing) void uploader.replace(editing, blob, flags);
      setEditing(null);
    },
    [editing, uploader],
  );

  return (
    <StepShell
      kicker="Phone-use information"
      title="Add your screenshots."
      intro={
        <p>
          Choose the screenshots you just took, or take a photo of the screen with another device. You can add up to {study.upload.maxImages} images. <strong>Nothing is sent until you press “These are ready”</strong>, so you can check each one first.
        </p>
      }
      errors={error ? [{ field: 'mpmb-capture-choose', message: error }] : []}
      onContinue={() => void next()}
      continueLabel={waiting.length && images.length ? (images.length === 1 ? 'This one is ready — send it' : 'These are ready — send them') : 'Continue'}
      continueLoading={sending}
      secondaryAction={
        <Button variant="link" onClick={skip}>
          Skip this for now
        </Button>
      }
    >
      {state.restored && images.some((i) => i.status === 'uploaded') && (
        <Callout tone="info" role="status">
          <p>Your uploaded images are still saved. Previews are not shown after the page is refreshed, because images are never kept in your browser.</p>
        </Callout>
      )}

      <div id="mpmb-capture-choose" tabIndex={-1}>
        <ImageCapture onFiles={(files) => void uploader.addFiles(files)} count={images.length} disabled={sending} />
      </div>

      {uploader.rejected.length > 0 && (
        <Callout tone="warning" role="alert" title="Some files could not be added">
          <ul className="mpmb-list">
            {uploader.rejected.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <Button variant="link" onClick={uploader.clearRejected}>
            Dismiss
          </Button>
        </Callout>
      )}

      <UploadList images={images} onRemove={uploader.remove} onRetry={() => void next()} onEdit={setEditing} busy={sending} />

      {images.length > 0 && (
        <Callout tone="important" title="Take a moment to check">
          <p>Look at each preview. If a screenshot shows a notification, a message, a website or an app you would rather not show, use “Hide part of it” or remove it and take a new one. Hidden parts are removed from the image itself, not just covered up.</p>
        </Callout>
      )}

      {editing && <ImageEditor image={editing} onClose={closeEditor} onApply={applyEdit} />}
    </StepShell>
  );
}
