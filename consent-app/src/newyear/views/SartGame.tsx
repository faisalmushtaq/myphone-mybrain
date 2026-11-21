import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { announce } from '../../lib/announce';
import { FullScreen } from './FullScreen';
import type { SartResult } from '../model';
import { mulberry32, randomSeed } from '../rng';
import { makeSartSequence, NO_GO_DIGIT, sartDurationMs, SART_MAIN, SART_PRACTICE, scoreSart, withSartOutcomes, type SartScores, type SartSettings, type SartTrialPlan, type SartTrialRecord } from '../tasks/sart';

type StopReason = 'hidden' | 'escape' | 'button';
type Input = SartResult['input'];

/** When an input event happened, on performance.now()'s clock (the same one as requestAnimationFrame's timestamps). */
function eventTime(e: { timeStamp: number }): number {
  const now = performance.now();
  return e.timeStamp > 0 && e.timeStamp <= now + 1 ? e.timeStamp : now;
}

/** Points to CSS pixels, scaled down only on a very short screen (a phone on its side). */
function sizePx(pt: number): number {
  const scale = Math.min(1, (window.innerHeight || 600) / 420);
  return Math.round(((pt * 4) / 3) * scale);
}

interface BlockProps {
  settings: SartSettings;
  plan: SartTrialPlan[];
  onFinish: (records: SartTrialRecord[], timing: { maxFrameGapMs: number; longFrames: number }, input: Input) => void;
  onStop: (reason: StopReason) => void;
}

/**
 * One block, full screen: a black page with only the digit or the mask on it.
 * The whole screen is the response area (or the space bar); Escape, or the
 * small cross in the corner, stops it.
 *
 * Timing as in the old attention game: each phase starts on an animation
 * frame and lasts until the first frame at or after its end (about ±1 frame);
 * onsets are frame timestamps and responses use the event's timestamp on the
 * same clock. The digit and mask are switched directly on the element, not
 * through React, so nothing waits for a render.
 */
function SartBlock({ settings, plan, onFinish, onStop }: BlockProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const digitRef = useRef<HTMLSpanElement>(null);
  const respondRef = useRef<(time: number, how: 'touch' | 'key') => void>(() => undefined);
  const stopRef = useRef<(reason: StopReason) => void>(() => undefined);
  const finishCb = useRef(onFinish);
  const stopCb = useRef(onStop);
  finishCb.current = onFinish;
  stopCb.current = onStop;

  useEffect(() => {
    const root = rootRef.current;
    const digitEl = digitRef.current;
    if (!root || !digitEl) return;
    root.focus({ preventScroll: true });
    // Nothing behind the block scrolls or shows through.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const records: SartTrialRecord[] = plan.map((p) => ({ ...p, onsetMs: null, presses: [] }));
    const onsets: number[] = [];
    let current = -1;
    let origin: number | null = null;
    let phase: 'lead' | 'digit' | 'mask' = 'lead';
    let phaseEnd = 0;
    let raf = 0;
    let lastFrame = 0;
    let maxGap = 0;
    let longFrames = 0;
    let touches = 0;
    let keys = 0;
    let finished = false;

    const show = (what: 'blank' | 'digit' | 'mask') => {
      root.dataset.show = what;
    };
    const startTrial = (n: number, t: number, ts: number) => {
      current = n;
      phase = 'digit';
      digitEl.textContent = String(plan[n].digit);
      digitEl.style.fontSize = `${sizePx(plan[n].sizePt)}px`;
      show('digit');
      onsets[n] = ts;
      records[n].onsetMs = Math.round(t);
      phaseEnd = t + settings.digitMs;
    };
    const finish = () => {
      finished = true;
      current = -1;
      show('blank');
      finishCb.current(records, { maxFrameGapMs: Math.round(maxGap), longFrames }, touches && keys ? 'mixed' : touches ? 'touch' : keys ? 'keyboard' : 'none');
    };
    const stop = (reason: StopReason) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      stopCb.current(reason);
    };

    const tick = (ts: number) => {
      if (finished) return;
      if (origin === null) {
        origin = ts;
        lastFrame = ts;
        phaseEnd = settings.leadInMs;
        show('blank');
      }
      const gap = ts - lastFrame;
      lastFrame = ts;
      if (gap > maxGap) maxGap = gap;
      if (gap > 50) longFrames += 1;
      const t = ts - origin;
      if (t >= phaseEnd) {
        if (phase === 'lead') startTrial(0, t, ts);
        else if (phase === 'digit') {
          phase = 'mask';
          show('mask');
          phaseEnd = t + settings.maskMs;
        } else if (current + 1 < plan.length) startTrial(current + 1, t, ts);
        else finish();
      }
      if (!finished) raf = requestAnimationFrame(tick);
    };

    respondRef.current = (time, how) => {
      if (finished || current < 0) return;
      // The response belongs to the latest digit that appeared before it.
      let n = current;
      while (n > 0 && onsets[n] > time) n -= 1;
      if (onsets[n] === undefined || onsets[n] > time) return;
      records[n].presses.push(Math.round(time - onsets[n]));
      if (how === 'touch') touches += 1;
      else keys += 1;
    };
    stopRef.current = stop;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stop('escape');
      } else if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) respondRef.current(eventTime(e), 'key');
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop('hidden');
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(tick);
    return () => {
      finished = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      document.body.style.overflow = overflow;
    };
  }, [plan, settings]);

  return (
    <FullScreen>
    <div
      className="ny-sart"
      ref={rootRef}
      tabIndex={-1}
      role="application"
      aria-label="The attention game. Tap the screen or press the space bar for every digit except 3. Escape stops."
      data-show="blank"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.ny-sart__stop')) return;
        e.preventDefault();
        respondRef.current(eventTime(e), 'touch');
      }}
    >
      <span className="ny-sart__digit" ref={digitRef} aria-hidden="true" />
      <svg className="ny-sart__mask" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r="44" fill="none" stroke="#fff" strokeWidth="5" />
        <path d="M22 22 78 78M78 22 22 78" stroke="#fff" strokeWidth="5" />
      </svg>
      <button type="button" className="ny-sart__stop" aria-label="Stop the game" onClick={() => stopRef.current('button')}>
        ×
      </button>
    </div>
    </FullScreen>
  );
}

