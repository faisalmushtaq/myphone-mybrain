import { useState, type KeyboardEvent } from 'react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';

/**
 * While recruitment is paused (5 November 2026): leave an email address to hear when it reopens. The address is used
 * only for that one email, is not linked to any study record, and is deleted once the email has gone.
 */
export function WaitlistForm({ group }: { group: 'break' | 'control' }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Not a <form>: the step page is one already, and forms cannot be nested. Enter in the box sends it.
  const submit = async () => {
    setBusy(true);
    setError('');
    const problem = await getApi().joinLabWaitlist(email.trim(), group);
    setBusy(false);
    if (problem) setError(problem);
    else setDone(true);
  };

  if (done) return <p role="status">Thank you. We will email you once when recruitment reopens, then delete your address.</p>;
  return (
    <div role="group" aria-label="Email me when recruitment reopens">
      <TextField id="waitlist-email" label="Email me when it reopens" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }} error={error || undefined} hint="We use this only to tell you when recruitment reopens, then delete it. It is not linked to any study data." />
      <Button onClick={() => void submit()} disabled={busy}>
        {busy ? 'Saving…' : 'Let me know'}
      </Button>
    </div>
  );
}
