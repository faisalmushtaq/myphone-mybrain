import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { announce } from '../../lib/announce';
import type { OddballResult, OddballTiming } from '../model';
import { mulberry32, randomSeed } from '../rng';
import { expectedDurationMs, makeOddballSequence, ODDBALL_MAIN, ODDBALL_PRACTICE, practiceFeedback, scoreOddball, trialOutcome, withOutcomes, type OddballScores, type OddballSettings, type OddballTrialPlan, type OddballTrialRecord } from '../tasks/oddball';

type StopReason = 'hidden' | 'escape' | 'button';
type Input = OddballResult['input'];

/** When an input event happened, on performance.now()'s clock (the same one as requestAnimationFrame's timestamps). */
function eventTime(e: { timeStamp: number }): number {
  const now = performance.now();
  return e.timeStamp > 0 && e.timeStamp <= now + 1 ? e.timeStamp : now;
}

interface BlockProps {
  settings: OddballSettings;
  plan: OddballTrialPlan[];
  onFinish: (records: OddballTrialRecord[], timing: OddballTiming, input: Input) => void;
  onStop: (reason: StopReason) => void;
}

/**
 * One block of the oddball: runs the schedule frame by frame and records every
 * press against the shape it followed.
 *
 * Timing: each phase (shape, fixation, practice feedback) starts on an
 * animation frame and lasts until the first frame at or after its end, so
 * durations are right to about ±1 frame (17 ms at 60 Hz). Onsets are the
 * frame's requestAnimationFrame timestamp and presses use the input event's
 * timestamp, on the same clock; the shape reaches the screen at the next
 * refresh, so reaction times include about one frame of display delay. This
 * is browser timing: approximate, but the same on every check, which is what
 * the comparisons need. The longest gap between frames is kept with the
 * results, to spot a device that was struggling.
 *
 * The shapes are switched by setting an attribute directly on the element,
 * not through React, so nothing waits for a render.
 */
