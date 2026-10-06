import { useEffect, useMemo, useState } from 'react';
import { getApi } from '../../api';
import { ImageCapture } from '../../components/ImageCapture';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { announce } from '../../lib/announce';
import { clientId } from '../../lib/ids';
import { formatBytes, loadImage, processImage } from '../../lib/image';
import { labStudy } from '../config';
import { labFileStore } from '../fileStore';
import { LabShell } from '../LabShell';
import type { LabScreenshot } from '../model';
import { useLab } from '../store';
import type { FieldError } from '../validation';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** The screen-time screenshots, added first; nothing is sent until the send step. */
export function LabScreenshots() {
  const { state, dispatch } = useLab();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [nudges, setNudges] = useState(0);
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';
  const urls = useMemo(() => new Map(state.screenshots.map((s) => [s.id, labFileStore.get(s.id)]).filter(([, b]) => b).map(([id, blob]) => [id as string, URL.createObjectURL(blob as Blob)])), [state.screenshots]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

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
    announce(found.length ? `${found.length} file${found.length === 1 ? ' was' : 's were'} not added.` : 'Screenshot added. Nothing is sent until the send step.');
  };

  const removeShot = (s: LabScreenshot) => {
    if (s.uploadId && state.session) void getApi().deleteLabUpload(state.session.sessionId, s.uploadId).catch(() => undefined);
    labFileStore.remove(s.id);
    dispatch({ type: 'remove-screenshot', id: s.id });
  };

  const next = () => {
    // The study needs at least one screenshot; after two nudges the person may go on without.
    if (!state.screenshots.length && nudges < 2) {
      setNudges(nudges + 1);
      setErrors([{ field: 'lab-files', message: nudges === 0 ? 'Add at least one screenshot of your screen-time summary before going on. The study needs it alongside your app data.' : 'The study really does need your screen-time screenshots. If you cannot add them right now, press Continue once more to go on and add them later.' }]);
      return;
    }
    setErrors([]);
    dispatch({ type: 'next' });
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
    <LabShell kicker="Your screenshots" title="Add your screen-time screenshots." intro={<p>The screenshots you took of your phone’s Screen Time (iPhone) or Digital Wellbeing (Android) summary. Several are better than one: the weekly chart, the daily view and the full list of apps with their times. Camera metadata is removed before anything leaves this device.</p>} errors={errors} onContinue={next} continueLabel="Next: my TikTok, YouTube or Instagram file" width="wide">
      <section aria-labelledby="shots-heading" id="lab-files" tabIndex={-1}>
        <h2 className="mpmb-h3" id="shots-heading">
          Screenshots
        </h2>
        <ImageCapture onFiles={(files) => void addFiles(files)} count={state.screenshots.length} />
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
                  <span>{s.status === 'sent' ? 'Sent' : s.status === 'failed' ? (s.error ?? 'Failed') : 'Ready'}</span>
                </div>
                {s.status !== 'sent' && (
                  <Button variant="link" onClick={() => removeShot(s)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mpmb-hint">Nothing has been sent yet. Next you choose what to share from your TikTok, YouTube or Instagram download; everything is sent together at the end.</p>
    </LabShell>
  );
}
