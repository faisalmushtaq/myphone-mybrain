import { useState, type ReactNode } from 'react';
import { getApi } from '../api';
import type { LabPlatform } from '../api/types';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { announce } from '../lib/announce';
import { describeError, labSession } from './api';
import { platformNames } from './cleaner';
import type { LabArchive } from './model';
import { labPlatforms, platformStatuses, type PlatformStatus } from './reducer';
import { useLab } from './store';

const statusText: Record<PlatformStatus, string> = {
  sent: 'Sent',
  ready: 'Ready to send',
  todo: 'Still to do',
  'not-used': 'You don’t use it',
};

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "TikTok and Instagram": the apps still to do, by name. */
export function namesOf(platforms: LabPlatform[]): string {
  return list(platforms.map((p) => platformNames[p]));
}

interface Props {
  /** Opens the app's download steps (the guide). */
  onHowTo?: (p: LabPlatform) => void;
  /** The files prepared or sent on this device for an app, shown under it. */
  renderFiles?: (files: LabArchive[]) => ReactNode;
  /** Before consent there is nothing to tick: only the download steps are offered. */
  statusless?: boolean;
}

/**
 * Every app the study takes, ticked off once its cleaned data has been sent.
 * The others stay outstanding until they are sent or the person says they do
 * not use the app, which greys it out (and can be undone). The choice is kept
 * on the server, so every device and the team see the same list.
 */
export function PlatformChecklist({ onHowTo, renderFiles, statusless }: Props) {
  const { state, dispatch } = useLab();
  const [saving, setSaving] = useState<LabPlatform | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const statuses = platformStatuses(state);

  const setUse = async (p: LabPlatform, used: boolean) => {
    // One change at a time, so the server always ends up with the last answer given.
    if (saving) return;
    const before = state.notUsed;
    const notUsed = used ? before.filter((x) => x !== p) : Array.from(new Set([...before, p])).sort();
    setProblem(null);
    setSaving(p);
    dispatch({ type: 'not-used', notUsed });
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const result = await getApi().updateLabPlatforms(session, { participantCode: state.code, notUsed });
      dispatch({ type: 'not-used', notUsed: result.notUsed });
      announce(used ? `${platformNames[p]} is back on your list.` : `Noted: you don’t use ${platformNames[p]}.`);
    } catch (error) {
      dispatch({ type: 'not-used', notUsed: before });
      setProblem(describeError(error, 'that change'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mpmb-apps">
      <ul className="mpmb-apps__list" role="list">
        {labPlatforms.map((p) => {
          const status: PlatformStatus = statusless ? 'todo' : statuses[p];
          const name = platformNames[p];
          const files = state.archives.filter((a) => a.platforms.includes(p));
          return (
            <li key={p} className={`mpmb-apps__row is-${status}${statusless ? ' is-plain' : ''}`} data-platform={p}>
              {!statusless && (
                <span className="mpmb-apps__mark" aria-hidden="true">
                  {status === 'sent' ? <Icon name="check" size={18} /> : status === 'not-used' ? '–' : ''}
                </span>
              )}
              <div className="mpmb-apps__body">
                <p className="mpmb-apps__name">
                  <strong>{name}</strong>
                  {!statusless && <span className="mpmb-apps__status">{statusText[status]}</span>}
                </p>
                {renderFiles && files.length > 0 && renderFiles(files)}
                {(onHowTo || (!statusless && (status === 'todo' || status === 'not-used'))) && (
                  <div className="mpmb-apps__actions">
                    {onHowTo && (status === 'todo' || statusless) && (
                      <Button variant="secondary" aria-label={`Show me how to get my ${name} data`} onClick={() => onHowTo(p)}>
                        Show me how
                      </Button>
                    )}
                    {!statusless && status === 'todo' && (
                      <Button variant="link" loading={saving === p} disabled={saving !== null && saving !== p} onClick={() => void setUse(p, false)}>
                        I don’t use {name}
                      </Button>
                    )}
                    {!statusless && status === 'not-used' && (
                      <Button variant="link" loading={saving === p} disabled={saving !== null && saving !== p} onClick={() => void setUse(p, true)}>
                        I do use {name}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {problem && (
        <p className="mpmb-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