type Phase =
  | { kind: 'intro' }
  | { kind: 'practice'; plan: SartTrialPlan[] }
  | { kind: 'practice-done'; scores: SartScores }
  | { kind: 'main'; plan: SartTrialPlan[]; seed: number; startedAt: string }
  | { kind: 'stopped'; reason: StopReason; practice: boolean };

interface Props {
  onDone: (result: SartResult) => void;
  onQuit: () => void;
}

/** The attention game: the SART, with an 18-digit practice that does not count. */
export function SartGame({ onDone, onQuit }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [run, setRun] = useState(0);
  const minutes = Math.round((sartDurationMs(SART_MAIN) / 60_000) * 2) / 2;

  const startPractice = () => {
    setRun((r) => r + 1);
    setPhase({ kind: 'practice', plan: makeSartSequence(SART_PRACTICE, mulberry32(randomSeed())) });
  };
  const startMain = () => {
    const seed = randomSeed();
    setRun((r) => r + 1);
    setPhase({ kind: 'main', plan: makeSartSequence(SART_MAIN, mulberry32(seed)), seed, startedAt: new Date().toISOString() });
  };

  if (phase.kind === 'practice') {
    return (
      <SartBlock
        key={run}
        settings={SART_PRACTICE}
        plan={phase.plan}
        onFinish={(records) => {
          const scores = scoreSart(records);
          setPhase({ kind: 'practice-done', scores });
          announce('Practice done.');
        }}
        onStop={(reason) => setPhase({ kind: 'stopped', reason, practice: true })}
      />
    );
  }
  if (phase.kind === 'main') {
    const { plan, seed, startedAt } = phase;
    return (
      <SartBlock
        key={run}
        settings={SART_MAIN}
        plan={plan}
        onFinish={(records, timing, input) =>
          onDone({
            task: 'sart',
            version: '1.0',
            scores: scoreSart(records),
            trials: withSartOutcomes(records),
            seed,
            settings: { perDigit: SART_MAIN.perDigit, digitMs: SART_MAIN.digitMs, maskMs: SART_MAIN.maskMs, screen: `${window.innerWidth}x${window.innerHeight}` },
            timing,
            input,
            startedAt,
            finishedAt: new Date().toISOString(),
          })
        }
        onStop={(reason) => setPhase({ kind: 'stopped', reason, practice: false })}
      />
    );
  }
  if (phase.kind === 'practice-done') {
    const s = phase.scores;
    return (
      <div className="ny-game">
        <h2 className="mpmb-h2">Practice done.</h2>
        <p>
          You held back for {s.noGo - s.commissions} of {s.noGo} threes, and tapped for {s.go - s.omissions} of the {s.go} other digits. Most people tap for a 3 now and then: that’s what the game measures.
        </p>
        <p>The real game has 225 digits and takes about {minutes} minutes, without a break. Tap for every digit except 3, as quickly and as accurately as you can.</p>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={startMain}>
            Start the attention game
          </Button>
          <Button variant="secondary" onClick={startPractice}>
            Practise again
          </Button>
        </div>
      </div>
    );
  }
  if (phase.kind === 'stopped') {
    return (
      <div className="ny-game">
        <h2 className="mpmb-h2">Stopped.</h2>
        <p>{phase.reason === 'hidden' ? 'The game stopped because the page went out of view: digits can’t be timed while it is hidden.' : 'You stopped the game.'} Nothing from that round is kept.</p>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={phase.practice ? startPractice : startMain}>
            Start {phase.practice ? 'the practice' : 'the attention game'} again
          </Button>
          <Button variant="ghost" onClick={onQuit}>
            Stop for now
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="ny-game">
      <h2 className="mpmb-h3">How it works</h2>
      <p>Digits from 1 to 9 appear one at a time in the middle of the screen, each followed by a circle with a cross.</p>
      <ul className="ny-points-plain">
        <li>
          <strong>Tap the screen for every digit,</strong> as soon as you see it (or press the space bar on a keyboard).
        </li>
        <li>
          <strong>Except 3: don’t tap for a 3.</strong>
        </li>
        <li>Be as quick and as accurate as you can: both matter equally.</li>
      </ul>
      <p>
        The screen goes black and shows only the digits, so put your phone down on a table or hold it still, and turn on Do Not Disturb. First an 18-digit practice, then the real game: about {minutes} minutes. Escape, or the small × in the corner, stops it.
      </p>
      <div className="mpmb-actions">
        <Button variant="primary" arrow onClick={startPractice}>
          Start the practice
        </Button>
        <Button variant="ghost" onClick={onQuit}>
          Not now
        </Button>
      </div>
    </div>
  );
}

export { NO_GO_DIGIT };
