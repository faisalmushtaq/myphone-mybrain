import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logger } from 'firebase-functions/v2';
import nodemailer from 'nodemailer';

/**
 * Emails the team straight from the function over SMTP: Gmail with an app
 * password by default, or any other SMTP service. No Firebase extension is
 * involved (Extensions are being retired).
 *
 * The password lives in Secret Manager, put there once with
 * scripts/set-mail-password.sh; the other settings come from the functions'
 * environment (see .env.example and the deploy workflow). Until the secret
 * exists, messages are still stored, nobody is emailed, and the stored record
 * and the logs say so. Nothing is ever emailed to families; adult participants
 * in the social media break study can ask for a progress email (lab.ts).
 */

export interface MailSettings {
  host: string;
  port: number;
  user: string;
  from: string;
  to: string;
  /** Secret Manager secret holding the SMTP password. */
  secret: string;
}

export type MailOutcome = 'sent' | 'not-configured' | 'failed';

export interface TeamMessage {
  subject: string;
  text: string;
  replyTo?: string;
}

export interface Mail extends TeamMessage {
  to: string;
}

/** Reads the SMTP settings from the environment; null when no sending account or recipient is set. */
export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): MailSettings | null {
  const user = env.MPMB_SMTP_USER?.trim();
  const to = env.MPMB_MAIL_TO?.trim();
  if (!user || !to) return null;
  const port = Number(env.MPMB_SMTP_PORT ?? 465);
  return {
    host: env.MPMB_SMTP_HOST?.trim() || 'smtp.gmail.com',
    port: Number.isInteger(port) && port > 0 ? port : 465,
    user,
    from: `${env.MPMB_MAIL_FROM_NAME?.trim() || 'MyPhone/MyBrain'} <${user}>`,
    to,
    secret: env.MPMB_SMTP_SECRET?.trim() || 'mpmb-smtp-password',
  };
}

const CACHE_FOR = 10 * 60_000;
const RETRY_AFTER = 5 * 60_000;
let cache: { password: string | null; at: number } | null = null;
let client: SecretManagerServiceClient | null = null;

/** The SMTP password from Secret Manager, cached; null while it is not there (or not readable) yet. */
async function password(secret: string): Promise<string | null> {
  const now = Date.now();
  if (cache && now - cache.at < (cache.password ? CACHE_FOR : RETRY_AFTER)) return cache.password;
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!project || process.env.FUNCTIONS_EMULATOR === 'true') {
    cache = { password: null, at: now };
    logger.info('Mail: not sending from this environment');
    return null;
  }
  try {
    client ??= new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({ name: `projects/${project}/secrets/${secret}/versions/latest` });
    const data = version.payload?.data;
    const value = (typeof data === 'string' ? data : data ? Buffer.from(data).toString('utf8') : '').trim();
    cache = { password: value || null, at: now };
    if (!value) logger.warn('Mail: the SMTP password secret is empty, so nobody is emailed about new enquiries', { secret });
  } catch (error) {
    cache = { password: null, at: now };
    logger.warn('Mail: no SMTP password available yet, so nobody is emailed about new enquiries. Run scripts/set-mail-password.sh.', { secret, error: String((error as Error).message ?? error) });
  }
  return cache.password;
}

/** Emails the team. Never throws: the caller stores the record whatever happens here. */
export function sendTeamMail(message: TeamMessage, settings: MailSettings | null = settingsFromEnv()): Promise<MailOutcome> {
  if (!settings) {
    logger.warn('Mail: MPMB_SMTP_USER or MPMB_MAIL_TO is not set, so nobody is emailed about new enquiries');
    return Promise.resolve('not-configured');
  }
  return sendMail({ ...message, to: settings.to }, settings);
}

/** Sends one email from the study's account. Never throws. */
export async function sendMail(message: Mail, settings: MailSettings | null = settingsFromEnv()): Promise<MailOutcome> {
  if (!settings) {
    logger.warn('Mail: MPMB_SMTP_USER is not set, so no email can be sent');
    return 'not-configured';
  }
  const pass = await password(settings.secret);
  if (!pass) return 'not-configured';
  try {
    const transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      auth: { user: settings.user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({ from: settings.from, to: message.to, replyTo: message.replyTo, subject: message.subject, text: message.text });
    return 'sent';
  } catch (error) {
    logger.error('Mail: sending failed', { error: String((error as Error).message ?? error) });
    return 'failed';
  }
}
