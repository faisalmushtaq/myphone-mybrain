// node --test consent-app/scripts/match-myself.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dobAgreement, jaroWinkler, match, loadMyself, loadWebsite, nameKey, parseCsv, parseTsv, postcodeOf, run, toTsv } from './match-myself.mjs';

// MySelf's ID, as the website's export works it out (firebase/functions/src/myselfId.ts).
function id(first, last, dob) {
  const digest = createHash('sha256').update(`myself-participant-v1|${nameKey(first)}|${nameKey(last)}|${dob}`).digest();
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0, value = 0, out = 'P';
  for (const byte of digest) {
    value = ((value << 8) | byte) >>> 0;
    bits += 8;
    while (bits >= 5 && out.length < 11) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; }
    if (out.length === 11) break;
  }
  return out;
}

test('the ID here is MySelf’s', () => assert.equal(id('Amara', 'Ahmed', '2012-05-04'), 'PNNTN6X2K00'));

test('helpers: Jaro-Winkler, dates, postcodes, files', () => {
  assert.equal(jaroWinkler('martha', 'martha'), 1);
  assert.ok(jaroWinkler('martha', 'marhta') > 0.95);
  assert.ok(jaroWinkler('fitzgerald', 'fitzgerlad') > 0.95);
  assert.ok(jaroWinkler('smith', 'patel') < 0.6);
  assert.equal(dobAgreement('2012-03-07', '2012-07-03').how, 'day-month-swapped');
  assert.equal(dobAgreement('2012-03-07', '2012-03-08').how, 'one-digit-off');
  assert.equal(dobAgreement('2012-03-07', '2011-04-07').how, 'different');
  assert.equal(postcodeOf('{"postcode":"ls6 1ab","house":"14"}'), 'LS61AB');
  assert.equal(postcodeOf('14 Long Lane, Leeds LS6 1AB'), 'LS61AB');
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n'), [{ a: 'x, y', b: 'say "hi"' }]);
  assert.deepEqual(parseTsv(toTsv([{ a: '', b: 'x' }], ['a', 'b'])), [{ a: '', b: 'x' }]);
});

/** A small school: the website's export files and MySelf's, as the coordinator has them. */
function fixture() {
  const kids = [
    // [firestore id, label, first, last, dob, postcode]
    ['w1', 'sub-00001', 'Amara', 'Ahmed', '2012-05-04', 'LS6 1AB'],
    ['w2', 'sub-00002', 'Tom', 'Baker', '2012-09-15', 'LS7 2CD'],
    ['w3', 'sub-00003', 'Lily', 'Evans', '2012-03-07', 'LS8 3EF'],
    ['w4', 'sub-00004', 'Noah', 'Fitzgerald', '2012-11-20', 'LS9 4GH'],
    ['w5', 'sub-00005', 'Ella', 'Ward', '2012-06-02', 'BD7 1AB'],
    ['w6', 'sub-00006', 'Emma', 'Ward', '2012-06-02', 'BD7 1AB'],
    ['w7', 'sub-00007', 'Sam', 'Lee', '2012-01-25', 'LS1 1AA'],
    ['w8', 'sub-00008', 'Zara', 'Hussain', '2012-10-10', 'LS2 2BB'],
  ];
  const key = kids.map(([f, l, first, last, dob, pc]) => ({ participant_id: l, firestore_id: f, myself_id: id(first, last, dob), kind: 'consent', first_name: first, last_name: last, date_of_birth: dob, school_id: 'GSAL', postcode: pc }));
  const variant = (f, kind, first, last, dob) => ({ participant_id: key.find((k) => k.firestore_id === f).participant_id, firestore_id: f, school_id: 'GSAL', kind, first_name: first, last_name: last, date_of_birth: dob, myself_id: id(first, last, dob) });
  const candidates = [
    variant('w2', 'nickname', 'thomas', 'Baker', '2012-09-15'),
    variant('w2', 'nickname', 'tommy', 'Baker', '2012-09-15'),
    variant('w3', 'dob-day-month-swapped', 'Lily', 'Evans', '2012-07-03'),
    variant('w7', 'nickname', 'samuel', 'Lee', '2012-01-25'),
    variant('w7', 'nickname', 'samantha', 'Lee', '2012-01-25'),
  ];
  const upnMatches = [{ firestore_id: 'w8', upn: 'A123456789012' }];
  const mys = [
    // [given, family, dob, postcode, upn]
    ['Amara', 'Ahmed', '2012-05-04', 'LS6 1AB', ''], // exact
    ['Thomas', 'Baker', '2012-09-15', '', ''], // nickname
    ['Lily', 'Evans', '2012-07-03', '', ''], // day and month swapped
    ['Noah', 'Fitzgerlad', '2012-11-20', 'LS9 4GH', ''], // a typo: fuzzy
    ['Ema', 'Ward', '2012-06-02', 'BD7 1AB', ''], // one of the twins, which?
    ['Samuel', 'Lee', '2012-01-25', '', ''], // Sam could be either
    ['Samantha', 'Lee', '2012-01-25', '', ''],
    ['Zahra', 'Husain', '2012-10-01', '', 'A123456789012'], // the UPN carries it
    ['Oscar', 'Nobody', '2012-02-02', '', ''], // not on the website
  ];
  const participants = mys.map(([g, f, d]) => ({ participant_id: `sub-${id(g, f, d)}`, study: 'ybm', n_sessions: '1', first_seen: '2026-11-10', last_seen: '2026-11-10', sites: 'GSAL01' }));
  const identifiers = mys.map(([g, f, d, pc, upn]) => ({ participant_id: id(g, f, d), given_name: g, family_name: f, date_of_birth: d, home_address: pc ? JSON.stringify({ postcode: pc }) : '', upn, nhs_number: '', n_sittings: '1' }));
  return { key, candidates, upnMatches, participants, identifiers, mys };
}

