#!/usr/bin/env node
/**
 * Links website records to MySelf school-survey records (4 November 2026).
 * Plain Node 18+, no packages. Run it on a coordinator's own computer against
 * the OneDrive copy of the export; it reads files and writes files, nothing
 * else. See consent-app/docs/myself-linkage.md.
 *
 *   node consent-app/scripts/match-myself.mjs \
 *     --website "<OneDrive>/MyPhoneMyBrain/schools" \
 *     --myself  "<MySelf BIDS>/participants.tsv" \
 *     [--identifiers myself_identifiers_2026-11-20.csv] \
 *     [--site-map site_map.tsv] [--html] \
 *     --out "<OneDrive>/MyPhoneMyBrain/linkage"
 *
 * The order of the tiers, strongest first. A pair links on its own only when
 * it is the one candidate on both sides at that tier; anything else goes to
 * review.tsv for a person to decide:
 *   exact     the website's myself_id is a MySelf code
 *   variant   one of the website's candidate IDs (nickname, swapped day and
 *             month, names swapped, part of a double-barrelled name, the
 *             class-list name) is a MySelf code
 *   upn       the same UPN on both sides (MySelf's linked UPN, or the pupil's
 *             class-list ID in the school's pupils.tsv)
 *   fuzzy     names alike, date of birth equal, one digit off or day and month
 *             swapped, postcode; always reviewed, never linked on its own
 * Decisions (decisions.tsv, and any decisions-*.tsv saved from review.html,
 * and the decision column of the last review.tsv) are kept between runs.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ── files ─────────────────────────────────────────────────────────────── */

const NA = new Set(['', 'n/a', 'N/A']);
const cell = (v) => (v === undefined || v === null || NA.has(String(v)) ? '' : String(v));

/** Rows of a tab-separated file with a header, n/a read as empty. */
export function parseTsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const head = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const parts = l.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cell(parts[i])]));
  });
}

/** Rows of a CSV file with a header (RFC 4180 quoting). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, cell(r[i])])));
}

export function toTsv(rows, columns) {
  const clean = (v) => (v === undefined || v === null || v === '' ? 'n/a' : String(v).replace(/[\t\r\n]+/g, ' '));
  return [columns.join('\t'), ...rows.map((r) => columns.map((c) => clean(r[c])).join('\t'))].join('\n') + '\n';
}

const read = (p) => readFileSync(p, 'utf8');
const readTsvIf = (p) => (p && existsSync(p) ? parseTsv(read(p)) : []);

/** Every file under a folder whose name ends with the suffix. */
function findFiles(dir, suffix) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...findFiles(p, suffix));
    else if (name.endsWith(suffix)) out.push(p);
  }
  return out.sort();
}

/* ── comparing ─────────────────────────────────────────────────────────── */

/** A name as MySelf's ID reads it: letters and digits, lower case, no accents. */
export const nameKey = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const postcodeKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** The postcode in MySelf's home_address cell (JSON with a postcode, or text). */
export function postcodeOf(address) {
  const s = String(address ?? '');
  if (!s) return '';
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && o.postcode) return postcodeKey(o.postcode);
  } catch { /* plain text */ }
  const m = s.match(POSTCODE);
  return m ? postcodeKey(m[1] + m[2]) : '';
}

/** Jaro-Winkler similarity, 0 to 1. */
export function jaroWinkler(a, b) {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** How alike two dates of birth are: exact, day and month swapped, one digit off, or not. */
export function dobAgreement(a, b) {
  if (!a || !b) return { score: 0, how: 'missing' };
  if (a === b) return { score: 1, how: 'same' };
  const ma = a.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const mb = b.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!ma || !mb) return { score: 0, how: 'different' };
  if (ma[1] === mb[1] && ma[2] === mb[3] && ma[3] === mb[2]) return { score: 0.9, how: 'day-month-swapped' };
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  if (diff === 1) return { score: 0.8, how: 'one-digit-off' };
  return { score: 0, how: 'different' };
}

