import { useState } from 'react';
import { actorFor, countedSteps, phases, stepDefs } from '../model/journey';
import type { Actor } from '../model/types';
import { useStore } from '../state/context';
import { clearState } from '../state/persistence';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

function actorLabel(actor: Actor, childName: string): { text: string; icon: string } {
  if (actor === 'parent') return { text: 'Parent or guardian section', icon: 'parent' };
  if (actor === 'young') return { text: childName ? `${childName}’s section` : 'Young person’s section', icon: 'young' };
  return { text: 'Whoever has the phone', icon: 'phone' };
}

/**
 * Persistent, unobtrusive progress: phase labels, "Step n of m", a progress
 * bar, a strip saying who should be holding the device, and a way to clear
 * everything from this device (with an in-page confirmation).
 */
export function ProgressNav() {
  const { state, dispatch } = useStore();
  const [confirming, setConfirming] = useState(false);
  const steps = countedSteps(state);
  const index = steps.indexOf(state.stepId);
  const stepNumber = Math.max(1, index + 1);
  const total = steps.length;
  const currentPhase = stepDefs[state.stepId].phase;
  const currentPhaseIndex = phases.findIndex((p) => p.id === currentPhase);
  const activePhases = new Set(steps.map((s) => stepDefs[s].phase));
  const actor = state.handover ? state.handover.to : actorFor(state.stepId, state);
  const { text, icon } = actorLabel(actor, state.identity.firstName.trim());
  const fraction = total ? Math.max(0.04, stepNumber / total) : 0;

  const clearAll = () => {
    clearState();
    dispatch({ type: 'reset' });
    setConfirming(false);
  };

  return (
    <div className="mpmb-progress" aria-label="Your progress">
      <ol className="mpmb-progress__phases" role="list">
        {phases.map((p, i) => {
          if (!activePhases.has(p.id)) return null;
          const status = i < currentPhaseIndex ? 'done' : i === currentPhaseIndex ? 'current' : 'todo';
          return (
            <li key={p.id} className={`mpmb-progress__phase is-${status}`} aria-current={status === 'current' ? 'step' : undefined}>
              <span className="mpmb-progress__phase-dot" aria-hidden="true" />
              <span className="mpmb-progress__phase-label">{p.label}</span>
            </li>
          );
        })}
      </ol>
      <div className="mpmb-progress__bar" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={stepNumber} aria-valuetext={`Step ${stepNumber} of ${total}: ${stepDefs[state.stepId].title}`}>
        <span className="mpmb-progress__fill" style={{ transform: `scaleX(${fraction})` }} />
      </div>
      <div className="mpmb-progress__meta">
        <span className="mpmb-progress__count">
          Step {stepNumber} of {total}
          {!confirming && (
            <button type="button" className="mpmb-progress__clear" onClick={() => setConfirming(true)} aria-expanded={confirming} aria-controls="mpmb-clear-confirm">
              Clear and start again
            </button>
          )}
        </span>
        <span className={`mpmb-actor mpmb-actor--${actor}`}>
          <Icon name={icon} size={18} />
          {text}
        </span>
      </div>
      {confirming && (
        <div className="mpmb-progress__confirm" id="mpmb-clear-confirm" role="group" aria-label="Clear everything?">
          <p>Clear everything entered on this device and start again? This cannot be undone.</p>
          <div className="mpmb-progress__confirm-actions">
            <Button variant="primary" onClick={clearAll}>
              Yes, clear everything
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} autoFocus>
              Keep going
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
