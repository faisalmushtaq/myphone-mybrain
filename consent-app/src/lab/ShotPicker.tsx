import { useEffect, useMemo, useState } from 'react';
import { getApi } from '../api';
import { ImageCapture } from '../components/ImageCapture';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { announce } from '../lib/announce';
import { clientId } from '../lib/ids';
import { formatBytes, loadImage, processImage } from '../lib/image';
import { labStudy } from './config';
import { labFileStore } from './fileStore';
import type { LabScreenshot } from './model';
import { useLab } from './store';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Adding screen-time screenshots: pick or take them, see them, remove any.
 * Each is re-encoded on the device, which strips camera and location
 * metadata, before anything is uploaded. Used on the screenshots step and
 * in the mid-break check-in.
 */
export function ShotPicker({ busy, onAdded }: { busy: boolean; onAdded?: () => void }) {
  const { state, dispatch } = useLab();
  const [problems, setProblems] = useState<string[]>([]);
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
        found.push(`${file.name}: at most ${labStudy.maxScreenshots} screenshots can be sent at once.`);
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
    onAdded?.();
    announce(found.length ? `${found.length} file${found.length === 1 ? ' was' : 's were'} not added.` : 'Screenshot added. Nothing is sent until you press Send.');
  };

  const removeShot = (s: LabScreenshot) => {
    if (s.uploadId && state.session) void getApi().deleteLabUpload(state.session.sessionId, s.uploadId).catch(() => undefined);
    labFileStore.remove(s.id);
    dispatch({ type: 'remove-screenshot', id: s.id });
  };

  return (
    <>
      <ImageCapture onFiles={(files) => void addFiles(files)} disabled={busy} count={state.screenshots.length} max={labStudy.maxScreenshots} />
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
    </>
  );
}