/** How alike two people's names are, allowing first and last the wrong way round. */
export function nameAgreement(f1, l1, f2, l2) {
  const [a, b, c, d] = [f1, l1, f2, l2].map(nameKey);
  const straight = { first: jaroWinkler(a, c), last: jaroWinkler(b, d), swapped: false };
  const crossed = { first: jaroWinkler(a, d), last: jaroWinkler(b, c), swapped: true };
  const avg = (x) => (x.first + x.last) / 2;
  const best = avg(crossed) > avg(straight) + 0.05 ? crossed : straight;
  return { ...best, score: avg(best) };
}

/** A fuzzy score for a website person and a MySelf person with names, or null when they are too unlike to show. */
export function fuzzyScore(w, m) {
  if (!m.given_name || !m.family_name) return null;
  const name = nameAgreement(w.first_name, w.last_name, m.given_name, m.family_name);
  const dob = dobAgreement(w.date_of_birth, m.date_of_birth);
  const samePostcode = Boolean(w.postcode && m.postcode && w.postcode === m.postcode);
  const shown = (dob.score > 0 && name.last >= 0.85 && name.first >= 0.7) || (dob.score === 1 && name.score >= 0.8) || (samePostcode && dob.score > 0 && name.last >= 0.8) || (samePostcode && name.score >= 0.93);
  if (!shown) return null;
  const score = 0.5 * name.score + 0.35 * dob.score + 0.15 * (samePostcode ? 1 : 0);
  const why = [`names ${name.first.toFixed(2)}/${name.last.toFixed(2)}${name.swapped ? ' (swapped)' : ''}`, `dob ${dob.how}`, samePostcode ? 'same postcode' : w.postcode && m.postcode ? 'other postcode' : 'no postcode'];
  return { score: Math.round(score * 1000) / 1000, why: why.join('; ') };
}

/* ── loading ───────────────────────────────────────────────────────────── */

/** The website's people (participants_key.tsv), their candidate IDs, and UPNs from the school class lists. */
export function loadWebsite({ key, candidates, upnMatches = [], pupils = [] }) {
  const people = new Map();
  for (const r of key) {
    if (!r.firestore_id || r.kind === 'declined') continue;
    people.set(r.firestore_id, { firestore_id: r.firestore_id, participant_id: r.participant_id, first_name: r.first_name, last_name: r.last_name, date_of_birth: r.date_of_birth, school_id: r.school_id, postcode: postcodeKey(r.postcode), myself_id: r.myself_id, upn: '' });
  }
  for (const r of upnMatches) {
    const p = people.get(r.firestore_id);
    if (p && r.upn) p.upn = r.upn;
  }
  const variants = candidates.filter((c) => people.has(c.firestore_id) && c.myself_id);
  // The pupil's ID from the school's legal name, keyed by UPN, so a MySelf code that matches a class-list row reaches the family through the UPN.
  const pupilIdByUpn = new Map();
  for (const p of pupils) if (p.upn && p.myself_id) pupilIdByUpn.set(p.upn, p.myself_id);
  return { people, variants, pupilIdByUpn };
}

/** MySelf's people: the BIDS participants.tsv, with names and UPNs from the identifier CSV when given. */
export function loadMyself({ participants, identifiers = [] }) {
  const people = new Map();
  const blank = (id) => ({ myself_id: id, given_name: '', family_name: '', date_of_birth: '', postcode: '', upn: '', sites: [], n_sessions: '', first_seen: '' });
  for (const r of participants) {
    const id = String(r.participant_id ?? '').replace(/^sub-/, '');
    if (!id) continue;
    people.set(id, { ...blank(id), sites: r.sites ? r.sites.split(',').map((s) => s.trim()).filter(Boolean) : [], n_sessions: r.n_sessions, first_seen: r.first_seen });
  }
  for (const r of identifiers) {
    const id = String(r.participant_id ?? '').replace(/^sub-/, '');
    if (!id) continue;
    const p = people.get(id) ?? blank(id);
    Object.assign(p, { given_name: r.given_name, family_name: r.family_name, date_of_birth: r.date_of_birth, postcode: postcodeOf(r.home_address), upn: r.upn });
    people.set(id, p);
  }
  return people;
}

