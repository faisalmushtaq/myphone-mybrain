import { useCallback, useEffect, useState } from 'react';
import { ImageCapture } from '../components/ImageCapture';
import { ImageEditor } from '../components/ImageEditor';
import { SaveStatus } from '../components/SaveStatus';
import { StepShell } from '../components/StepShell';
import { UploadList } from '../components/UploadList';
import { Walkthrough } from '../components/Walkthrough';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { Icon } from '../components/ui/Icon';
import { whyPhoneUse } from '../config/copy';
import { study } from '../config/study';
import { familyWalkthroughs, platforms, walkthroughs, type PlatformId } from '../config/walkthroughs';
import { phoneSourceOf } from '../model/journey';
import type { DonationImage } from '../model/types';
import { useStore } from '../state/context';
import { useSync } from '../state/useSync';
import { useUploader } from '../state/useUploader';

/**
 * The whole screen-time part on one screen: why we ask (folded), which
 * phone, how to find the summary (folded once images are added), add and
 * check the screenshots, send. Sending uploads the images and records them
 * against the permission straight away; when they come from the young
 * person's phone it is also how the young person agrees to share them. A
 * parent sending an under-16's screen time from their own phone (Family
 * Sharing, Family Link) gets those instructions instead. Skipping is
 * possible (the parent then answers the longer questions), but not without
 * an appeal: the screenshots are the part of the study nobody else can
 * provide.
 */
