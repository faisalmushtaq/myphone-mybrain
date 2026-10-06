import { useState } from 'react';
import type { LabPhase } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ChoiceField } from '../../components/ui/Field';
import { formatBytes } from '../../lib/image';
import { platformNames } from '../cleaner';
import { LabShell } from '../LabShell';
import type { LabArchive, LabScreenshot } from '../model';
import { useLab } from '../store';
import { useLabSender } from '../useLabSender';
import type { FieldError } from '../validation';

/** Everything prepared is uploaded and recorded against the participant code in one go, filed under before or after the break. */
export function LabSend() {
  const { state, dispatch } = useLab();
  const { send: sendFiles, busy } = useLabSender();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [nudges, setNudges] = useState(0);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const pendingArchives = state.archives.filter((a) => a.status !== 'sent');
  const pendingShots = state.screenshots.filter((s) => s.status !== 'sent');
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';

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
    const result = await sendFiles(['archive', 'screenshot']);
    if (result.ok) dispatch({ type: 'go-to', stepId: 'done' });
    else setErrors([{ field: 'lab-files', message: result.message ?? 'Please try again.' }]);
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
