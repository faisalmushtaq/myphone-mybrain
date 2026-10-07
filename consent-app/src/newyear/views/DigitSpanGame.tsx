import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { announce } from '../../lib/announce';
import type { DigitSpanResult } from '../model';
import { mulberry32, randomSeed } from '../rng';
import { DIGIT_SPAN, isCorrectRecall, makeDigitSequence, recordSpanTrial, spanScore, startSpan } from '../tasks/digitSpan';

/**
 * Shows the digits one at a time: a fixation cross, then each digit for
 * 800 ms with a 200 ms gap. Onsets are driven by requestAnimationFrame and
 * measured with its timestamps (performance.now()'s clock), writing straight
 * to the element rather than through React, so each change lands on the next
 * frame. Browser timing is approximate: every on and off time is rounded to
 * the screen's frames, so about ±1 frame (17 ms at 60 Hz).
 */
function DigitStream({ sequence, onDone, onInterrupt }: { sequence: number[]; onDone: () => void; onInterrupt: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  const interrupt = useRef(onInterrupt);
  done.current = onDone;
  interrupt.current = onInterrupt;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const per = DIGIT_SPAN.onMs + DIGIT_SPAN.offMs;
    const total = DIGIT_SPAN.leadInMs + sequence.length * per;
    let start: number | null = null;
    let shown = '';
    let raf = 0;
    let stopped = false;
    const tick = (ts: number) => {
      if (stopped) return;
      if (start === null) start = ts;
      const t = ts - start;
      let text = '';
      let state = 'blank';
      if (t < DIGIT_SPAN.leadInMs) {
        text = '+';
        state = 'fix';
      } else {
        const k = Math.floor((t - DIGIT_SPAN.leadInMs) / per);
        if (k < sequence.length && t - DIGIT_SPAN.leadInMs - k * per < DIGIT_SPAN.onMs) {
          text = String(sequence[k]);
          state = 'digit';
        }
      }
      if (`${state}${text}` !== shown) {
        el.textContent = text;
        el.dataset.state = state;
        shown = `${state}${text}`;
      }
      if (t >= total) {
        stopped = true;
        done.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onVisibility = () => {
      if (!document.hidden || stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      interrupt.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sequence]);

  return <div className="ny-digit" ref={ref} aria-hidden="true" data-state="blank" />;
}

function Keypad({ typed, onDigit, onDelete, onDone }: { typed: number[]; onDigit: (d: number) => void; onDelete: () => void; onDone: () => void }) {
  return (
    <div className="ny-keypad">
      <p className="ny-keypad__display" aria-live="polite" aria-atomic="true">
        <span className="mpmb-sr-only">Your answer: </span>
        {typed.length ? (
          typed.join(' ')
        ) : (
          <>
            <span className="mpmb-sr-only">nothing yet</span>
            <span className="ny-keypad__placeholder" aria-hidden="true">
              Tap the digits
            </span>
          </>
        )}
      </p>
      <div className="ny-keypad__keys" role="group" aria-label="Keypad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} type="button" className="ny-key" onClick={() => onDigit(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="ny-key ny-key--del" onClick={onDelete} aria-label="Delete the last digit">
          <span aria-hidden="true">⌫</span> Delete
        </button>
        <button type="button" className="ny-key ny-key--done" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="mpmb-hint ny-keypad__hint">On a keyboard: type the digits, Backspace to delete, Enter when done.</p>
    </div>
  );
}

type Phase =
  | { kind: 'intro' }
  | { kind: 'show'; practice: boolean; sequence: number[] }
  | { kind: 'answer'; practice: boolean; sequence: number[]; since: number }
  | { kind: 'practice-result'; correct: boolean; sequence: number[] }
  | { kind: 'next' }
  | { kind: 'paused'; practice: boolean };

interface Props {
  onDone: (result: DigitSpanResult) => void;
  onQuit: () => void;
}

/** The memory game: forward digit span, with one practice trial that does not count. */
export function DigitSpanGame({ onDone, onQuit }: Props) {
  const seed = useRef(randomSeed());
  const rng = useRef(mulberry32(seed.current));
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [progress, setProgress] = useState(startSpan);
  const [typed, setTyped] = useState<number[]>([]);
  const practiceCorrect = useRef(false);
  const startedAt = useRef<string | null>(null);
  const nextRef = useRef<HTMLDivElement>(null);
  /** Set once an answer is sent, so a double tap on Done (or a held Enter) cannot record it twice. */
  const answered = useRef(false);

  const begin = (practice: boolean) => {
    const length = practice ? DIGIT_SPAN.practiceLength : progress.length;
    startedAt.current ??= new Date().toISOString();
    setTyped([]);
    setPhase({ kind: 'show', practice, sequence: makeDigitSequence(length, rng.current) });
    announce(practice ? 'Practice. Watch the 2 digits.' : `Watch the ${length} digits.`);
  };

  const shown = () => {
    answered.current = false;
    setPhase((p) => (p.kind === 'show' ? { kind: 'answer', practice: p.practice, sequence: p.sequence, since: performance.now() } : p));
    announce('Now type the digits in the same order, then press Done.');
  };

  const answerLength = phase.kind === 'answer' ? phase.sequence.length : 0;
  const addDigit = (d: number) => setTyped((now) => (now.length < answerLength ? [...now, d] : now));
  const deleteDigit = () => setTyped((now) => now.slice(0, -1));

  const submit = () => {
    if (phase.kind !== 'answer' || answered.current) return;
    answered.current = true;
    if (phase.practice) {
      const correct = isCorrectRecall(phase.sequence, typed);
      practiceCorrect.current = correct;
      setPhase({ kind: 'practice-result', correct, sequence: phase.sequence });
      announce(correct ? 'Right.' : `Not quite. The digits were ${phase.sequence.join(' ')}.`);
      return;
    }
    const next = recordSpanTrial(progress, typed, phase.sequence, Math.round(performance.now() - phase.since));
    setProgress(next);
    if (next.finished) {
      onDone({ score: spanScore(next.trials), trials: next.trials, practiceCorrect: practiceCorrect.current, seed: seed.current, startedAt: startedAt.current ?? new Date().toISOString(), finishedAt: new Date().toISOString() });
      return;
    }
    setPhase({ kind: 'next' });
  };

  // Typing on a keyboard while the keypad is up. Enter on a focused key presses that key, as usual.
  useEffect(() => {
    if (phase.kind !== 'answer') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        addDigit(Number(e.key));
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteDigit();
      } else if (e.key === 'Enter' && target?.tagName !== 'BUTTON') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (phase.kind === 'next') nextRef.current?.querySelector('button')?.focus();
  }, [phase.kind]);

  const trialNumber = progress.trials.length + 1;

  if (phase.kind === 'intro') {
    return (
      <div className="ny-game">
        <h2 className="mpmb-h3">How it works</h2>
        <ol className="ny-howto" role="list">
          <li>Digits appear one at a time in the middle of the screen.</li>
          <li>When they stop, tap them in the same order, then press Done.</li>
          <li>It starts with 3 digits and gets longer. It stops when two in a row at the same length are wrong.</li>
        </ol>
        <p>First, a quick practice with 2 digits. It doesn’t count.</p>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => begin(true)}>
            Start the practice
          </Button>
          <Button variant="ghost" onClick={onQuit}>
            Not now
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'practice-result') {
    return (
      <div className="ny-game">
        <h2 className="mpmb-h2">{phase.correct ? 'Right!' : 'Not quite.'}</h2>
        <p>{phase.correct ? 'That’s how it works. Now the real thing, starting with 3 digits.' : `The digits were ${phase.sequence.join(' ')}. You can try the practice again, or start the real thing.`}</p>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => begin(false)}>
            Start the memory game
          </Button>
          <Button variant="secondary" onClick={() => begin(true)}>
            Practise again
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'next') {
    return (
      <div className="ny-game">
        <p className="ny-game__meta">
          Round {trialNumber} · {progress.length} digits
        </p>
        <h2 className="mpmb-h2">Ready for the next one?</h2>
        <p>Next: {progress.length} digits.</p>
        <div className="mpmb-actions" ref={nextRef}>
          <Button variant="primary" arrow onClick={() => begin(false)}>
            Next
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'paused') {
    return (
      <div className="ny-game">
        <h2 className="mpmb-h2">Paused.</h2>
        <p>The page went out of view while the digits were showing, so that round won’t count. You’ll get a new set of digits.</p>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => begin(phase.practice)}>
            Carry on
          </Button>
        </div>
      </div>
    );
  }

  const practice = phase.practice;
  return (
    <div className="ny-game">
      <p className="ny-game__meta">{practice ? 'Practice · 2 digits' : `Round ${trialNumber} · ${phase.sequence.length} digits`}</p>
      {phase.kind === 'show' ? (
        <>
          <p className="ny-game__prompt">Watch the digits.</p>
          <div className="ny-screen">
            <DigitStream sequence={phase.sequence} onDone={shown} onInterrupt={() => setPhase({ kind: 'paused', practice })} />
          </div>
        </>
      ) : (
        <>
          <p className="ny-game__prompt">Type the digits in the order you saw them.</p>
          <Keypad typed={typed} onDigit={addDigit} onDelete={deleteDigit} onDone={submit} />
        </>
      )}
    </div>
  );
}
