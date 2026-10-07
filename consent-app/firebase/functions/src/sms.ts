import { logger } from 'firebase-functions/v2';
import { readSecret } from './secrets.js';

/**
 * Text messages for lab-visit and check-in reminders, sent through Twilio's
 * REST API (roughly 4p a message to a UK mobile). Nothing else is needed: no
 * SDK, no extension.
 *
 * Set up once (docs/booking.md):
 *   - the account SID and auth token go into Secret Manager as one secret,
 *     "SID:TOKEN", with scripts/set-sms-credentials.sh;
 *   - the sender is the repository variable MPMB_SMS_FROM: a Twilio number,
 *     or a name of up to 11 letters (UK networks show it instead of a number).
 * Until both exist nothing is texted, and the booking records say
 * 'not-configured' against each reminder, so it is visible what would have
 * gone out.
 */

export type SmsOutcome = 'sent' | 'not-configured' | 'failed' | 'invalid-number';

/** A UK mobile number in international form (+447…), or null when it is not one. */
export function ukMobile(input: string): string | null {
  let n = input.replace(/[^\d+]/g, '');
  if (n.startsWith('+44')) n = `0${n.slice(3)}`;
  else if (n.startsWith('0044')) n = `0${n.slice(4)}`;
  else if (n.startsWith('44') && n.length === 12) n = `0${n.slice(2)}`;
  if (n.startsWith('00')) return null;
  if (n.startsWith('07') === false && n.startsWith('7') && n.length === 10) n = `0${n}`;
  return /^07\d{9}$/.test(n) ? `+44${n.slice(1)}` : null;
}

/** Whether texts can be sent at all: the sender and the credentials are set up. The emulator says yes, so the pages can be tested; it never sends. */
export async function smsReady(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.FUNCTIONS_EMULATOR === 'true') return true;
  if (!env.MPMB_SMS_FROM?.trim()) return false;
  const credentials = await readSecret(env.MPMB_SMS_SECRET?.trim() || 'mpmb-sms-credentials');
  return Boolean(credentials && credentials.includes(':'));
}

/** Sends one text. Never throws: the caller records the outcome. */
export async function sendSms(to: string, body: string, env: NodeJS.ProcessEnv = process.env): Promise<SmsOutcome> {
  const number = ukMobile(to);
  if (!number) return 'invalid-number';
  if (env.FUNCTIONS_EMULATOR === 'true') return 'not-configured';
  const from = env.MPMB_SMS_FROM?.trim();
  const credentials = await readSecret(env.MPMB_SMS_SECRET?.trim() || 'mpmb-sms-credentials');
  if (!from || !credentials || !credentials.includes(':')) return 'not-configured';
  const [sid, token] = credentials.split(':', 2).map((s) => s.trim());
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: number, From: from, Body: body }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.error('SMS: the provider refused the message', { status: res.status, detail: (await res.text()).slice(0, 300) });
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    logger.error('SMS: sending failed', { error: String((error as Error).message ?? error) });
    return 'failed';
  }
}
