import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { CheckboxField, ChoiceField, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { REMINDER_OPTIONS, type ReminderFrequency } from '../config';
import { NyShell } from '../NyShell';
import { useNy } from '../store';
import { SaveApp } from './SaveApp';

/** Reminders (how often, email, text), the leaderboard, and saving the study to the phone. */
export function Settings() {
  const { state, dispatch } = useNy();
  const p = state.participant;
  const [frequency, setFrequency] = useState<ReminderFrequency>(p?.reminders.frequency ?? 'weekly');
  const [email, setEmail] = useState(p?.reminders.email ?? false);
  const [sms, setSms] = useState(p?.reminders.sms ?? false);
  const [phone, setPhone] = useState(p?.reminders.phone ?? '');
  const [onBoard, setOnBoard] = useState(p?.onLeaderboard ?? true);
  const [error, setError] = useState<string | undefined>();
  if (!p) return null;
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (sms && !/^\+?[\d\s()-]{7,20}$/.test(phone.trim())) {
      setError('Please give a mobile number with the country code, or untick text reminders.');
      return;
    }
    dispatch({ type: 'settings', patch: { reminders: { frequency, email, sms, phone: sms ? phone.trim() : '' }, onLeaderboard: onBoard } });
    announce('Settings saved.');
  };
  return (
    <NyShell kicker="Settings" title="Reminders and settings.">
      {state.flash?.kind === 'settings-saved' && (
        <Callout tone="success" role="status">
          <p>Saved.</p>
        </Callout>
      )}
      <form className="ny-form" onSubmit={save} noValidate>
        <ChoiceField id="ny-frequency" name="ny-frequency" legend={<span className="ny-legend">How often should we remind you to check in?</span>} value={frequency} onChange={(v) => setFrequency(v as ReminderFrequency)} options={REMINDER_OPTIONS} />
        <CheckboxField id="ny-email" checked={email} onChange={setEmail} label="Send me reminder emails" hint="To the email address you signed up with." />
        <CheckboxField id="ny-sms" checked={sms} onChange={(on) => { setSms(on); setError(undefined); }} label="Send me reminder text messages" />
        {sms && <TextField id="ny-phone" label="Mobile number" hint="With the country code, for example +44 7700 900123." type="tel" autoComplete="tel" value={phone} maxLength={30} width="half" onChange={(e) => { setPhone(e.target.value); setError(undefined); }} error={error} />}
        <CheckboxField id="ny-board" checked={onBoard} onChange={setOnBoard} label={`Show ${p.name} on the leaderboard`} />
        <div className="mpmb-actions">
          <Button type="submit" variant="primary">
            Save settings
          </Button>
        </div>
      </form>
      <section aria-labelledby="ny-app-h" className="ny-section">
        <h2 className="mpmb-h3" id="ny-app-h">
          Save the study to your phone
        </h2>
        <SaveApp />
      </section>
    </NyShell>
  );
}
