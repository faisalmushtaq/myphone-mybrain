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