const loaded = (fx) => ({ website: loadWebsite(fx), myself: loadMyself(fx) });
const linkOf = (r, w) => r.links.filter((l) => l.website_firestore_id === w);

test('links exact, nickname, swapped-date and UPN matches on their own', () => {
  const fx = fixture();
  const r = match(loaded(fx));
  assert.deepEqual(linkOf(r, 'w1').map((l) => [l.tier, l.how]), [['exact', 'auto']]);
  assert.deepEqual(linkOf(r, 'w2').map((l) => [l.myself_id, l.tier]), [[id('Thomas', 'Baker', '2012-09-15'), 'variant:nickname']]);
  assert.deepEqual(linkOf(r, 'w3').map((l) => l.tier), ['variant:dob-day-month-swapped']);
  assert.deepEqual(linkOf(r, 'w8').map((l) => l.tier), ['upn']);
});

test('a surname typo goes to review, never linked on its own', () => {
  const r = match(loaded(fixture()));
  assert.deepEqual(linkOf(r, 'w4'), []);
  const row = r.review.find((x) => x.website_firestore_id === 'w4');
  assert.equal(row.tier, 'fuzzy');
  assert.equal(row.myself_family_name, 'Fitzgerlad');
  assert.match(row.reason, /same postcode/);
});

test('twins are not linked on their own: both are offered for review', () => {
  const r = match(loaded(fixture()));
  assert.deepEqual([...linkOf(r, 'w5'), ...linkOf(r, 'w6')], []);
  const ema = id('Ema', 'Ward', '2012-06-02');
  const rows = r.review.filter((x) => x.myself_id === ema);
  assert.deepEqual(rows.map((x) => x.website_firestore_id).sort(), ['w5', 'w6']);
  assert.ok(rows.every((x) => x.reason.includes('ambiguous')));
});

test('one website record fitting two MySelf codes is not linked on its own', () => {
  const r = match(loaded(fixture()));
  assert.deepEqual(linkOf(r, 'w7'), []);
  const rows = r.review.filter((x) => x.website_firestore_id === 'w7' && x.tier === 'variant:nickname');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => /ambiguous: 2 MySelf codes/.test(x.reason)));
});

