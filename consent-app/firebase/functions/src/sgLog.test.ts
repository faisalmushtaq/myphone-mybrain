import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mayDo } from './portalCore.js';
import { isHolder, mayAddStep, reporterView, sgAlert, sgInput, sgSettingsOf, withStep, type SgRecord } from './sgLog.js';

const now = new Date('2026-11-22T15:00:00Z');
const ra = { uid: 'ra1', email: 'ra@example.org', role: 'ra' as const };
const otherRa = { uid: 'ra2', email: 'ra2@example.org', role: 'ra' as const };
const researcher = { uid: 'r1', email: 'someone@leeds.ac.uk', role: 'researcher' as const };
const pi = { uid: 'pi', email: 'F.Mushtaq@leeds.ac.uk', role: 'researcher' as const };
const pm = { uid: 'pm', email: 'pm@leeds.ac.uk', role: 'pm' as const };
const s = sgSettingsOf(undefined);
const good = { id: 'sg-12345678', occurredAt: '2026-11-22T10:40:00Z', source: 'session', about: 'Amara Ahmed', yearGroup: 'Year 8', account: 'She said “my brother hits me when Mum is out”.', dsl: 'yes', dslName: 'Mrs Patel', dslAt: '2026-11-22T11:05:00Z', dslHow: 'in-person', immediate: '', immediateDanger: false };

test('the log holders: the project manager and the PI (by default), no one else', () => {
  assert.ok(isHolder(pm, s) && isHolder(pi, s), 'the PI, whatever the case of the address');
  assert.ok(!isHolder(researcher, s) && !isHolder(ra, s));
  assert.ok(isHolder(researcher, sgSettingsOf({ holders: ['someone@leeds.ac.uk'] })));
  assert.ok(!isHolder({ ...pi, role: null }, s), 'not without an active role');
  // Anyone can report; only the PM names the holders.
  assert.ok(mayDo('sg-report', 'ra', 'active') && mayDo('sg-mine', 'ra', 'active') && !mayDo('sg-report', 'ra', 'pending'));
  assert.ok(!mayDo('sg-save-settings', 'researcher', 'active') && mayDo('sg-save-settings', 'pm', 'active'));
});

test('a report: what was said, who it is about, and whether the DSL was told', () => {
  const r = sgInput(good, now);
  assert.ok(r.ok);
  assert.ok(!sgInput({ ...good, account: 'x' }, now).ok, 'what was said is needed');
  assert.ok(!sgInput({ ...good, about: '' }, now).ok);
  assert.ok(!sgInput({ ...good, dsl: '' }, now).ok, 'the DSL question must be answered');
  assert.ok(!sgInput({ ...good, dslName: '' }, now).ok, 'told the DSL: which one');
  assert.ok(!sgInput({ ...good, occurredAt: '2026-11-23T10:00:00Z' }, now).ok, 'not in the future');
  const notYet = sgInput({ ...good, dsl: 'not-yet', dslName: 'ignored' }, now);
  assert.ok(notYet.ok && notYet.value.dslName === '' && notYet.value.dslAt === null);
});

test('steps: anyone adds to their own report; only the holders record actions, close and reopen; nothing is removed', () => {
  const rec = { ...(sgInput(good, now) as { ok: true; value: SgRecord }).value, uid: 'ra1', reporterName: 'Ash', reporterRole: 'ra', receivedAt: '', schoolId: null, status: 'open', outcome: '', steps: [] } as SgRecord;
  assert.ok(mayAddStep(rec, 'addendum', ra, s) && !mayAddStep(rec, 'addendum', otherRa, s));
  assert.ok(!mayAddStep(rec, 'action', ra, s) && !mayAddStep(rec, 'closed', ra, s), 'the reporter cannot close it');
  assert.ok(mayAddStep(rec, 'action', pi, s) && mayAddStep(rec, 'closed', pm, s) && !mayAddStep(rec, 'reopened', pm, s));
  const step = (kind: 'action' | 'closed' | 'reopened' | 'addendum', text: string, by = 'pm') => ({ id: kind, at: '2026-11-22T16:00:00Z', by, byName: by, kind, text });
  const acted = { ...rec, ...withStep(rec, step('action', 'PI decided: coordinator to phone the DSL to confirm.')) };
  const closed = { ...acted, ...withStep(acted, step('closed', 'DSL confirmed it is being handled under the school’s procedures.')) };
  assert.equal(closed.status, 'closed');
  assert.equal(closed.steps.length, 2);
  assert.ok(closed.outcome.startsWith('DSL confirmed'));
  assert.ok(mayAddStep(closed, 'reopened', pm, s) && !mayAddStep(closed, 'closed', pm, s));
  const withNote = { ...closed, ...withStep(closed, step('addendum', 'She also mentioned it to her form tutor.', 'ra1')) };
  // The reporter sees what they wrote and whether it is open; not the holders' actions or the outcome.
  const mine = reporterView(withNote);
  assert.equal(mine.outcome, '');
  assert.deepEqual(mine.steps.map((x) => x.kind), ['addendum']);
  assert.equal(mine.status, 'closed');
});

test('the alert email says there is something to read, and nothing of what', () => {
  const a = sgAlert({ reporterName: 'Ash Assist', occurredAt: good.occurredAt, immediateDanger: false, dsl: 'not-yet' }, 'https://x/portal/#safeguarding-log/sg-12345678');
  assert.ok(!a.text.includes('Amara') && !a.text.includes('brother') && !a.html.includes('Amara'));
  assert.ok(a.text.includes('NOT been told'));
  assert.ok(a.subject === 'Safeguarding concern logged');
});