/* ── decisions ─────────────────────────────────────────────────────────── */

export const DECISION_COLUMNS = ['website_firestore_id', 'myself_id', 'decision', 'decided_on', 'note'];
const DECISIONS = new Set(['link', 'reject']);

/** The decisions so far, later files winning: decisions.tsv, then decisions-*.tsv, then the last review.tsv. */
export function gatherDecisions(outDir, today) {
  const byPair = new Map();
  const take = (rows) => {
    for (const r of rows) {
      const decision = String(r.decision ?? '').trim().toLowerCase();
      const w = r.website_firestore_id;
      const m = r.myself_id;
      if (!w || !m || !DECISIONS.has(decision)) continue;
      byPair.set(`${w}|${m}`, { website_firestore_id: w, myself_id: m, decision, decided_on: r.decided_on || today, note: r.note ?? '' });
    }
  };
  take(readTsvIf(join(outDir, 'decisions.tsv')));
  if (existsSync(outDir)) for (const f of readdirSync(outDir).filter((n) => /^decisions-.+\.tsv$/.test(n)).sort()) take(readTsvIf(join(outDir, f)));
  take(readTsvIf(join(outDir, 'review.tsv')));
  return [...byPair.values()].sort((a, b) => a.website_firestore_id.localeCompare(b.website_firestore_id) || a.myself_id.localeCompare(b.myself_id));
}

/* ── matching ──────────────────────────────────────────────────────────── */

const reviewId = (w, m) => createHash('sha256').update(`${w}|${m}`).digest('hex').slice(0, 10);

/**
 * Everything the run decides, from loaded records alone (no files), so it can
 * be tested. siteMap: MySelf site code -> website school_id; when given, fuzzy
 * candidates are only looked for within the same school.
 */