function OddballBlock({ settings, plan, onFinish, onStop }: BlockProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const respondRef = useRef<(time: number, how: 'touch' | 'key') => void>(() => undefined);
  const stopRef = useRef<(reason: StopReason) => void>(() => undefined);
  const finishCb = useRef(onFinish);
  const stopCb = useRef(onStop);
  finishCb.current = onFinish;
  stopCb.current = onStop;
  const [count, setCount] = useState(0);
  const practice = settings.feedbackMs > 0;

  useEffect(() => {
    const stage = stageRef.current;
    const feedback = feedbackRef.current;
    if (!stage || !feedback) return;
    regionRef.current?.focus({ preventScroll: true });

    const records: OddballTrialRecord[] = plan.map((p) => ({ type: p.type, itiMs: p.itiMs, onsetMs: null, presses: [] }));
    const onsets: number[] = [];
    let open = -1;
    let origin: number | null = null;
    let phase: 'lead' | 'stim' | 'iti' | 'feedback' = 'lead';
    let i = -1;
    let phaseEnd = 0;
    let raf = 0;
    let lastFrame = 0;
    let maxGap = 0;
    let longFrames = 0;
    let touches = 0;
    let keys = 0;
    let finished = false;

    const show = (what: string) => {
      stage.dataset.show = what;
    };
    const startTrial = (n: number, t: number, ts: number) => {
      i = n;
      phase = 'stim';
      show(plan[n].type);
      onsets[n] = ts;
      records[n].onsetMs = Math.round(t);
      open = n;
      phaseEnd = t + settings.stimulusMs;
      setCount(n + 1);
      if (!practice && (n + 1) % 25 === 0 && n + 1 < plan.length) announce(`${n + 1} of ${plan.length} shapes done.`);
    };
    const finish = () => {
      finished = true;
      open = -1;
      show('end');
      finishCb.current(records, { maxFrameGapMs: Math.round(maxGap), longFrames }, touches && keys ? 'mixed' : touches ? 'touch' : keys ? 'keyboard' : 'none');
    };
    const stop = (reason: StopReason) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      stopCb.current(reason);
    };

    // One change of phase per frame at most, timed from that frame, so a shape is never skipped after a stall.
    const tick = (ts: number) => {
      if (finished) return;
      if (origin === null) {
        origin = ts;
        lastFrame = ts;
        phaseEnd = settings.leadInMs;
        show('fix');
      }
      const gap = ts - lastFrame;
      lastFrame = ts;
      if (gap > maxGap) maxGap = gap;
      if (gap > 50) longFrames += 1;
      const t = ts - origin;
      if (t >= phaseEnd) {
        if (phase === 'lead') startTrial(0, t, ts);
        else if (phase === 'stim') {
          phase = 'iti';
          show('fix');
          phaseEnd = t + plan[i].itiMs;
        } else if (phase === 'iti') {
          if (practice) {
            open = -1;
            phase = 'feedback';
            const fb = practiceFeedback(trialOutcome(records[i]));
            feedback.textContent = fb.text;
            show(fb.ok ? 'good' : 'oops');
            phaseEnd = t + settings.feedbackMs;
          } else if (i + 1 < plan.length) startTrial(i + 1, t, ts);
          else finish();
        } else {
          feedback.textContent = '';
          if (i + 1 < plan.length) startTrial(i + 1, t, ts);
          else finish();
        }
      }
      if (!finished) raf = requestAnimationFrame(tick);
    };

    respondRef.current = (time, how) => {
      if (finished || open < 0) return;
      // The press belongs to the latest shape that appeared before it happened.
      let n = open;
      while (n > 0 && onsets[n] > time) n -= 1;
      if (onsets[n] === undefined || onsets[n] > time) return;
      if (practice && n !== open) return;
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
        // Also stops the page scrolling and any focused button reacting.
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
    };
  }, [plan, settings, practice]);

  return (
    <div className="ny-block" ref={regionRef} tabIndex={-1} role="group" aria-label={`${practice ? 'Practice' : 'Attention game'}. Tap the button or press the space bar for orange squares only. Escape stops.`}>
      <div className="ny-block__meta">
        <span aria-hidden="true">{practice ? `Practice: ${count} of ${plan.length}` : `Shape ${count} of ${plan.length}`}</span>
        <button type="button" className="ny-block__stop" onClick={() => stopRef.current('button')}>
          Stop
        </button>
      </div>
      <div className="ny-block__bar" aria-hidden="true">
        <span style={{ width: `${(count / plan.length) * 100}%` }} />
      </div>
      <div className="ny-arena" ref={stageRef} data-show="blank">
        <span className="ny-fix" aria-hidden="true" />
        <span className="ny-shape ny-shape--standard" aria-hidden="true" />
        <span className="ny-shape ny-shape--target" aria-hidden="true" />
        <p className="ny-feedback" ref={feedbackRef} role="status" />
      </div>
      <button
        type="button"
        className="ny-tap"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          respondRef.current(eventTime(e), 'touch');
        }}
        onClick={(e) => {
          // Enter, or a screen reader's "click": counts as a press. Taps were already counted on pointer down.
          if (e.detail === 0) respondRef.current(performance.now(), 'key');
        }}
      >
        Tap!
      </button>
      <p className="mpmb-hint ny-block__hint">Orange square: tap. Blue circle: do nothing. On a keyboard, use the space bar.</p>
    </div>
  );
}

function Shapes() {
  return (
    <ul className="ny-legend-shapes" role="list">
      <li>
        <span className="ny-mini ny-mini--target" aria-hidden="true" />
        <span>
          <strong>Orange square: tap!</strong> This is the target. It comes up now and then.
        </span>
      </li>
      <li>
        <span className="ny-mini ny-mini--standard" aria-hidden="true" />
        <span>
          <strong>Blue circle: do nothing.</strong> Most shapes are these.
        </span>
      </li>
    </ul>
  );
}

