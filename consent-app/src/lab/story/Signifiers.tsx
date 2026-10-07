import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * The questions that place a MyStory story, SenseMaker style: a triangle
 * (how much the story was about each of three things, in any mix), a slider
 * between two ends, and "not sure" for either. Both work by touch, mouse and
 * keyboard, and say their value in words for screen readers.
 */

export type Shares = { a: number; b: number; c: number };

const W = 300;
const H = 262;
const A = { x: 150, y: 16 };
const B = { x: 16, y: 246 };
const C = { x: 284, y: 246 };
const CENTRE: Shares = { a: 1 / 3, b: 1 / 3, c: 1 / 3 };

/** Shares for a point, pulled inside the triangle when it is outside. */
export function sharesAt(x: number, y: number): Shares {
  const det = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
  const ra = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / det;
  const rb = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / det;
  const [a, b, c] = [ra, rb, 1 - ra - rb].map((n) => Math.max(0, n));
  const total = a + b + c || 1;
  const r = (n: number) => Math.round((n / total) * 1000) / 1000;
  const out = { a: r(a), b: r(b), c: 0 };
  out.c = Math.round((1 - out.a - out.b) * 1000) / 1000;
  return out;
}

export const pointOf = (s: Shares) => ({ x: s.a * A.x + s.b * B.x + s.c * C.x, y: s.a * A.y + s.b * B.y + s.c * C.y });

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** "Mostly Habit (60%), then People and connection (30%) and Boredom or stress (10%)." */
export function sharesInWords(s: Shares, corners: readonly string[]): string {
  const parts = [s.a, s.b, s.c].map((v, i) => ({ v, name: corners[i] })).sort((x, y) => y.v - x.v);
  if (parts[0].v - parts[2].v < 0.1) return `About equally ${corners.join(', ')}.`;
  return `Mostly ${parts[0].name} (${pct(parts[0].v)}), then ${parts[1].name} (${pct(parts[1].v)}) and ${parts[2].name} (${pct(parts[2].v)}).`;
}

interface TriadProps {
  id: string;
  question: string;
  corners: readonly [string, string, string] | readonly string[];
  value: Shares | 'na' | null;
  onChange: (value: Shares | 'na' | null) => void;
}

export function Triad({ id, question, corners, value, onChange }: TriadProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const shares = value && value !== 'na' ? value : null;
  const dot = pointOf(shares ?? CENTRE);

  const place = (clientX: number, clientY: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    onChange(sharesAt(((clientX - box.left) / box.width) * W, ((clientY - box.top) / box.height) * H));
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    place(e.clientX, e.clientY);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging.current) place(e.clientX, e.clientY);
  };
  const up = () => {
    dragging.current = false;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 24 : 8;
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    if (e.key === 'Home') {
      e.preventDefault();
      onChange(CENTRE);
      return;
    }
    const d = moves[e.key];
    if (!d) return;
    e.preventDefault();
    const p = pointOf(shares ?? CENTRE);
    onChange(sharesAt(p.x + d[0], p.y + d[1]));
  };

  const words = shares ? sharesInWords(shares, corners) : value === 'na' ? 'Not sure, or it does not apply.' : 'Not answered yet.';
  return (
    <fieldset className={`mpmb-triad${value === 'na' ? ' is-na' : ''}`}>
      <legend className="mpmb-choice__legend">{question}</legend>
      <p className="mpmb-hint" id={`${id}-hint`}>
        Tap or drag the dot to where your story fits: close to a corner if it was mostly that, in the middle if it was all three. With a keyboard, use the arrow keys.
      </p>
      <div className="mpmb-triad__area">
        {corners.slice(0, 3).map((c, i) => (
          <span key={c} className={`mpmb-triad__corner mpmb-triad__corner--${'abc'[i]}`} aria-hidden="true">
            {c}
            {shares && <strong> {pct([shares.a, shares.b, shares.c][i])}</strong>}
          </span>
        ))}
        <div id={id} className="mpmb-triad__pad" role="application" aria-roledescription="triangle" aria-label={`${question} ${corners.join(', ')}`} aria-describedby={`${id}-hint ${id}-value`} tabIndex={0} onKeyDown={key}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="mpmb-triad__svg" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true" focusable="false">
            <polygon points={`${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`} className="mpmb-triad__shape" />
            <polyline points={`${(A.x + B.x) / 2},${(A.y + B.y) / 2} ${(B.x + C.x) / 2},${(B.y + C.y) / 2} ${(A.x + C.x) / 2},${(A.y + C.y) / 2} ${(A.x + B.x) / 2},${(A.y + B.y) / 2}`} className="mpmb-triad__guide" />
            {value !== 'na' && <circle cx={dot.x} cy={dot.y} r={shares ? 11 : 9} className={`mpmb-triad__dot${shares ? '' : ' is-unset'}`} />}
          </svg>
        </div>
      </div>
      <p className="mpmb-triad__value" id={`${id}-value`} aria-live="polite">
        {words}
      </p>
      <label className="mpmb-notsure">
        <input type="checkbox" checked={value === 'na'} onChange={(e) => onChange(e.target.checked ? 'na' : null)} /> Not sure, or it doesn’t apply
      </label>
    </fieldset>
  );
}

interface DyadProps {
  id: string;
  question: string;
  left: string;
  right: string;
  value: number | 'na' | null;
  onChange: (value: number | 'na' | null) => void;
}

const dyadWords = (v: number, left: string, right: string) => (v < 40 ? `Towards “${left}”` : v > 60 ? `Towards “${right}”` : 'In the middle');

export function Dyad({ id, question, left, right, value, onChange }: DyadProps) {
  const set = typeof value === 'number';
  const current = set ? value : 50;
  // A first touch or key press on the untouched slider counts as an answer, even at the middle.
  const claim = (v: number) => {
    if (!set) onChange(v);
  };
  return (
    <fieldset className={`mpmb-dyad${value === 'na' ? ' is-na' : ''}`}>
      <legend className="mpmb-choice__legend" id={`${id}-legend`}>
        {question}
      </legend>
      <div className="mpmb-dyad__ends" aria-hidden="true">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={current}
        disabled={value === 'na'}
        className={`mpmb-dyad__range${set ? '' : ' is-unset'}`}
        aria-labelledby={`${id}-legend`}
        aria-valuetext={set ? `${dyadWords(current, left, right)}, ${current} of 100, from ${left} to ${right}` : `Not answered yet. From ${left} to ${right}.`}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => claim(Number(e.currentTarget.value))}
        onKeyUp={(e) => claim(Number(e.currentTarget.value))}
      />
      <p className="mpmb-hint mpmb-dyad__value">{set ? dyadWords(current, left, right) : value === 'na' ? 'Not sure, or it does not apply.' : 'Not answered yet: slide or tap the line.'}</p>
      <label className="mpmb-notsure">
        <input type="checkbox" checked={value === 'na'} onChange={(e) => onChange(e.target.checked ? 'na' : null)} /> Not sure, or it doesn’t apply
      </label>
    </fieldset>
  );
}