export function match({ website, myself, decisions = [], siteMap = new Map() }) {
  const { people: wp, variants, pupilIdByUpn } = website;
  const rejected = new Set(decisions.filter((d) => d.decision === 'reject').map((d) => `${d.website_firestore_id}|${d.myself_id}`));
  const links = [];
  const linkedW = new Map(); // firestore_id -> [myself ids]
  const linkedM = new Set();
  const addLink = (w, m, tier, how) => {
    links.push({ website_participant_id: wp.get(w)?.participant_id ?? '', website_firestore_id: w, myself_id: m, tier, how });
    linkedW.set(w, [...(linkedW.get(w) ?? []), m]);
    linkedM.add(m);
  };

  // 1. What a person has already decided.
  for (const d of decisions) if (d.decision === 'link' && wp.has(d.website_firestore_id) && myself.has(d.myself_id)) addLink(d.website_firestore_id, d.myself_id, 'decision', 'reviewed');

  const review = new Map();
  const toReview = (w, m, tier, reason, score = '') => {
    if (rejected.has(`${w}|${m}`)) return;
    const k = `${w}|${m}`;
    if (review.has(k)) return;
    review.set(k, { w, m, tier, reason, score });
  };

  // 2-4. The ID tiers, in order. Each finds candidate pairs; a pair unique on both sides links.
  const tiers = [
    ['exact', () => [...wp.values()].filter((p) => p.myself_id && myself.has(p.myself_id)).map((p) => [p.firestore_id, p.myself_id, 'exact'])],
    ['variant', () => variants.filter((v) => myself.has(v.myself_id)).map((v) => [v.firestore_id, v.myself_id, `variant:${v.kind}`])],
    ['upn', () => {
      const out = [];
      const byUpn = new Map();
      for (const p of wp.values()) if (p.upn) byUpn.set(p.upn, [...(byUpn.get(p.upn) ?? []), p.firestore_id]);
      for (const m of myself.values()) if (m.upn) for (const w of byUpn.get(m.upn) ?? []) out.push([w, m.myself_id, 'upn']);
      for (const [upn, id] of pupilIdByUpn) if (myself.has(id)) for (const w of byUpn.get(upn) ?? []) out.push([w, id, 'upn:class-list']);
      return out;
    }],
  ];
  for (const [, find] of tiers) {
    const pairs = find().filter(([w, m]) => !rejected.has(`${w}|${m}`) && !(linkedW.get(w) ?? []).includes(m));
    const perW = new Map();
    const perM = new Map();
    for (const [w, m] of pairs) {
      perW.set(w, new Set([...(perW.get(w) ?? []), m]));
      perM.set(m, new Set([...(perM.get(m) ?? []), w]));
    }
    const seen = new Set();
    for (const [w, m, tier] of pairs) {
      if (seen.has(`${w}|${m}`)) continue;
      seen.add(`${w}|${m}`);
      if (linkedM.has(m)) continue; // this MySelf code already belongs to someone
      if (linkedW.has(w)) {
        toReview(w, m, tier, 'second MySelf code: the website record is already linked to another; if both are this young person, MySelf should merge them (myself_corrections.tsv)');
        continue;
      }
      const ws = perW.get(w).size;
      const ms = perM.get(m).size;
      if (ws === 1 && ms === 1) addLink(w, m, tier, 'auto');
      else toReview(w, m, tier, ws > 1 ? `ambiguous: ${ws} MySelf codes fit this website record` : `ambiguous: ${ms} website records fit this MySelf code (one child registered twice, or twins?)`);
    }
  }

  // 5. Fuzzy, for the MySelf records with names and nobody yet.
  const unlinkedW = [...wp.values()].filter((p) => !linkedW.has(p.firestore_id));
  for (const m of myself.values()) {
    if (linkedM.has(m.myself_id) || !m.given_name) continue;
    const schools = new Set(m.sites.map((s) => siteMap.get(s)).filter(Boolean));
    const pool = siteMap.size && schools.size ? unlinkedW.filter((p) => schools.has(p.school_id)) : unlinkedW;
    const found = pool.map((p) => ({ p, s: fuzzyScore(p, m) })).filter((x) => x.s).sort((a, b) => b.s.score - a.s.score).slice(0, 3);
    for (const { p, s } of found) {
      const others = found.length - 1;
      toReview(p.firestore_id, m.myself_id, 'fuzzy', `${s.why}${others ? `; ambiguous: ${others} other website record${others > 1 ? 's' : ''} also fit (twins or siblings?)` : ''}`, s.score);
    }
  }

  // The review list, minus pairs a person has decided and pairs whose MySelf code is now linked to someone else.
  const decided = new Set(decisions.map((d) => `${d.website_firestore_id}|${d.myself_id}`));
  const reviewRows = [...review.values()]
    .filter(({ w, m }) => !decided.has(`${w}|${m}`) && !(linkedM.has(m) && !(linkedW.get(w) ?? []).includes(m)))
    .map(({ w, m, tier, reason, score }) => {
      const a = wp.get(w);
      const b = myself.get(m);
      return { review_id: reviewId(w, m), decision: '', tier, score, reason, website_participant_id: a.participant_id, website_firestore_id: w, website_first_name: a.first_name, website_last_name: a.last_name, website_date_of_birth: a.date_of_birth, website_school_id: a.school_id, website_postcode: a.postcode, website_myself_id: a.myself_id, myself_id: m, myself_given_name: b.given_name, myself_family_name: b.family_name, myself_date_of_birth: b.date_of_birth, myself_postcode: b.postcode, myself_sites: b.sites.join(','), myself_n_sessions: b.n_sessions, note: '' };
    })
    .sort((x, y) => tierRank(x.tier) - tierRank(y.tier) || Number(y.score || 0) - Number(x.score || 0) || x.website_firestore_id.localeCompare(y.website_firestore_id));

  // Two MySelf codes linked to one website person: MySelf should treat the weaker as an alias of the stronger.
  const corrections = [];
  for (const [w, ms] of linkedW) {
    if (ms.length < 2) continue;
    const exact = wp.get(w).myself_id;
    const ordered = [...ms].sort((a, b) => (a === exact ? -1 : b === exact ? 1 : Number(myself.get(b).n_sessions || 0) - Number(myself.get(a).n_sessions || 0) || a.localeCompare(b)));
    for (const wrong of ordered.slice(1)) corrections.push({ wrong_code: wrong, right_code: ordered[0], reason: `Both are website record ${wp.get(w).participant_id || w}${ordered[0] === exact ? '; the right code is the one their name and date of birth give' : '; the right code has the most sittings'}` });
  }

  const unmatchedWebsite = [...wp.values()].filter((p) => !linkedW.has(p.firestore_id)).map((p) => ({ participant_id: p.participant_id, firestore_id: p.firestore_id, first_name: p.first_name, last_name: p.last_name, date_of_birth: p.date_of_birth, school_id: p.school_id, myself_id: p.myself_id, in_review: reviewRows.some((r) => r.website_firestore_id === p.firestore_id) }));
  const unmatchedMyself = [...myself.values()].filter((m) => !linkedM.has(m.myself_id)).map((m) => ({ myself_id: m.myself_id, given_name: m.given_name, family_name: m.family_name, date_of_birth: m.date_of_birth, sites: m.sites.join(','), n_sessions: m.n_sessions, first_seen: m.first_seen, in_review: reviewRows.some((r) => r.myself_id === m.myself_id) }));
  links.sort((a, b) => String(a.website_participant_id || 'zzz').localeCompare(String(b.website_participant_id || 'zzz')) || a.myself_id.localeCompare(b.myself_id));
  return { links, review: reviewRows, corrections, unmatchedWebsite, unmatchedMyself };
}