type Phase =
  | { kind: 'intro' }
  | { kind: 'practice'; plan: OddballTrialPlan[] }
  | { kind: 'practice-done'; scores: OddballScores }
  | { kind: 'main'; plan: OddballTrialPlan[]; seed: number; startedAt: string }
  | { kind: 'stopped'; reason: StopReason; practice: boolean };

interface Props {
  onDone: (result: OddballResult) => void;
  onQuit: () => void;
}

/** The attention game: a visual oddball, with a short practice that does not count. */
export function OddballGame({ onDone, onQuit }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [run, setRun] = useState(0);
  const minutes = Math.round(expectedDurationMs(ODDBALL_MAIN) / 60_000);

  const startPractice = () => {
    setRun((r) => r + 1);
    setPhase({ kind: 'practice', plan: makeOddballSequence(ODDBALL_PRACTICE, mulberry32(randomSeed())) });
    announce('Practice starting. Watch the middle of the screen.');
  };
  const startMain = () => {
    const seed = randomSeed();
    setRun((r) => r + 1);
    setPhase({ kind: 'main', plan: makeOddballSequence(ODDBALL_MAIN, mulberry32(seed)), seed, startedAt: new Date().toISOString() });
    announce('The attention game is starting. Watch the middle of the screen.');
  };

  if (phase.kind === 'practice') {
    return (
      <div className="ny-game">
        <OddballBlock
          key={run}
          settings={ODDBALL_PRACTICE}
          plan={phase.plan}
          onFinish={(records) => {
            const scores = scoreOddball(records);
            setPhase({ kind: 'practice-done', scores });
            announce(`Practice done. You spotted ${scores.hits} of ${scores.targets} orange squares.`);
          }}
          onStop={(reason) => setPhase({ kind: 'stopped', reason, practice: true })}
        />
      </div>
    );
  }

  if (phase.kind === 'main') {
    const { plan, seed, startedAt } = phase;
    return (
      <div className="ny-game">
        <OddballBlock
          key={run}
          settings={ODDBALL_MAIN}
          plan={plan}
          onFinish={(records, timing, input) =>
            onDone({
              scores: scoreOddball(records),
              trials: withOutcomes(records),
              seed,
              settings: { trials: ODDBALL_MAIN.trials, stimulusMs: ODDBALL_MAIN.stimulusMs, itiMinMs: ODDBALL_MAIN.itiMinMs, itiMaxMs: ODDBALL_MAIN.itiMaxMs },
              timing,
              input,
              startedAt,
              finishedAt: new Date().toISOString(),
            })
          }
          onStop={(reason) => setPhase({ kind: 'stopped', reason, practice: false })}
        />
      </div>
    );
  }

  if (phase.kind === 'practice-done') {
    const { hits, targets, falseAlarms } = phase.scores;
    return (
      <div className="ny-game">
        <h2 className="mpmb-h2">Practice done.</h2>
        <p>
          You spotted {hits} of {targets} orange squares{falseAlarms ? `, and tapped ${falseAlarms === 1 ? 'once' : `${falseAlarms} times`} for a blue circle` : ''}. The real game has 100 shapes and no messages along the way. It takes about {minutes} minutes.
        </p>
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
        <p>{phase.reason === 'hidden' ? 'The game stopped because the page went out of view: shapes can’t be timed while it is hidden.' : 'You stopped the game.'} Nothing from that round is kept.</p>
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
      <p>Shapes appear one at a time in the middle of the screen. Each one is only there for half a second.</p>
      <Shapes />
      <p>Tap the big button, or press the space bar if you’re on a keyboard. Be quick, but try not to tap for blue circles.</p>
      <p>First, a practice of 10 shapes with tips along the way. Then the real game: 100 shapes, about {minutes} minutes. Escape or the Stop button stops it.</p>
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