test('decisions are kept between runs, and a second code for one person becomes a MySelf correction', () => {
  const fx = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'match-myself-'));
  const schools = join(dir, 'schools');
  mkdirSync(join(schools, 'identifying'), { recursive: true });
  mkdirSync(join(schools, 'upn-uploads', 'GSAL'), { recursive: true });
  writeFileSync(join(schools, 'identifying', 'participants_key.tsv'), toTsv(fx.key, Object.keys(fx.key[0])));
  writeFileSync(join(schools, 'identifying', 'myself_candidate_ids.tsv'), toTsv(fx.candidates, Object.keys(fx.candidates[0])));
  writeFileSync(join(schools, 'upn-uploads', 'upn_matches.tsv'), toTsv(fx.upnMatches, ['firestore_id', 'upn']));
  writeFileSync(join(schools, 'upn-uploads', 'GSAL', '2026-11-01_u1_pupils.tsv'), toTsv([], ['row', 'upn', 'first_name', 'last_name', 'date_of_birth', 'myself_id']));
  const myselfFile = join(dir, 'participants.tsv');
  writeFileSync(myselfFile, toTsv(fx.participants, ['participant_id', 'study', 'n_sessions', 'first_seen', 'last_seen', 'sites']));
  const idFile = join(dir, 'myself_identifiers_2026-11-20.csv');
  const cols = ['participant_id', 'given_name', 'family_name', 'date_of_birth', 'home_address', 'upn', 'nhs_number', 'n_sittings'];
  writeFileSync(idFile, [cols.join(','), ...fx.identifiers.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(','))].join('\n') + '\n');
  const out = join(dir, 'linkage');
  const opts = { website: schools, myself: myselfFile, identifiers: idFile, out, html: true };

  const first = run(opts, new Date('2026-11-20T09:00:00Z'));
  assert.match(first.summary, /Linked:\s+4\n/);

  // The coordinator decides in review.tsv: Noah is the typo; Ema is Emma (w6), not Ella; Sam is Samuel, and Samantha is also Sam (a second code).
  const review = parseTsv(readFileSync(join(out, 'review.tsv'), 'utf8'));
  const decide = (w, m, d) => { review.find((x) => x.website_firestore_id === w && x.myself_id === m).decision = d; };
  decide('w4', id('Noah', 'Fitzgerlad', '2012-11-20'), 'link');
  decide('w6', id('Ema', 'Ward', '2012-06-02'), 'link');
  decide('w5', id('Ema', 'Ward', '2012-06-02'), 'reject');
  decide('w7', id('Samuel', 'Lee', '2012-01-25'), 'link');
  decide('w7', id('Samantha', 'Lee', '2012-01-25'), 'link');
  writeFileSync(join(out, 'review.tsv'), toTsv(review, Object.keys(review[0])));

  const second = run(opts, new Date('2026-11-21T09:00:00Z'));
  for (const w of ['w4', 'w6']) assert.deepEqual(linkOf(second.result, w).map((l) => [l.tier, l.how]), [['decision', 'reviewed']]);
  assert.equal(linkOf(second.result, 'w7').length, 2);
  assert.deepEqual(linkOf(second.result, 'w5'), []);
  assert.ok(!second.result.review.some((x) => x.website_firestore_id === 'w5'), 'a rejected pair is not offered again');
  assert.equal(second.result.corrections.length, 1);
  assert.equal(parseTsv(readFileSync(join(out, 'decisions.tsv'), 'utf8')).length, 5);

  // A third run, with review.tsv now freshly written (no decisions in it), still knows them all.
  const third = run(opts, new Date('2026-11-22T09:00:00Z'));
  assert.deepEqual(third.result.links, second.result.links);
  assert.equal(third.result.review.length, 0);
  const corr = parseTsv(readFileSync(join(out, 'myself_corrections.tsv'), 'utf8'));
  assert.equal(corr.length, 1);
  assert.ok(readFileSync(join(out, 'review.html'), 'utf8').includes('MySelf linkage review'));
  const unW = parseTsv(readFileSync(join(out, 'unmatched_website.tsv'), 'utf8'));
  assert.deepEqual(unW.map((x) => x.firestore_id), ['w5']);
  const unM = parseTsv(readFileSync(join(out, 'unmatched_myself.tsv'), 'utf8'));
  assert.deepEqual(unM.map((x) => x.given_name), ['Oscar']);
  if (process.env.SHOW_SUMMARY) process.stdout.write(`\n${first.summary}\n${third.summary}`);
});