export function PhoneUse() {
  const { state, dispatch } = useStore();
  const uploader = useUploader();
  const { sendDonation, submission } = useSync();
  const [editing, setEditing] = useState<DonationImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [howOpen, setHowOpen] = useState<boolean | null>(null);
  const [appeal, setAppeal] = useState(false);
  const [confirmDoubtful, setConfirmDoubtful] = useState(false);
  const [rejectedNote, setRejectedNote] = useState<string | null>(null);
  const images = state.donation.images;
  const platform = state.donation.platform;
  const unsent = images.filter((i) => i.status !== 'sent');
  const sentCount = images.length - unsent.length;
  const failed = images.some((i) => i.status === 'failed');
  const doubtful = unsent.filter((i) => i.quality?.verdict === 'unlikely' && !i.acknowledged);
  // From the parent's own phone: their family view of the young person's screen time.
  const familyView = phoneSourceOf(state) === 'parent';
  const young = !familyView && (state.route === 'young' || state.assent.status === 'completed');
  const childName = state.identity.firstName.trim() || 'The young person';
  const walkthrough = platform ? (familyView && platform !== 'other' ? familyWalkthroughs[platform] : walkthroughs[platform]) : null;
  const hasImages = images.length > 0;
  const showHow = howOpen ?? (platform !== null && !hasImages);

  useEffect(() => {
    if (error && images.length && !failed) setError(null);
  }, [error, failed, images.length]);

  // Fold the instructions away once the first image arrives (they can be reopened).
  useEffect(() => {
    setHowOpen(null);
  }, [hasImages]);

  /** `acknowledged` names images the person has just confirmed as right, ahead of the store catching up. */
  const send = async (acknowledged: string[] = []) => {
    setRejectedNote(null);
    if (!unsent.length) {
      if (sentCount) {
        dispatch({ type: 'next' });
        return;
      }
      setError(young ? 'Add a screenshot, or choose “I don’t want to share this”.' : 'Add at least one screenshot, or choose “Skip the screenshots”.');
      return;
    }
    if (doubtful.some((i) => !acknowledged.includes(i.id)) && !confirmDoubtful) {
      setConfirmDoubtful(true);
      return;
    }
    setError(null);
    setSending(true);
    try {
      const { ok, images: fresh } = await uploader.uploadPending();
      if (!ok) {
        setError('One of your images did not upload. Try again, or remove it.');
        return;
      }
      const result = await sendDonation(fresh.map((i) => (acknowledged.includes(i.id) ? { ...i, acknowledged: true } : i)));
      if (!result) {
        setError(submission.consentError ?? submission.donationError ?? 'The screenshots could not be sent. Please try again.');
        return;
      }
      if (result.rejected.length) {
        setRejectedNote(`${result.accepted.length ? `${result.accepted.length} screenshot${result.accepted.length === 1 ? ' was' : 's were'} sent. ` : ''}${result.rejected.length} could not be accepted — see the note under the image. Remove it, or replace it with a screenshot of the screen-time page.`);
        return;
      }
      dispatch({ type: 'next' });
    } finally {
      setSending(false);
      setConfirmDoubtful(false);
    }
  };

  const skip = () => {
    dispatch({ type: 'donation-status', status: sentCount ? 'completed' : 'skipped' });
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

  const sendLabel = unsent.length ? (unsent.length === 1 ? 'Send this screenshot' : `Send these ${unsent.length} screenshots`) : sentCount ? 'Continue' : 'Send';

  return (
    <StepShell
      kicker="Screen time"
      title={
        <>
          {familyView ? `Share ${childName}’s screen time from your phone.` : `Share ${young ? 'your screen time and the apps you use' : 'the screen time and the apps used'}.`} {whyPhoneUse.draft && <Draft />}
        </>
      }
      intro={
        familyView ? (
          <p>
            Screenshots of {childName}’s screen time, from Apple Family Sharing or Google Family Link on your phone: <strong>which apps they used and for how long</strong>. Not messages, photos or posts. You can hide any part of an image before it goes.
          </p>
        ) : young ? (
          <p>
            Next, you can send us screenshots of your phone’s screen-time page. They show <strong>which apps you used and for how long</strong>. They don’t show your messages, photos or what you watched, and we never show them to your school. You can cover up anything first. This part is your choice too.
          </p>
        ) : (
          <p>
            Screenshots of the phone’s screen-time page showing <strong>which apps were used and for how long</strong>: the list of apps, not just the total, because how a phone is used matters as much as how much. Not messages, photos or posts. It is the one thing nobody else can tell us. You can hide any part of an image before it goes.
          </p>
        )
      }
      errors={error ? [{ field: 'mpmb-capture-choose', message: error }] : []}
      onContinue={() => void send()}
      continueLabel={sendLabel}
      continueLoading={sending}
      // Carrying on later, the answer before this one is already sent: there is no going back to it here.
      hideBack={Boolean(state.resume)}
      secondaryAction={
        // Sharing is the young person's own choice: when they hold the phone, saying no is one press, with no appeal.
        young ? (
          <Button variant="ghost" onClick={skip}>
            I don’t want to share this
          </Button>
        ) : !appeal ? (
          <Button variant="link" onClick={() => setAppeal(true)}>
            Skip the screenshots
          </Button>
        ) : undefined
      }
      width="wide"
    >
      <SaveStatus />

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
        <legend className="mpmb-label">{young ? 'Which phone do you have?' : familyView ? `Which phone does ${childName} have?` : 'Which phone does the young person have?'}</legend>
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
            <span>{familyView && platform !== 'other' ? `How to find ${childName}’s screen time in ${walkthrough.name}` : `How to find the ${walkthrough.screenName} summary on ${walkthrough.name === 'Other phones' ? 'your phone' : `an ${walkthrough.name}`.replace('an Android', 'an Android phone')}`}</span>
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
            <p className="mpmb-hint">Screenshots go to Photos (iPhone) or Gallery (Android) on the phone you took them on. If that is not this phone, send them to this phone first, or use “Take a photo of the screen” below. Then come back to this page and add them; your progress is saved while this tab is open.</p>
          </div>
        </details>
      )}

      <div id="mpmb-capture-choose" tabIndex={-1}>
        <h2 className="mpmb-h3 mpmb-section-title">Add the screenshots</h2>
        <ImageCapture onFiles={(files) => void uploader.addFiles(files)} count={images.length} disabled={sending} cameraHint={young ? 'If your screen time is on a different phone.' : familyView ? 'If this form is on a different device from the phone that shows the screen time.' : `If the screen time is on ${state.identity.firstName.trim() || 'the young person'}’s phone and this form is on yours.`} />
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

      {rejectedNote && (
        <Callout tone="warning" role="alert" title="Not all of the images could be accepted">
          <p>{rejectedNote}</p>
        </Callout>
      )}

      {state.restored && images.some((i) => i.status === 'uploaded' || i.status === 'sent') && (
        <Callout tone="info" role="status">
          <p>Your uploaded images are still saved. Previews are not shown after the page is refreshed, because images are never kept in your browser.</p>
        </Callout>
      )}

      <UploadList images={images} onRemove={uploader.remove} onRetry={() => void send()} onEdit={setEditing} busy={sending} />

      {images.length > 0 && !confirmDoubtful && (
        <Callout tone="important" title="Take a moment to check">
          <p>
            Check that at least one screenshot shows the list of apps with the time next to each. If a screenshot shows a notification, a message, a website or an app you would rather not show, use “Hide part of it” or remove it. Hidden parts are removed from the image itself. You can add up to {study.upload.maxImages} images.
          </p>
        </Callout>
      )}

      {confirmDoubtful && (
        <Callout tone="warning" role="alert" title={doubtful.length === 1 ? 'One image doesn’t look like a screen-time page' : `${doubtful.length} images don’t look like screen-time pages`}>
          <p>Screenshots of the screen-time page are flat, tidy screens with a list of apps. {doubtful.length === 1 ? 'This one looks' : 'These look'} more like a photograph of something else. Please check before sending: if it was added by mistake, remove it.</p>
          <div className="mpmb-callout__actions">
            <Button
              variant="primary"
              onClick={() => {
                const ids = doubtful.map((i) => i.id);
                uploader.acknowledge(ids);
                void send(ids);
              }}
            >
              It’s right — send anyway
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDoubtful(false)}>
              Let me check
            </Button>
          </div>
        </Callout>
      )}

      {appeal && !young && (
        <Callout tone="important" role="alert" title="Before you skip">
          <p>
            {state.resume ? 'That’s fine: you can come back with your reference.' : 'That’s fine: your answers are already saved.'} If you can, though, the screenshots take about a minute, and they are the part of MyPhone/MyBrain no one else can provide: real screen time and real app use, not guesses.
          </p>
          <div className="mpmb-callout__actions">
            <Button
              variant="primary"
              onClick={() => {
                setAppeal(false);
                setHowOpen(true);
                document.getElementById('mpmb-capture-choose')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
              }}
            >
              OK, I’ll add them now
            </Button>
            <Button variant="link" onClick={skip}>
              Skip the screenshots
            </Button>
          </div>
        </Callout>
      )}

      {editing && <ImageEditor image={editing} onClose={closeEditor} onApply={applyEdit} />}
    </StepShell>
  );
}