const tierRank = (t) => (t === 'exact' ? 0 : t.startsWith('variant') ? 1 : t.startsWith('upn') ? 2 : 3);

/* ── outputs ───────────────────────────────────────────────────────────── */

export const LINK_COLUMNS = ['website_participant_id', 'website_firestore_id', 'myself_id', 'tier', 'how'];
export const REVIEW_COLUMNS = ['review_id', 'decision', 'tier', 'score', 'reason', 'website_participant_id', 'website_firestore_id', 'website_first_name', 'website_last_name', 'website_date_of_birth', 'website_school_id', 'website_postcode', 'website_myself_id', 'myself_id', 'myself_given_name', 'myself_family_name', 'myself_date_of_birth', 'myself_postcode', 'myself_sites', 'myself_n_sessions', 'note'];
const UNMATCHED_W_COLUMNS = ['participant_id', 'firestore_id', 'first_name', 'last_name', 'date_of_birth', 'school_id', 'myself_id', 'in_review'];
const UNMATCHED_M_COLUMNS = ['myself_id', 'given_name', 'family_name', 'date_of_birth', 'sites', 'n_sessions', 'first_seen', 'in_review'];
const CORRECTION_COLUMNS = ['wrong_code', 'right_code', 'reason'];

export function summaryText(r, { websiteN, myselfN, withNames, decisionsN, ranAt }) {
  const count = (pred) => r.links.filter(pred).length;
  const lines = [
    `MySelf linkage, ${ranAt}`,
    '',
    `Website records:            ${websiteN}`,
    `MySelf records:             ${myselfN}${withNames ? ` (${withNames} with names from the identifier file)` : ' (no identifier file: no fuzzy matching)'}`,
    `Decisions on file:          ${decisionsN}`,
    '',
    `Linked:                     ${r.links.length}`,
    `  exact ID                  ${count((l) => l.tier === 'exact')}`,
    `  variant ID                ${count((l) => l.tier.startsWith('variant'))}`,
    ...[...new Set(r.links.filter((l) => l.tier.startsWith('variant')).map((l) => l.tier))].sort().map((t) => `    ${t.slice(8).padEnd(24)}${count((l) => l.tier === t)}`),
    `  UPN                       ${count((l) => l.tier.startsWith('upn'))}`,
    `  decided by a person       ${count((l) => l.tier === 'decision')}`,
    `To review:                  ${r.review.length}${r.review.length ? '  (review.tsv: put link or reject in the decision column, then run again)' : ''}`,
    `  of which fuzzy            ${r.review.filter((x) => x.tier === 'fuzzy').length}`,
    `  of which ambiguous        ${r.review.filter((x) => x.reason.includes('ambiguous')).length}`,
    `Website not linked:         ${r.unmatchedWebsite.length}`,
    `MySelf not linked:          ${r.unmatchedMyself.length}`,
    `MySelf corrections to make: ${r.corrections.length}${r.corrections.length ? '  (myself_corrections.tsv: enter each in MySelf, Linkage screen)' : ''}`,
  ];
  return lines.join('\n') + '\n';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A page for deciding the review list in a browser; it saves a decisions-<time>.tsv to put in the output folder. Holds names: keep it with the other files. */
export function reviewHtml(rows, ranAt) {
  const cards = rows.map((r) => `<tr data-w="${esc(r.website_firestore_id)}" data-m="${esc(r.myself_id)}">
<td><b>${esc(r.tier)}</b>${r.score !== '' ? `<br>${esc(r.score)}` : ''}<br><small>${esc(r.reason)}</small></td>
<td>${esc(r.website_first_name)} ${esc(r.website_last_name)}<br>${esc(r.website_date_of_birth)}<br><small>${esc(r.website_participant_id || r.website_firestore_id)} · ${esc(r.website_school_id)} · ${esc(r.website_postcode)}</small></td>
<td>${esc(r.myself_given_name) || '<i>no name</i>'} ${esc(r.myself_family_name)}<br>${esc(r.myself_date_of_birth)}<br><small>${esc(r.myself_id)} · ${esc(r.myself_sites)} · ${esc(r.myself_postcode)} · ${esc(r.myself_n_sessions)} sittings</small></td>
<td><label><input type="radio" name="${esc(r.review_id)}" value="link"> Same person</label><br><label><input type="radio" name="${esc(r.review_id)}" value="reject"> Not the same</label><br><input name="note-${esc(r.review_id)}" placeholder="note"></td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MySelf linkage review</title>
<style>:root{color-scheme:light dark}body{font:15px/1.4 system-ui,sans-serif;margin:16px;background:Canvas;color:CanvasText}table{border-collapse:collapse;width:100%}td{border-top:1px solid #8884;padding:8px;vertical-align:top}small{opacity:.75}button{font:inherit;padding:8px 14px;margin:12px 0}</style></head><body>
<h1>MySelf linkage review</h1><p>${rows.length} pairs from the run of ${esc(ranAt)}. Choose for each, then save: the file goes in the linkage folder and the next run reads it. This page holds names and dates of birth: keep it with the identifying files.</p>
<button id="save">Save decisions</button>
<table><thead><tr><td>Why</td><td>Website</td><td>MySelf</td><td>Decision</td></tr></thead><tbody>
${cards}
</tbody></table>
<script>
document.getElementById('save').onclick = () => {
  const today = new Date().toISOString().slice(0, 10);
  const lines = ['website_firestore_id\\tmyself_id\\tdecision\\tdecided_on\\tnote'];
  for (const tr of document.querySelectorAll('tbody tr')) {
    const pick = tr.querySelector('input[type=radio]:checked');
    if (!pick) continue;
    const note = (tr.querySelector('input[name^=note-]').value || '').replace(/[\\t\\r\\n]+/g, ' ');
    lines.push([tr.dataset.w, tr.dataset.m, pick.value, today, note].join('\\t'));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\\n') + '\\n'], { type: 'text/tab-separated-values' }));
  a.download = 'decisions-' + new Date().toISOString().replace(/\\D/g, '').slice(0, 12) + '.tsv';
  a.click();
};
</script></body></html>
`;
}

/* ── running ───────────────────────────────────────────────────────────── */

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (k === 'html' || k === 'help') o[k] = true;
    else o[k] = argv[++i];
  }
  return o;
}

