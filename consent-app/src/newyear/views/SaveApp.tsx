import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { canInstall, installApp, isAndroid, isIos, isMacSafari, isStandalone, notifyState, onInstallOffer, turnOnNotifications, type NotifyState } from '../install';

const NOTIFY_TEXT: Record<NotifyState, string> = {
  unsupported: 'This browser can’t show notifications. Save the study on your phone instead.',
  'needs-home-screen': 'On an iPhone or iPad, notifications only work once the study is saved to your Home Screen and opened from there.',
  default: '',
  denied: 'Notifications are blocked for this site. You can allow them in your phone’s settings for this app or browser.',
  granted: 'Reminders are on for this device. We sent a test notification.',
};

/**
 * "Save it to your phone": steps for the device in hand, a one-tap install
 * where the browser offers one, then turning on notifications. Used as a step
 * of joining and on the settings page, and as a reminder card on the tracker
 * until it is done.
 */
export function SaveApp({ compact = false }: { compact?: boolean }) {
  const [installable, setInstallable] = useState(canInstall);
  const [installed, setInstalled] = useState<string | null>(null);
  const [notify, setNotify] = useState<NotifyState>(notifyState);
  const [busy, setBusy] = useState(false);
  useEffect(() => onInstallOffer(() => setInstallable(canInstall())), []);
  const ios = isIos();
  const android = isAndroid();
  const computer = !ios && !android;
  const standalone = isStandalone();

  const turnOn = async () => {
    setBusy(true);
    try {
      setNotify(await turnOnNotifications());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ny-saveapp">
      {standalone ? (
        <p>
          <strong>You’re using the study as an app.</strong> Open it from its icon each time.
        </p>
      ) : (
        <>
          {!compact && <p>Save the study to your phone’s Home Screen. It then opens like an app, keeps you signed in, and can remind you to check in. Without it, an iPhone can’t show you reminders.</p>}
          {installable && (
            <div className="mpmb-actions">
              <Button variant="primary" onClick={() => void installApp().then((ok) => setInstalled(ok ? 'Saved. Open it from its new icon from now on.' : null))}>
                Save it as an app
              </Button>
            </div>
          )}
          {installed && <p role="status">{installed}</p>}
          {ios && (
            <ol className="mpmb-list">
              <li>Open myphonemybrain.com/new-year in Safari.</li>
              <li>
                Tap the Share button <span aria-hidden="true">(the square with an arrow pointing up)</span>, scroll down, then tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
              </li>
              <li>Open the study from the new MyPhone/MyBrain icon, then turn on reminders below.</li>
            </ol>
          )}
          {android && (
            <ol className="mpmb-list">
              <li>Open myphonemybrain.com/new-year in Chrome.</li>
              <li>
                {installable ? 'Tap Save it as an app above, or tap' : 'Tap'} the menu <span aria-hidden="true">(the three dots at the top right)</span>, then <strong>Install app</strong> or <strong>Add to Home screen</strong>.
              </li>
              <li>Open the study from the new icon, then turn on reminders below.</li>
            </ol>
          )}
          {computer && (
            <>
              <p>
                <strong>Best on your phone.</strong> Open <strong>myphonemybrain.com/new-year</strong> on your phone, sign in with the same email and password, and save it there. That’s where reminders are most useful.
              </p>
              {isMacSafari() ? <p className="mpmb-hint">To keep it on this Mac too: in Safari, choose File, then Add to Dock.</p> : <p className="mpmb-hint">To keep it on this computer too: in Chrome or Edge, use the install icon at the right of the address bar.</p>}
            </>
          )}
        </>
      )}
      <h3 className="mpmb-label">Reminders on this device</h3>
      {notify === 'default' ? (
        <div className="mpmb-actions">
          <Button variant={standalone ? 'primary' : 'secondary'} loading={busy} onClick={() => void turnOn()}>
            Turn on reminders
          </Button>
        </div>
      ) : (
        <Callout tone={notify === 'granted' ? 'success' : 'info'} role="status">
          <p>{NOTIFY_TEXT[notify]}</p>
        </Callout>
      )}
      <p className="mpmb-hint">Preview: the test notification comes from this device. In the real study, reminders come from the research team’s server, at the times you choose.</p>
    </div>
  );
}
