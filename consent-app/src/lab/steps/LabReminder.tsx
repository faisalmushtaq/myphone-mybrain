import { Callout } from '../../components/ui/Callout';
import { Disclosure } from '../../components/ui/Disclosure';
import { formatTimestamp } from '../../lib/dates';
import { labConsentForm, labStudy } from '../config';
import { LabShell } from '../LabShell';
import { nextFilesStep } from '../reducer';
import { useLab } from '../store';
import { filesPhrase } from '../words';

/**
 * The after-break page's light touch: consent was given at the start, so
 * nothing is signed again. The person is reminded what they agreed to, how
 * their data is kept, and how to withdraw, then goes on to their files.
 */
export function LabReminder() {
  const { state, dispatch } = useLab();
  const consentedAt = state.progress?.consentedAt ?? state.submission.consentSentAt;
  const before = state.progress?.phases?.pre;
  const next = nextFilesStep(state);

  return (
    <LabShell
      kicker="After your break"
      title="Before you start: a reminder."
      intro={<p>You gave your consent{consentedAt ? ` on ${formatTimestamp(consentedAt)}` : ' at the start'}, so there is nothing to sign again. Here is what you agreed to, in short.</p>}
      onContinue={() => dispatch({ type: 'go-to', stepId: next })}
      continueLabel={next === 'screenshots' ? 'Continue: my screenshots' : next === 'guide' ? 'Continue: my app data' : next === 'send' ? 'Continue: send my data' : 'Continue'}
      width="wide"
    >
      <ul className="mpmb-list">
        <li>Now that your break is over, we ask for the same two things as before: screenshots of your phone’s screen-time summary, and your own TikTok, YouTube or Instagram data, which you review and clean on your device before anything is sent.</li>
        <li>Everything is labelled with your participant ID, never your name, and kept securely at the University of Leeds.</li>
        <li>What you send is kept and used in the research even if you do not finish the study. To have it removed, contact the team and ask to withdraw, up to one month after your final session.</li>
        <li>You can still withdraw at any time, without giving a reason.</li>
      </ul>
      {before && (before.screenshots > 0 || before.archives > 0) && <p className="mpmb-hint">From before your break we have {filesPhrase(before)}. Thank you.</p>}
      <Callout tone="info">
        <p>
          If you no longer want to take part, you do not need to go on: contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>, quoting your participant ID <strong className="mpmb-mono">{state.code}</strong>.
        </p>
      </Callout>
      <Disclosure summary="Read the statements you agreed to">
        <ul className="mpmb-list">
          {labConsentForm.statements
            .filter((s) => s.kind === 'required')
            .map((s) => (
              <li key={s.id}>{s.text}</li>
            ))}
        </ul>
      </Disclosure>
    </LabShell>
  );
}
