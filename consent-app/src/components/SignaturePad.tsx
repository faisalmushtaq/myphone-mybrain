import { useCallback, useEffect, useRef, useState } from 'react';
import { study } from '../config/study';
import type { SignatureRecord } from '../model/types';
import { Button } from './ui/Button';

interface Props {
  id: string;
  value: SignatureRecord | null;
  onChange: (signature: SignatureRecord | null) => void;
  error?: string;
}

const HEIGHT = 190;

/**
 * Finger/stylus signature capture on a canvas. The signature is exported as a
 * PNG data URL together with stroke count, pointer type and time, and stored in
 * the consent record. A typed alternative is offered for people who cannot
 * draw (configurable in config/study.ts).
 */
export function SignaturePad({ id, value, onChange, error }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const pointerType = useRef<string | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<'drawn' | 'typed'>(value?.method ?? 'drawn');
  const [typed, setTyped] = useState(value?.typedName ?? '');

  const paint = useCallback((dataUrl: string | null) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ratio = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${HEIGHT}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, HEIGHT);
    // Baseline
    ctx.strokeStyle = '#c8ddda';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(18, HEIGHT - 40);
    ctx.lineTo(width - 18, HEIGHT - 40);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = '#113b3f';
    if (dataUrl) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, width, HEIGHT);
      img.src = dataUrl;
    }
  }, []);

  // (Re)draw on mount, when the stored value changes from outside, and on resize.
  useEffect(() => {
    if (mode !== 'drawn') return;
    paint(value?.method === 'drawn' ? value.imageDataUrl : null);
    strokes.current = value?.method === 'drawn' ? value.strokeCount : 0;
    const onResize = () => paint(value?.method === 'drawn' ? value.imageDataUrl : null);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mode, paint, value]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    drawing.current = true;
    pointerType.current = e.pointerType;
    const p = point(e);
    last.current = p;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !last.current) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    strokes.current += 1;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange({
      method: 'drawn',
      imageDataUrl: canvas.toDataURL('image/png'),
      typedName: null,
      strokeCount: strokes.current,
      pointerType: pointerType.current,
      capturedAt: new Date().toISOString(),
    });
  };

  const clear = () => {
    strokes.current = 0;
    paint(null);
    onChange(null);
  };

  const commitTyped = (name: string) => {
    setTyped(name);
    onChange(name.trim() ? { method: 'typed', imageDataUrl: null, typedName: name.trim(), strokeCount: 0, pointerType: 'keyboard', capturedAt: new Date().toISOString() } : null);
  };

  const switchMode = (next: 'drawn' | 'typed') => {
    // Switching modes never counts as signing: the person must draw, or type their name, themselves.
    setMode(next);
    strokes.current = 0;
    setTyped('');
    onChange(null);
  };

  return (
    <div className={`mpmb-signature${error ? ' has-error' : ''}`}>
      {mode === 'drawn' ? (
        <>
          <div className="mpmb-signature__frame" ref={wrapRef}>
            <canvas
              id={id}
              ref={canvasRef}
              className="mpmb-signature__canvas"
              tabIndex={-1}
              role="img"
              aria-label={value?.method === 'drawn' && value.strokeCount > 0 ? 'Your signature. Use the Clear button to start again.' : 'Signature box. Draw your signature here with your finger, a stylus or a mouse.'}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={endStroke}
            />
            {(!value || value.strokeCount === 0) && (
              <span className="mpmb-signature__placeholder" aria-hidden="true">
                Sign here
              </span>
            )}
          </div>
          <div className="mpmb-signature__tools">
            <Button variant="secondary" onClick={clear}>
              Clear and sign again
            </Button>
            {study.allowTypedSignature && (
              <Button variant="link" onClick={() => switchMode('typed')}>
                I can’t draw my signature
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="mpmb-signature__typed">
          <label className="mpmb-label" htmlFor={id}>
            Type your full name as your signature
          </label>
          <p className="mpmb-hint" id={`${id}-typed-hint`}>
            Typing your full name here, yourself, counts as your signature.
          </p>
          <input id={id} className="mpmb-input mpmb-input--signature" value={typed} onChange={(e) => commitTyped(e.target.value)} autoComplete="name" aria-describedby={`${id}-typed-hint`} />
          <div className="mpmb-signature__tools">
            <Button variant="link" onClick={() => switchMode('drawn')}>
              Draw my signature instead
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
