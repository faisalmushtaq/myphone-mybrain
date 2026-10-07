import { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { announce } from '../../lib/announce';
import { NyDraft, NyShell } from '../NyShell';
import { clearNyState } from '../persistence';
import { useNy } from '../store';

/** Leave or start again: everything is deleted from this device, after a confirm step. */
export function Leave() {
  const { state, dispatch } = useNy();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const ask = () => {
    setConfirming(true);
    window.setTimeout(() => confirmRef.current?.focus(), 0);
  };
  const cancel = () => {
    setConfirming(false);
    window.setTimeout(() => actionsRef.current?.querySelector('button')?.focus(), 0);
  };
  const remove = () => {
    clearNyState();
    dispatch({ type: 'delete-all' });
    announce('Everything has been deleted from this device.');
  };

  return (
    <NyShell kicker="Leave or start again" title="Leave or start again." intro={<p>You can stop at any time, for any reason.</p>}>
      <ul className="mpmb-list" role="list">
        <li>Deleting removes your fun name, check-ins and brain check scores from this device. It can’t be undone.</li>
        <li>To start again, delete everything, then join again with new choices.</li>
        <li>
          In the real study you could also ask the research team to remove what you had sent. <NyDraft />
        </li>
      </ul>
      {!confirming ? (
        <div className="mpmb-actions" ref={actionsRef}>
          <Button variant="danger" onClick={ask}>
            Delete everything on this device
          </Button>
          <Button variant="ghost" onClick={() => dispatch({ type: 'go', route: { view: 'tracker' } })}>
            Back to my tracker
          </Button>
        </div>
      ) : (
        <div className="ny-confirm" ref={confirmRef} tabIndex={-1} role="group" aria-labelledby="ny-confirm-title" aria-describedby="ny-confirm-body">
          <Callout tone="warning">
            <p className="mpmb-callout__title" id="ny-confirm-title">
              Delete everything for {state.participant?.name ?? 'you'}?
            </p>
            <p id="ny-confirm-body">Your check-ins and brain check scores will be gone for good.</p>
            <div className="mpmb-callout__actions">
              <Button variant="danger" onClick={remove}>
                Yes, delete everything
              </Button>
              <Button variant="secondary" onClick={cancel}>
                No, keep it
              </Button>
            </div>
          </Callout>
        </div>
      )}
    </NyShell>
  );
}
