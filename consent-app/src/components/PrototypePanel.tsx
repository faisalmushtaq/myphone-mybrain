import { useState } from 'react';
import { backendName } from '../api';
import { buildJourney, stepDefs } from '../model/journey';
import type { StepId } from '../model/types';
import { useStore } from '../state/context';
import { clearState } from '../state/persistence';

/**
 * Design-review controls. Lets reviewers simulate failures, jump between
 * steps and toggle the draft-wording markers. Not part of the production UI.
 */
export function PrototypePanel() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const journey = buildJourney(state);
  // On the live site the form sends to the real backend, where the failure switches have no effect.
  const live = backendName() === 'firebase';

  return (
    <div className={`mpmb-proto${open ? ' is-open' : ''}`}>
      <button type="button" className="mpmb-proto__toggle" aria-expanded={open} aria-controls="mpmb-proto-panel" onClick={() => setOpen((o) => !o)} aria-label="Prototype controls">
        {open ? 'Close' : 'Prototype'}
      </button>
      {open && (
        <div className="mpmb-proto__panel" id="mpmb-proto-panel">
          {live ? (
            <p className="mpmb-proto__note">Review controls. This form is connected to the study’s real system: whatever is sent from it is stored.</p>
          ) : (
            <>
              <p className="mpmb-proto__note">Nothing is sent anywhere in this preview. Use these switches to see the error states.</p>
              <label className="mpmb-proto__row">
                <input type="checkbox" checked={state.prototype.failUploads} onChange={(e) => dispatch({ type: 'prototype', patch: { failUploads: e.target.checked } })} />
                Make image uploads fail
              </label>
              <label className="mpmb-proto__row">
                <input type="checkbox" checked={state.prototype.failSubmit} onChange={(e) => dispatch({ type: 'prototype', patch: { failSubmit: e.target.checked } })} />
                Make the final send fail
              </label>
            </>
          )}
          <label className="mpmb-proto__row">
            <input type="checkbox" checked={state.prototype.showDraftMarkers} onChange={(e) => dispatch({ type: 'prototype', patch: { showDraftMarkers: e.target.checked } })} />
            Show “draft wording” markers
          </label>
          <label className="mpmb-proto__row mpmb-proto__row--select">
            Jump to step
            <select value={state.stepId} onChange={(e) => dispatch({ type: 'go-to', stepId: e.target.value as StepId, returnTo: null })}>
              {journey.map((s) => (
                <option key={s} value={s}>
                  {stepDefs[s].title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mpmb-proto__reset"
            onClick={() => {
              clearState();
              dispatch({ type: 'reset' });
              setOpen(false);
            }}
          >
            Reset everything
          </button>
        </div>
      )}
    </div>
  );
}
