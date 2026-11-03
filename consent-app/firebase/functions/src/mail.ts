import { logger } from 'firebase-functions/v2';
import nodemailer from 'nodemailer';
import { readSecret } from './secrets.js';

/**
 * Emails the team straight from the function over SMTP: Gmail with an app
 * password by default, or any other SMTP service. No Firebase extension is
 * involved (Extensions are being retired).
 *
 * The password lives in Secret Manager, put there once with
 * scripts/set-mail-password.sh; the other settings come from the functions'
 * environment (see .env.example and the deploy workflow). Until the secret
 * exists, messages are still stored, nobody is emailed, and the stored record
 * and the logs say so. Families get at most a reminder (familyReminders.ts), and only if they gave an email; adult participants
 * in the social media break study can ask for a progress email (lab.ts), and
 * get their booking confirmations and reminders (booking.ts).
 */

export interface MailSettings {
  host: string;
  port: number;
  user: string;
  from: string;
  to: string;
  /** Secret Manager secret holding the SMTP password. */
  secret: string;
  /** Where replies go when an email does not say otherwise (4 November 2026): the team inbox, never the Gmail sender. */
  replyTo: string;
}

/** Every email comes from the study's Gmail account; replies to it go to the team inbox (4 November 2026). */
export const DEFAULT_REPLY_TO = 'brainpop@leeds.ac.uk';

/** Who replies reach: the email's own Reply-To (only the team's notices of an enquiry or a class list, so the team can answer the sender), otherwise the team inbox. */
export const replyToFor = (message: Pick<Mail, 'replyTo'>, settings: Pick<MailSettings, 'replyTo'>): string => message.replyTo?.trim() || settings.replyTo;

export type MailOutcome = 'sent' | 'not-configured' | 'failed';

export interface TeamMessage {
  subject: string;
  text: string;
  replyTo?: string;
}

export interface Attachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface Mail extends TeamMessage {
  to: string;
  /** A copy, for example to the study's contact for every booking. */
  cc?: string;
  /** Blind copies, for one email to many people (the portal's team emails). */
  bcc?: string;
  /** An HTML version beside the plain text. */
  html?: string;
  /** The name shown beside the study's own address ("MyPhone/MyBrain team"); the address is always the configured sender. */
  fromName?: string;
  attachments?: Attachment[];
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
    replyTo: env.MPMB_REPLY_TO?.trim() || DEFAULT_REPLY_TO,
  };
}

/** The SMTP password from Secret Manager (cached there); null while it is not there, or in the emulator. */
async function password(secret: string): Promise<string | null> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    logger.info('Mail: not sending from this environment');
    return null;
  }
  const value = await readSecret(secret);
  if (!value) logger.warn('Mail: no SMTP password available yet, so nobody is emailed. Run scripts/set-mail-password.sh.', { secret });
  return value;
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
    const from = message.fromName ? `${message.fromName.replace(/[<>"\r\n]/g, '')} <${settings.user}>` : settings.from;
    await transport.sendMail({ from, to: message.to, cc: message.cc, bcc: message.bcc, replyTo: replyToFor(message, settings), subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}), attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) });
    return 'sent';
  } catch (error) {
    logger.error('Mail: sending failed', { error: String((error as Error).message ?? error) });
    return 'failed';
  }
}
