import { useState } from 'react';
import { getApi } from '../../api';
import { ApiError, type LabPhase } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ChoiceField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { formatBytes } from '../../lib/image';
import { describeError, labClientInfo, labSession } from '../api';
import { platformNames } from '../cleaner';
import { labFileStore } from '../fileStore';
import { LabShell } from '../LabShell';
import type { LabArchive, LabScreenshot } from '../model';
import { useLab } from '../store';
import type { FieldError } from '../validation';

/** Everything prepared is uploaded and recorded against the participant code in one go, filed under before or after the break. */
export function LabSend() {
  const { state, dispatch } = useLab();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [nudges, setNudges] = useState(0);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const busy = state.submission.donationStage === 'sending';
  const pendingArchives = state.archives.filter((a) => a.status !== 'sent');
  const pendingShots = state.screenshots.filter((s) => s.status !== 'sent');
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';

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
    const found: FieldError[] = [];
    if (!state.phase) found.push({ field: 'lab-phase-pre', message: 'Tell us whether these files are from before or after your social media break.' });
    const shotsTotal = state.screenshots.filter((s) => s.status === 'sent').length + pendingShots.length;
    const archivesTotal = state.archives.filter((a) => a.status === 'sent').length + pendingArchives.length;
    // The study's minimum is a screenshot plus a cleaned file; it is asked for twice, then the send may go ahead with what there is.
    const missingMinimum = !shotsTotal || !archivesTotal;
    if (missingMinimum && nudges < 2) {
      setNudges(nudges + 1);
      const what = !shotsTotal && !archivesTotal ? 'a screen-time screenshot and a cleaned TikTok, YouTube or Instagram file' : !shotsTotal ? 'at least one screen-time screenshot' : 'at least one cleaned TikTok, YouTube or Instagram file';
      found.push({ field: 'lab-files', message: nudges === 0 ? `The study needs ${what}. Please add it before sending.` : `Without ${what} the team cannot use this send fully. If you really cannot add it now, press Send once more and add it later.` });
    }
    if (!pendingArchives.length && !pendingShots.length) found.push({ field: 'lab-files', message: 'Nothing new to send. Add a file to send more.' });
    if (found.length) {
      setErrors(found);
      return;
    }
    dispatch({ type: 'submission', patch: { donationStage: 'sending', donationError: null } });
    announce('Uploading your files.');
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const items: Item[] = [...pendingShots.map((s): Item => ({ kind: 'screenshot', item: s })), ...pendingArchives.map((a): Item => ({ kind: 'archive', item: a }))];
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
        phase: state.phase!,
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

  const status = (f: LabArchive | LabScreenshot) => (f.status === 'sent' ? 'Sent' : f.status === 'uploading' ? `Uploading… ${Math.round(f.progress * 100)}%` : f.status === 'failed' ? (f.error ?? 'Failed') : 'Ready to send');

  if (!ready) {
    return (
      <LabShell kicker="Send your data" title="Enter your participant code first." intro={<p>We need your code and your consent before any data can be sent. It takes a minute.</p>} hideContinue>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'participant-id' })}>
            Enter my code
          </Button>
        </div>
      </LabShell>
    );
  }

  return (
    <LabShell kicker="Send your data" title="Check and send." intro={<p>Everything below is sent together, linked to your participant code <strong className="mpmb-mono">{state.code}</strong>, never to your name.</p>} errors={errors} onContinue={() => void send()} continueLabel="Send my data" continueLoading={busy} width="wide">
      {state.submission.donationStage === 'failed' && state.submission.donationError && (
        <Callout tone="important" role="alert">
          <p>{state.submission.donationError}</p>
        </Callout>
      )}
      <ChoiceField id="lab-phase" name="lab-phase" legend="Are these files from before or after your social media break?" hint="The study compares the two, so each send is filed under one or the other. You can come back and send more at either point." value={state.phase} onChange={(v) => dispatch({ type: 'phase', phase: v as LabPhase })} options={[{ value: 'pre', label: 'Before my break' }, { value: 'post', label: 'After my break' }]} error={errs['lab-phase-pre']} />

      <section aria-labelledby="send-shots-heading" id="lab-files" tabIndex={-1}>
        <h2 className="mpmb-h3" id="send-shots-heading">
          Screen-time screenshots
        </h2>
        {state.screenshots.length ? (
          <ul className="mpmb-filelist" role="list">
            {state.screenshots.map((s, i) => (
              <li key={s.id} className={s.status === 'failed' ? 'is-failed' : ''}>
                <div>
                  <strong>Screenshot {i + 1}</strong> · {s.width} × {s.height} · {formatBytes(s.size)}
                  <span className="mpmb-filelist__meta">{status(s)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mpmb-hint">None added yet.</p>
        )}
        <Button variant="link" onClick={() => dispatch({ type: 'go-to', stepId: 'screenshots' })}>
          {state.screenshots.length ? 'Add or remove screenshots' : 'Add screenshots'}
        </Button>
      </section>

      <section aria-labelledby="send-archives-heading">
        <h2 className="mpmb-h3" id="send-archives-heading">
          Cleaned TikTok, YouTube or Instagram files
        </h2>
        {state.archives.length ? (
          <ul className="mpmb-filelist" role="list">
            {state.archives.map((a) => (
              <li key={a.id} className={a.status === 'failed' ? 'is-failed' : ''}>
                <div>
                  <strong>{a.platforms.map((p) => platformNames[p]).join(' + ')}</strong> · {formatBytes(a.size)} · {a.categories.length} categories
                  <span className="mpmb-filelist__meta">{status(a)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mpmb-hint">None prepared yet.</p>
        )}
        <Button variant="link" onClick={() => dispatch({ type: 'go-to', stepId: 'clean' })}>
          {state.archives.length ? 'Prepare another file' : 'Prepare a file'}
        </Button>
      </section>
      <p className="mpmb-hint">Pressing “Send my data” uploads the files above to the study’s secure storage at the University of Leeds and records them against your participant code. You can come back and add more later.</p>
    </LabShell>
  );
}