const HELP = `Links website records to MySelf survey records.

  --website DIR       the export's schools/ folder (holds identifying/ and upn-uploads/)
  --myself FILE       MySelf's BIDS participants.tsv
  --identifiers FILE  MySelf's identifier CSV (Linkage screen, after unlocking); needed for fuzzy and UPN matching
  --site-map FILE     optional TSV: site_code, school_id (MySelf site -> website school), to keep fuzzy matches within a school
  --out DIR           where to write; keep it with the identifying files (decisions.tsv lives here)
  --html              also write review.html
`;

export function run(o, now = new Date()) {
  if (o.help || !o.website || !o.myself || !o.out) throw new Error(HELP);
  const today = now.toISOString().slice(0, 10);
  const ident = join(o.website, 'identifying');
  const keyFile = join(ident, 'participants_key.tsv');
  if (!existsSync(keyFile)) throw new Error(`No ${keyFile}: --website should be the export's schools/ folder.`);
  const upnDir = join(o.website, 'upn-uploads');
  const website = loadWebsite({
    key: parseTsv(read(keyFile)),
    candidates: readTsvIf(join(ident, 'myself_candidate_ids.tsv')),
    upnMatches: readTsvIf(join(upnDir, 'upn_matches.tsv')),
    pupils: findFiles(upnDir, '_pupils.tsv').flatMap((f) => parseTsv(read(f))),
  });
  const myself = loadMyself({ participants: parseTsv(read(o.myself)), identifiers: o.identifiers ? parseCsv(read(o.identifiers)) : [] });
  const siteMap = new Map(readTsvIf(o['site-map']).map((r) => [r.site_code, r.school_id]));
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  const decisions = gatherDecisions(out, today);
  const r = match({ website, myself, decisions, siteMap });
  const ranAt = now.toISOString().slice(0, 16).replace('T', ' ');
  writeFileSync(join(out, 'decisions.tsv'), toTsv(decisions, DECISION_COLUMNS));
  writeFileSync(join(out, 'links.tsv'), toTsv(r.links, LINK_COLUMNS));
  writeFileSync(join(out, 'review.tsv'), toTsv(r.review, REVIEW_COLUMNS));
  writeFileSync(join(out, 'unmatched_website.tsv'), toTsv(r.unmatchedWebsite, UNMATCHED_W_COLUMNS));
  writeFileSync(join(out, 'unmatched_myself.tsv'), toTsv(r.unmatchedMyself, UNMATCHED_M_COLUMNS));
  writeFileSync(join(out, 'myself_corrections.tsv'), toTsv(r.corrections, CORRECTION_COLUMNS));
  const summary = summaryText(r, { websiteN: website.people.size, myselfN: myself.size, withNames: [...myself.values()].filter((m) => m.given_name).length, decisionsN: decisions.length, ranAt });
  writeFileSync(join(out, 'summary.txt'), summary);
  if (o.html) writeFileSync(join(out, 'review.html'), reviewHtml(r.review, ranAt));
  return { summary, result: r, out };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { summary, out } = run(args(process.argv.slice(2)));
    process.stdout.write(summary + `\nFiles in ${out}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  }
}
