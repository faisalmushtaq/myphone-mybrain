import { useCallback, useEffect, useRef, useState } from 'react';
import { loadImage, processImage, type Rect } from '../lib/image';
import { imageStore } from '../lib/imageStore';
import type { DonationImage } from '../model/types';
import { Button } from './ui/Button';

interface Props {
  image: DonationImage;
  onApply: (blob: Blob, flags: { redacted: boolean; cropped: boolean }) => void;
  onClose: () => void;
}

type Mode = 'hide' | 'crop';

function normalise(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/**
 * Lets the person paint over parts of an image (for example a notification
 * at the top of a screenshot) or crop it, before it is uploaded. Redaction
 * replaces the pixels, so hidden content is not in the uploaded file.
 *
 * Rendered as a native <dialog> opened with showModal(), which keeps focus
 * inside, makes the rest of the page inert and closes on Escape.
 */
export function ImageEditor({ image, onApply, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<Mode>('hide');
  const [redactions, setRedactions] = useState<Rect[]>([]);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const fit = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const dialog = dialogRef.current;
    if (!img || !canvas || !dialog) return;
    const maxW = Math.min(dialog.clientWidth - 40, 640);
    const maxH = Math.max(240, window.innerHeight * 0.5);
    const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    canvas.width = Math.round(img.naturalWidth * s);
    canvas.height = Math.round(img.naturalHeight * s);
    setScale(s);
  }, []);

  // Open as a modal, load the image and size the canvas to fit.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    let cancelled = false;
    const stored = imageStore.get(image.id);
    if (stored) {
      loadImage(stored.blob)
        .then((img) => {
          if (cancelled) return;
          imgRef.current = img;
          fit();
        })
        .catch(() => setError('We couldn’t open this image.'));
    }
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
    };
  }, [image.id, fit]);

  // Draw whenever anything changes.
  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!img || !canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#113b3f';
    for (const r of redactions) ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
    const activeCrop = mode === 'crop' && draft ? draft : crop;
    if (activeCrop) {
      ctx.fillStyle = 'rgba(0, 63, 70, 0.55)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(activeCrop.x * scale, activeCrop.y * scale, activeCrop.w * scale, activeCrop.h * scale);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#ffdc70';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(activeCrop.x * scale, activeCrop.y * scale, activeCrop.w * scale, activeCrop.h * scale);
      ctx.setLineDash([]);
    }
    if (mode === 'hide' && draft) {
      ctx.fillStyle = 'rgba(17, 59, 63, 0.75)';
      ctx.fillRect(draft.x * scale, draft.y * scale, draft.w * scale, draft.h * scale);
    }
  }, [redactions, crop, draft, mode, scale]);

  const toImage = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const img = imgRef.current;
    const w = img?.naturalWidth ?? 1;
    const h = img?.naturalHeight ?? 1;
    const x = Math.min(w, Math.max(0, ((e.clientX - rect.left) / rect.width) * w));
    const y = Math.min(h, Math.max(0, ((e.clientY - rect.top) / rect.height) * h));
    return { x, y };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = toImage(e);
    setDraft({ ...start.current, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!start.current) return;
    e.preventDefault();
    setDraft(normalise(start.current, toImage(e)));
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!start.current) return;
    const rect = normalise(start.current, toImage(e));
    start.current = null;
    setDraft(null);
    if (rect.w < 4 || rect.h < 4) return;
    if (mode === 'hide') setRedactions((r) => [...r, rect]);
    else setCrop(rect);
  };

  const apply = async () => {
    const stored = imageStore.get(image.id);
    if (!stored) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await processImage(stored.blob, { redactions, crop, outputType: stored.blob.type });
      onApply(blob, { redacted: redactions.length > 0, cropped: crop !== null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The image could not be changed.');
      setBusy(false);
    }
  };

  const changed = redactions.length > 0 || crop !== null;

  return (
    <dialog
      className="mpmb-editor"
      ref={dialogRef}
      aria-labelledby="mpmb-editor-title"
      aria-describedby="mpmb-editor-help"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mpmb-editor__inner">
        <h2 className="mpmb-h2" id="mpmb-editor-title">
          Hide part of the image
        </h2>
        <p className="mpmb-hint" id="mpmb-editor-help">
          {mode === 'hide'
            ? 'Drag a box over anything you don’t want to share, such as a notification, a name, or an app or website you’d rather not show. You can add more than one box.'
            : 'Drag a box around the part you want to keep. Everything outside it will be removed.'}
        </p>
        <div className="mpmb-editor__modes" role="group" aria-label="Tool">
          <button type="button" className={`mpmb-editor__mode${mode === 'hide' ? ' is-active' : ''}`} aria-pressed={mode === 'hide'} onClick={() => setMode('hide')}>
            Hide an area
          </button>
          <button type="button" className={`mpmb-editor__mode${mode === 'crop' ? ' is-active' : ''}`} aria-pressed={mode === 'crop'} onClick={() => setMode('crop')}>
            Crop
          </button>
        </div>
        <div className="mpmb-editor__stage">
          <canvas
            ref={canvasRef}
            className="mpmb-editor__canvas"
            role="img"
            aria-label={`${image.name}. Drag on the image to ${mode === 'hide' ? 'hide an area' : 'choose the area to keep'}.`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>
        <p className="mpmb-editor__count" role="status">
          {redactions.length ? `${redactions.length} area${redactions.length === 1 ? '' : 's'} hidden. ` : ''}
          {crop ? 'Crop set. ' : ''}
          {!changed && 'No changes yet.'}
        </p>
        {error && (
          <p className="mpmb-error" role="alert">
            {error}
          </p>
        )}
        <div className="mpmb-editor__actions">
          <Button variant="primary" onClick={apply} loading={busy} disabled={!changed}>
            Apply changes
          </Button>
          {redactions.length > 0 && (
            <Button variant="secondary" onClick={() => setRedactions((r) => r.slice(0, -1))}>
              Undo last box
            </Button>
          )}
          {crop && (
            <Button variant="secondary" onClick={() => setCrop(null)}>
              Remove crop
            </Button>
          )}
          <Button variant="link" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <p className="mpmb-hint">Hidden parts are removed from the image itself, not just covered up. If you can’t use the drawing tool, remove the image instead and take a new screenshot that shows only the list of apps.</p>
      </div>
    </dialog>
  );
}
