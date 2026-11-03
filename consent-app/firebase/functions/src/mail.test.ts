import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendTeamMail, settingsFromEnv } from './mail.js';

test('mail settings come from the environment, with Gmail defaults', () => {
  assert.equal(settingsFromEnv({}), null);
  assert.equal(settingsFromEnv({ MPMB_SMTP_USER: 'team@gmail.com' }), null, 'a recipient is needed too');
  assert.deepEqual(settingsFromEnv({ MPMB_SMTP_USER: 'team@gmail.com', MPMB_MAIL_TO: 'brainpop@leeds.ac.uk' }), {
    host: 'smtp.gmail.com',
    port: 465,
    user: 'team@gmail.com',
    from: 'MyPhone/MyBrain <team@gmail.com>',
    to: 'brainpop@leeds.ac.uk',
    secret: 'mpmb-smtp-password',
    replyTo: 'brainpop@leeds.ac.uk',
  });
  assert.equal(settingsFromEnv({ MPMB_SMTP_USER: 'u', MPMB_MAIL_TO: 't', MPMB_SMTP_PORT: 'nonsense' })?.port, 465);
  const other = settingsFromEnv({ MPMB_SMTP_USER: 'postmaster@mg.example.org', MPMB_MAIL_TO: 't', MPMB_SMTP_HOST: 'smtp.eu.mailgun.org', MPMB_SMTP_PORT: '587', MPMB_SMTP_SECRET: 'other' });
  assert.equal(other?.host, 'smtp.eu.mailgun.org');
  assert.equal(other?.port, 587);
  assert.equal(other?.secret, 'other');
});

test('with no sending account, nobody is emailed and nothing throws', async () => {
  assert.equal(await sendTeamMail({ subject: 'Test', text: 'Hello' }, null), 'not-configured');
});

test('replies go to the team inbox unless the email says otherwise (4 November 2026)', async () => {
  const { DEFAULT_REPLY_TO, replyToFor, settingsFromEnv: fromEnv } = await import('./mail.js');
  const s = fromEnv({ MPMB_SMTP_USER: 'brainpopresearch@gmail.com', MPMB_MAIL_TO: 'brainpop@leeds.ac.uk' } as NodeJS.ProcessEnv)!;
  assert.equal(DEFAULT_REPLY_TO, 'brainpop@leeds.ac.uk');
  assert.equal(s.replyTo, 'brainpop@leeds.ac.uk');
  assert.equal(replyToFor({}, s), 'brainpop@leeds.ac.uk');
  assert.equal(replyToFor({ replyTo: 'parent@example.org' }, s), 'parent@example.org');
  assert.equal(fromEnv({ MPMB_SMTP_USER: 'a@b.co', MPMB_MAIL_TO: 'c@d.co', MPMB_REPLY_TO: 'team@leeds.ac.uk' } as NodeJS.ProcessEnv)!.replyTo, 'team@leeds.ac.uk');
});
