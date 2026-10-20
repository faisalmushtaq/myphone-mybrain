import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breakLength, dailyMessage, dailyPlan, middleLines, openingLines, type DailyContext } from './dailyMessages.js';

const v1 = new Date('2026-10-14T09:00:00Z');
const visit2On = (date: string) => new Date(`${date}T10:00:00Z`);
const ctx = (days: number, over: Partial<DailyContext> = {}): DailyContext => ({ days, visit2: { start: visit2On('2026-11-18'), place: 'LG25 (EEG Lab), School of Psychology' }, checkInDone: true, checkInLink: 'https://myphonemybrain.com/break/check-in/?code=MP2670FF90A5F2', contactEmail: 'M.Faizah@leeds.ac.uk', ...over });

test('one message a day from the day after the first visit to the day before the second, at nine UK time, then a thank-you', () => {
  // A 28-day break and a 35-day one: the messages stretch to each.
  const short = dailyPlan(v1, visit2On('2026-11-11'));
  const long = dailyPlan(v1, visit2On('2026-11-18'));
  assert.equal(breakLength(v1, visit2On('2026-11-11')), 28);
  assert.deepEqual(short.map((m) => m.id), [...Array.from({ length: 27 }, (_, i) => `day-${i + 1}`), 'thank-you']);
  assert.equal(long.length, 34 + 1);
  assert.equal(long[0].dueAt.toISOString(), '2026-10-15T08:00:00.000Z', 'day 1 at 09:00 BST');
  assert.equal(long[33].dueAt.toISOString(), '2026-11-17T09:00:00.000Z', 'the day before the second visit, at 09:00 GMT');
  assert.equal(long[34].dueAt.toISOString(), '2026-11-19T09:00:00.000Z', 'the thank-you the morning after');
  // No second visit standing: a 30-day break, and no thank-you.
  assert.equal(dailyPlan(v1, null).length, 29);
});

test('the wording: the opening messages, the check-in on day 15, the middle ones in order, the last days about the second visit', () => {
  for (const days of [28, 30, 35]) {
    const lines = Array.from({ length: days - 1 }, (_, i) => dailyMessage(i + 1, ctx(days)));
    assert.deepEqual(lines.slice(0, 14).map((l) => l.line), openingLines);
    assert.equal(lines[days - 2].kind, 'visit-tomorrow');
    assert.match(lines[days - 2].line, /^Not long now! Your second lab visit is tomorrow, Wed 18 Nov at 10:00, LG25 \(EEG Lab\), School of Psychology\./);
    assert.equal(lines[days - 5].kind, 'visit-soon');
    assert.match(lines[days - 3].line, /^Nearly time to see you again!/);
    // No message repeated within a break.
    assert.equal(new Set(lines.map((l) => l.line)).size, lines.length, `${days} days: every message different`);
  }
  assert.match(dailyMessage(21, ctx(35)).line, /^Three weeks in!/);
  assert.match(dailyMessage(28, ctx(35)).line, /^Four weeks in!/);
  assert.equal(dailyMessage(16, ctx(35)).line, middleLines[0]);
  assert.equal(dailyMessage(22, ctx(35)).line, middleLines[5], 'day 21 is the three-week message, so the middle ones carry on after it');
  assert.equal(dailyMessage(36, ctx(35)).kind, 'thank-you');
});

test('day 15 brings the check-in link; until it is complete, each day after brings a reminder instead', () => {
  const open = ctx(30, { checkInDone: false });
  assert.equal(dailyMessage(15, open).kind, 'check-in');
  assert.match(dailyMessage(15, open).line, /check-in\/\?code=MP2670FF90A5F2/);
  for (const day of [16, 17, 18, 25]) assert.equal(dailyMessage(day, open).kind, 'check-in-reminder', `day ${day}`);
  assert.notEqual(dailyMessage(16, open).line, dailyMessage(17, open).line, 'the reminders vary');
  // The last day still says when the visit is.
  assert.equal(dailyMessage(29, open).kind, 'visit-tomorrow');
  // Once complete, the ordinary messages again.
  assert.equal(dailyMessage(16, ctx(30)).kind, 'daily');
  assert.equal(dailyMessage(15, ctx(30)).kind, 'daily');
});

test('texts: plain characters only, one part (160) for the daily ones, two (306) for those with a link', () => {
  for (const days of [28, 35]) {
    for (const done of [true, false]) {
      for (let day = 1; day <= days + 1; day += 1) {
        const { kind, line } = dailyMessage(day, ctx(days, { checkInDone: done }));
        const sms = `MyPhone/MyBrain: ${line}`;
        assert.match(sms, /^[\x20-\x7E]+$/, `day ${day}: plain characters, so it is billed as GSM text`);
        assert.ok(sms.length <= (kind === 'check-in' || kind === 'check-in-reminder' ? 306 : 160), `day ${day} (${kind}): ${sms.length} characters`);
      }
    }
  }
});
