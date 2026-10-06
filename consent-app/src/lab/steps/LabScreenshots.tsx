import { useEffect, useMemo, useState } from 'react';
import { getApi } from '../../api';
import type { LabPhase, LabPhone } from '../../api/types';
import { ImageCapture } from '../../components/ImageCapture';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ChoiceField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { clientId } from '../../lib/ids';
import { formatBytes, loadImage, processImage } from '../../lib/image';
import { labStudy } from '../config';
import { labFileStore } from '../fileStore';
import { androidSteps, jumpTo, phones, screenTimeIphone, Steps } from '../guideSteps';
import { LabShell } from '../LabShell';
import type { LabScreenshot } from '../model';
import { useLab } from '../store';
import { useLabSender } from '../useLabSender';
import type { FieldError } from '../validation';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * The first donation: screenshots of the phone's screen-time summary, taken
 * and sent straight away, before the app data download that takes days. The
 * phone's own steps are shown here so nothing has to be looked up elsewhere.
 */
export function LabScreenshots() {
  const { state, dispatch } = useLab();
  const { send, busy } = useLabSender();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [nudges, setNudges] = useState(0);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';
  const phone = state.phone;
  const pending = state.screenshots.filter((s) => s.status !== 'sent');
  const sent = state.screenshots.filter((s) => s.status === 'sent');
  const urls = useMemo(() => new Map(state.screenshots.map((s) => [s.id, labFileStore.get(s.id)]).filter(([, b]) => b).map(([id, blob]) => [id as string, URL.createObjectURL(blob as Blob)])), [state.screenshots]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const choosePhone = (p: LabPhone) => {
    dispatch({ type: 'phone', phone: p });
    window.setTimeout(() => jumpTo(`shots-${p}`), 60);
  };

  const addFiles = async (files: FileList) => {
    const found: string[] = [];
    let count = state.screenshots.length;
    for (const file of Array.from(files)) {
      if (!IMAGE_TYPES.includes(file.type)) {
        found.push(`${file.name}: please add a PNG or JPEG screenshot.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        found.push(`${file.name}: this image is too large (over 10 MB).`);
        continue;
      }
      if (count >= labStudy.maxScreenshots) {
        found.push(`${file.name}: at most ${labStudy.maxScreenshots} screenshots can be sent.`);
        continue;
      }
      try {
        // Re-encoding strips camera and location metadata before anything leaves the device.
        const blob = await processImage(file, { redactions: [], crop: null, outputType: file.type });
        const img = await loadImage(blob);
        const id = clientId('shot');
        labFileStore.put(id, blob);
        dispatch({ type: 'add-screenshot', screenshot: { id, name: file.name, type: blob.type, size: blob.size, width: img.naturalWidth, height: img.naturalHeight, status: 'ready', progress: 0, uploadId: null, error: null } });
        count += 1;
      } catch {
        found.push(`${file.name}: we couldn’t open this image.`);
      }
    }
    setProblems(found);
    setErrors([]);
    announce(found.length ? `${found.length} file${found.length === 1 ? ' was' : 's were'} not added.` : 'Screenshot added. Nothing is sent until you press Send.');
  };

  const removeShot = (s: LabScreenshot) => {
    if (s.uploadId && state.session) void getApi().deleteLabUpload(state.session.sessionId, s.uploadId).catch(() => undefined);
    labFileStore.remove(s.id);
    dispatch({ type: 'remove-screenshot', id: s.id });
  };

  const next = async () => {
    setErrors([]);
    // The study needs at least one screenshot; after two nudges the person may go on without.
    if (!state.screenshots.length && nudges < 2) {
      setNudges(nudges + 1);
      setErrors([{ field: 'lab-files', message: nudges === 0 ? 'Add at least one screenshot of your screen-time summary before going on. The study needs it alongside your app data.' : 'The study really does need your screen-time screenshots. If you cannot add them right now, press Continue once more to go on and add them later.' }]);
      return;
    }
    if (!pending.length) {
      dispatch({ type: 'go-to', stepId: 'guide' });
      return;
    }
    if (!state.phase) {
      setErrors([{ field: 'lab-phase-pre', message: 'Tell us whether these screenshots are from before or after your social media break.' }]);
      return;
    }
    const result = await send(['screenshot']);
    if (result.ok) dispatch({ type: 'go-to', stepId: 'guide' });
    else setErrors([{ field: 'lab-files', message: result.message ?? 'Please try again.' }]);
  };

  if (!ready) {
    return (
      <LabShell kicker="Your screenshots" title="Enter your participant code first." intro={<p>We need your code and your consent before any data can be sent. It takes a minute.</p>} hideContinue>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'participant-id' })}>
            Enter my code
          </Button>
        </div>
      </LabShell>
    );
  }

  return (
    <LabShell
      kicker="Your screenshots"
      title="Send your screen-time screenshots."
      intro={<p>This part takes a few minutes and goes to the team straight away. Take screenshots of your phone’s Screen Time (iPhone) or Digital Wellbeing (Android) summary, add them here and send them. Several are better than one: the weekly chart, the daily view and the full list of apps with their times.</p>}
      errors={errors}
      onContinue={() => void next()}
      continueLabel={pending.length ? `Send ${pending.length === 1 ? 'my screenshot' : `my ${pending.length} screenshots`}` : sent.length ? 'Next: my app data' : 'Continue'}
      continueLoading={busy}
      width="wide"
    >
      <section aria-labelledby="shots-how-heading">
        <h2 className="mpmb-h2" id="shots-how-heading" tabIndex={-1}>
          1. Take the screenshots
        </h2>
        <p>Take several, not just the first screen: scroll down so the chart, the totals and the full app list (including anything under “Show more”) are all captured.</p>
        <fieldset className="mpmb-field">
          <legend className="mpmb-label">Which phone do you have?</legend>
          <div className="mpmb-chips" role="presentation">
            {phones.map((p) => (
              <label key={p.id} className={`mpmb-chip${phone === p.id ? ' is-selected' : ''}`} htmlFor={`lab-phone-${p.id}`}>
                <input id={`lab-phone-${p.id}`} type="radio" name="lab-phone" value={p.id} className="mpmb-choice__input" checked={phone === p.id} onChange={() => choosePhone(p.id)} />
                <span className="mpmb-choice__dot" aria-hidden="true" />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        {phone === 'iphone' && (
          <div id="shots-iphone" className="mpmb-guide-phone" tabIndex={-1}>
            <h3 className="mpmb-h3">On iPhone</h3>
            <p className="mpmb-hint">To take a screenshot, press the Side button and Volume Up together.</p>
            <Steps steps={screenTimeIphone} />
          </div>
        )}
        {phone === 'android' && (
          <div id="shots-android" className="mpmb-guide-phone" tabIndex={-1}>
            <h3 className="mpmb-h3">On Android</h3>
            <p className="mpmb-hint">To take a screenshot, press Power and Volume Down together.</p>
            <Steps steps={androidSteps} />
          </div>
        )}
      </section>

      <section aria-labelledby="shots-heading" id="lab-files" tabIndex={-1}>
        <h2 className="mpmb-h2" id="shots-heading" tabIndex={-1}>
          2. Add them here
        </h2>
        <p className="mpmb-hint">Camera metadata is removed before anything leaves this device.</p>
        <ImageCapture onFiles={(files) => void addFiles(files)} disabled={busy} count={state.screenshots.length} />
        {problems.length > 0 && (
          <Callout tone="important" role="alert">
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Callout>
        )}
        {state.screenshots.length > 0 && (
          <ul className="mpmb-shots" role="list">
            {state.screenshots.map((s, i) => (
              <li key={s.id} className={s.status === 'failed' ? 'is-failed' : ''}>
                {urls.get(s.id) ? <img src={urls.get(s.id)} alt={`Screenshot ${i + 1}`} /> : <span className="mpmb-shots__placeholder">Screenshot {i + 1}</span>}
                <div className="mpmb-shots__meta">
                  <span>
                    {s.width} × {s.height} · {formatBytes(s.size)}
                  </span>
                  <span>{s.status === 'sent' ? 'Sent' : s.status === 'uploading' ? `Uploading… ${Math.round(s.progress * 100)}%` : s.status === 'failed' ? (s.error ?? 'Failed') : 'Ready'}</span>
                </div>
                {s.status !== 'sent' && !busy && (
                  <Button variant="link" onClick={() => removeShot(s)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending.length > 0 && <ChoiceField id="lab-phase" name="lab-phase" legend="Are these screenshots from before or after your social media break?" hint="The study compares the two, so each send is filed under one or the other." value={state.phase} onChange={(v) => dispatch({ type: 'phase', phase: v as LabPhase })} options={[{ value: 'pre', label: 'Before my break' }, { value: 'post', label: 'After my break' }]} error={errs['lab-phase-pre']} />}
      <p className="mpmb-hint">{pending.length ? 'Pressing Send uploads these screenshots to the study’s secure storage at the University of Leeds, linked to your participant code. Then we show you how to request your app data.' : sent.length ? 'Your screenshots are with the team. Next, request your app data.' : 'Nothing has been sent yet.'}</p>
    </LabShell>
  );
}
