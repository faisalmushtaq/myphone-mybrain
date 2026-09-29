import { useCallback, useEffect, useState } from 'react';
import { ImageCapture } from '../components/ImageCapture';
import { ImageEditor } from '../components/ImageEditor';
import { StepShell } from '../components/StepShell';
import { UploadList } from '../components/UploadList';
import { Walkthrough } from '../components/Walkthrough';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { Icon } from '../components/ui/Icon';
import { whyPhoneUse } from '../config/copy';
import { childAssentForm } from '../config/statements';
import { study } from '../config/study';
import { platforms, walkthroughs, type PlatformId } from '../config/walkthroughs';
import type { DonationImage } from '../model/types';
import { useStore } from '../state/context';
import { useUploader } from '../state/useUploader';

/**
 * The whole phone-use part on one screen: why we ask (folded), which phone,
 * how to find the summary (folded once images exist), add and check the
 * screenshots, send. Sending is also how the young person agrees to share
 * them; skipping is always available.
 */
export function PhoneUse() {
  const { state, dispatch } = useStore();
  const uploader = useUploader();
  const [editing, setEditing] = useState<DonationImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [howOpen, setHowOpen] = useState<boolean | null>(null);
  const images = state.donation.images;
  const platform = state.donation.platform;
  const failed = images.some((i) => i.status === 'failed');
  const young = state.route === 'young' || state.assent.status === 'completed';
  const walkthrough = platform ? walkthroughs[platform] : null;
  const hasImages = images.length > 0;
  const showHow = howOpen ?? (platform !== null && !hasImages);

  useEffect(() => {
    if (error && images.length && !failed) setError(null);
  }, [error, failed, images.length]);

  // Fold the instructions away once the first image arrives (they can be reopened).
  useEffect(() => {
    setHowOpen(null);
  }, [hasImages]);

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
    const phoneStatement = childAssentForm.statements.find((s) => s.id === 'phone-use');
    if (phoneStatement && state.assent.status === 'completed') {
      dispatch({ type: 'assent-response', statementId: phoneStatement.id, version: phoneStatement.version, response: 'agreed', via: 'action' });
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
      kicker="Screen time"
      title={
        <>
          Share {young ? 'your' : 'the'} screen-time summary. {whyPhoneUse.draft && <Draft />}
        </>
      }
      intro={
        <p>
          A screenshot of the phone’s screen-time page: which apps were used and for how long. Not messages, photos or posts. <strong>Nothing is sent until you press the button at the bottom</strong>, and you can hide any part of an image first.
        </p>
      }
      errors={error ? [{ field: 'mpmb-capture-choose', message: error }] : []}
      onContinue={() => void next()}
      continueLabel={images.length ? (images.length === 1 ? 'Send this screenshot' : `Send these ${images.length} screenshots`) : 'Continue'}
      continueLoading={sending}
      secondaryAction={
        <Button variant="link" onClick={skip}>
          Skip this for now
        </Button>
      }
      width="wide"
    >
      <Disclosure summary="Why we ask, and what we do with it">
        <p>{whyPhoneUse.intro}</p>
        <ul className="mpmb-list">
          {whyPhoneUse.points.map((p) => (
            <li key={p.title}>
              <strong>{p.title}.</strong> {p.body}
            </li>
          ))}
        </ul>
        <p>
          <strong>We do not want to see:</strong> {whyPhoneUse.notInterested.join(', ').toLowerCase()}. {whyPhoneUse.reassurance}
        </p>
      </Disclosure>

      <fieldset className="mpmb-field">
        <legend className="mpmb-label">{young ? 'Which phone do you have?' : 'Which phone does the young person have?'}</legend>
        <div className="mpmb-chips" role="presentation">
          {platforms.map((p) => (
            <label key={p.id} className={`mpmb-chip${platform === p.id ? ' is-selected' : ''}`} htmlFor={`platform-${p.id}`}>
              <input
                id={`platform-${p.id}`}
                type="radio"
                name="platform"
                value={p.id}
                className="mpmb-choice__input"
                checked={platform === p.id}
                onChange={() => {
                  dispatch({ type: 'set-platform', platform: p.id as PlatformId });
                  setHowOpen(null);
                }}
              />
              <span className="mpmb-choice__dot" aria-hidden="true" />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>

      {walkthrough && (
        <details className="mpmb-how" open={showHow}>
          <summary
            className="mpmb-how__summary"
            onClick={(e) => {
              e.preventDefault();
              setHowOpen(!showHow);
            }}
          >
            <Icon name="phone" size={20} />
            <span>How to find the {walkthrough.screenName} summary on {walkthrough.name === 'Other phones' ? 'your phone' : `an ${walkthrough.name}`.replace('an Android', 'an Android phone')}</span>
            <span className="mpmb-disclosure__chevron" aria-hidden="true" />
          </summary>
          <div className="mpmb-how__body">
            <p>{walkthrough.intro}</p>
            <Walkthrough data={walkthrough} />
            <Callout tone="important" title="Before you share">
              <p>{walkthrough.screenshotHint}</p>
              {walkthrough.websitesNote && <p>{walkthrough.websitesNote}</p>}
              <p>Check the top of each screenshot for notifications or message previews. You can hide any part of an image after adding it.</p>
            </Callout>
            <p className="mpmb-hint">Screenshots are saved in Photos (iPhone) or Gallery (Android). Come back to this page and add them below; your progress is saved while this tab is open.</p>
          </div>
        </details>
      )}

      <div id="mpmb-capture-choose" tabIndex={-1}>
        <h2 className="mpmb-h3 mpmb-section-title">Add the screenshots</h2>
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

      {state.restored && images.some((i) => i.status === 'uploaded') && (
        <Callout tone="info" role="status">
          <p>Your uploaded images are still saved. Previews are not shown after the page is refreshed, because images are never kept in your browser.</p>
        </Callout>
      )}

      <UploadList images={images} onRemove={uploader.remove} onRetry={() => void next()} onEdit={setEditing} busy={sending} />

      {images.length > 0 && (
        <Callout tone="important" title="Take a moment to check">
          <p>
            If a screenshot shows a notification, a message, a website or an app you would rather not show, use “Hide part of it” or remove it. Hidden parts are removed from the image itself. You can add up to {study.upload.maxImages} images.
          </p>
        </Callout>
      )}

      {editing && <ImageEditor image={editing} onClose={closeEditor} onApply={applyEdit} />}
    </StepShell>
  );
}
