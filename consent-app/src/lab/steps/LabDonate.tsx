import { useEffect, useMemo, useState } from 'react';
import { getApi } from '../../api';
import { ApiError } from '../../api/types';
import { ImageCapture } from '../../components/ImageCapture';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { announce } from '../../lib/announce';
import { clientId } from '../../lib/ids';
import { formatBytes, loadImage, processImage } from '../../lib/image';
import { describeError, labClientInfo, labSession } from '../api';
import { platformNames } from '../cleaner';
import { labStudy } from '../config';
import { labFileStore } from '../fileStore';
import { LabShell } from '../LabShell';
import type { LabArchive, LabScreenshot } from '../model';
import { useLab } from '../store';
import type { FieldError } from '../validation';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Screenshots are added here, then everything prepared is uploaded and recorded against the participant code in one go. */
export function LabDonate() {
  const { state, dispatch } = useLab();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const busy = state.submission.donationStage === 'sending';
  const pendingArchives = state.archives.filter((a) => a.status !== 'sent');
  const pendingShots = state.screenshots.filter((s) => s.status !== 'sent');
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
    announce(found.length ? `${found.length} file${found.length === 1 ? ' was' : 's were'} not added.` : 'Screenshot added. Nothing is sent until you press Send.');
  };

  const removeShot = (s: LabScreenshot) => {
    if (s.uploadId && state.session) void getApi().deleteLabUpload(state.session.sessionId, s.uploadId).catch(() => undefined);
    labFileStore.remove(s.id);
    dispatch({ type: 'remove-screenshot', id: s.id });
  };

  type Item = { kind: 'archive'; item: LabArchive } | { kind: 'screenshot'; item: LabScreenshot };

  const uploadOne = async (sessionId: string, entry: Item): Promise<string | null> => {
    const { kind, item } = entry;
    const blob = labFileStore.get(item.id);
    const update = (patch: Partial<LabArchive & LabScreenshot>) => (kind === 'archive' ? dispatch({ type: 'update-archive', id: item.id, patch }) : dispatch({ type: 'update-screenshot', id: item.id, patch }));
    if (item.status === 'uploaded' && item.uploadId) return item.uploadId;
    if (!blob) {
      update({ status: 'failed', error: 'This file is no longer available on this device. Please add it again.' });
      return null;
    }
    update({ status: 'uploading', progress: 0, error: null });
    try {
      const api = getApi();
      const slot = await api.requestLabUploadSlot(sessionId, { contentType: blob.type || 'application/zip', size: blob.size });
      await api.uploadImage(slot, blob, (fraction) => update({ progress: fraction }));
      update({ status: 'uploaded', progress: 1, uploadId: slot.uploadId });
      return slot.uploadId;
    } catch (error) {
      update({ status: 'failed', progress: 0, error: error instanceof ApiError ? describeError(error, 'this file') : 'The upload did not finish. Please try again.' });
      return null;
    }
  };

  const send = async () => {
    setErrors([]);
    if (!pendingArchives.length && !pendingShots.length) {
      setErrors([{ field: 'lab-files', message: 'Add at least one cleaned file or screenshot before sending, or go back to prepare one.' }]);
      return;
    }
    dispatch({ type: 'submission', patch: { donationStage: 'sending', donationError: null } });
    announce('Uploading your files.');
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const items: Item[] = [...pendingArchives.map((a): Item => ({ kind: 'archive', item: a })), ...pendingShots.map((s): Item => ({ kind: 'screenshot', item: s }))];
      const uploaded: { entry: Item; uploadId: string }[] = [];
      for (const entry of items) {
        const uploadId = await uploadOne(session.sessionId, entry);
        if (uploadId) uploaded.push({ entry, uploadId });
      }
      if (!uploaded.length) throw new ApiError('network', 'No file could be uploaded.');
      const result = await getApi().submitLabDonation(session, {
        participantCode: state.code,
        uploads: uploaded.map(({ entry, uploadId }) =>
          entry.kind === 'archive'
            ? { uploadId, kind: 'archive' as const, name: entry.item.name, contentType: 'application/zip', size: entry.item.size, platforms: entry.item.platforms, categories: entry.item.categories, kept: Object.fromEntries(Object.entries(entry.item.kept).map(([k, v]) => [k, Number(v)])) }
            : { uploadId, kind: 'screenshot' as const, name: entry.item.name, contentType: entry.item.type, size: entry.item.size },
        ),
        phone: state.phone,
        client: labClientInfo(),
      });
      for (const r of result.rejected) {
        const hit = uploaded.find((u) => u.uploadId === r.uploadId);
        if (!hit) continue;
        if (hit.entry.kind === 'archive') dispatch({ type: 'update-archive', id: hit.entry.item.id, patch: { status: 'failed', uploadId: null, error: r.reason } });
        else dispatch({ type: 'update-screenshot', id: hit.entry.item.id, patch: { status: 'failed', uploadId: null, error: r.reason } });
      }
      dispatch({ type: 'files-sent', ids: result.accepted, receivedAt: result.receivedAt, donationId: result.donationId });
      if (result.accepted.length) {
        announce(result.rejected.length ? `${result.accepted.length} sent, ${result.rejected.length} not accepted.` : 'Your data has been sent. Thank you.');
        dispatch({ type: 'go-to', stepId: 'done' });
      } else {
        setErrors([{ field: 'lab-files', message: result.rejected[0]?.reason ?? 'Nothing could be accepted. Please check the files and try again.' }]);
      }
    } catch (error) {
      const message = describeError(error, 'your data');
      dispatch({ type: 'submission', patch: { donationStage: 'failed', donationError: message } });
      setErrors([{ field: 'lab-files', message }]);
    }
  };

  return (
    <LabShell kicker="Send your data" title="Add your screenshots and send." intro={<p>Add the screen-time screenshots you took, check what is ready to go, then send everything in one go. Files are linked to your participant code <strong className="mpmb-mono">{state.code}</strong>, never to your name.</p>} errors={errors} onContinue={() => void send()} continueLabel="Send my data" continueLoading={busy} width="wide">
      <section aria-labelledby="shots-heading" id="lab-files" tabIndex={-1}>
        <h2 className="mpmb-h3" id="shots-heading">
          Screen-time screenshots
        </h2>
        <p className="mpmb-hint">Several screenshots are better than one: the weekly chart, the daily view and the full list of apps with their times. Camera metadata is removed before upload.</p>
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
                  <span>{s.width} × {s.height} · {formatBytes(s.size)}</span>
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

      <section aria-labelledby="archives-heading">
        <h2 className="mpmb-h3" id="archives-heading">
          Cleaned TikTok and YouTube files
        </h2>
        {state.archives.length ? (
          <ul className="mpmb-filelist" role="list">
            {state.archives.map((a) => (
              <li key={a.id} className={a.status === 'failed' ? 'is-failed' : ''}>
                <div>
                  <strong>{a.platforms.map((p) => platformNames[p]).join(' + ')}</strong> · {formatBytes(a.size)} · {a.categories.length} categories
                  <span className="mpmb-filelist__meta">{a.status === 'sent' ? 'Sent' : a.status === 'uploading' ? `Uploading… ${Math.round(a.progress * 100)}%` : a.status === 'failed' ? (a.error ?? 'Failed') : 'Ready to send'}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mpmb-hint">None prepared yet. You can send screenshots now and add the TikTok and YouTube files when they arrive.</p>
        )}
        <Button variant="link" onClick={() => dispatch({ type: 'go-to', stepId: 'clean' })}>
          {state.archives.length ? 'Prepare another file' : 'Prepare a TikTok or YouTube file'}
        </Button>
      </section>
      <p className="mpmb-hint">Pressing “Send my data” uploads the files above to the study’s secure storage at the University of Leeds and records them against your participant code. You can come back and add more later.</p>
    </LabShell>
  );
}
