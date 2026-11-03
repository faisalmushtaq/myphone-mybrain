import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import { toCsv } from './Reports';
import { Loading, useLoad } from './TeamViews';
import { DAY_ROLE_LABEL, LEVEL_LABEL, saveFile, shortDate, todayIso, VISIT_STATUS_LABEL, type Availability, type DayRole, type Level, type Role, type StatusTag, type VisitStatus } from './types';

/**
 * The week at a glance (5 November 2026): one row per person, one column per
 * day, each cell saying whether they are free, where they are placed and
 * whether they could be booked; each day's header says which visits run and
 * what they still need. For the project manager and the research team.
 */

interface GridPerson {
  uid: string;
  name: string;
  role: Role;
  level: Level | null;
  capabilities: DayRole[];
  tagIds: string[];
}
interface GridPlace {
  visitId: string;
  school: string;
  role: DayRole;
  status: 'offered' | 'confirmed';
  timeNote: string | null;
}
interface GridCell {
  date: string;
  value: Availability | null;
  note: string;
  places: GridPlace[];
  notReady: string[];
}
interface Needs {
  eeg: number;
  copro: number;
}
interface GridDayVisit {
  visitId: string;
  schoolShort: string;
  schoolName: string;
  status: VisitStatus;
  start: string;
  end: string;
  need: Needs;
  confirmed: Needs;
  offered: Needs;
  short: boolean;
}
interface GridDay {
  date: string;
  visits: GridDayVisit[];
  available: number;
  availableEeg: number;
  availableCopro: number;
  maybe: number;
  noAnswer: number;
  short: boolean;
}
interface GridRow {
  person: GridPerson;
  cells: GridCell[];
  availableDays: number;
}
interface Grid {
  weekStart: string;
  dates: string[];
  days: GridDay[];
  rows: GridRow[];
  tags: StatusTag[];
  today: string;
}

/** The short label in a cell: words as well as colour. */
const CELL_LABEL: Record<Availability, string> = { all: 'All day', am: 'Morning', pm: 'Afternoon', maybe: 'Maybe', no: 'Can’t' };
const FREE = new Set<Availability>(['all', 'am', 'pm']);
const JOB_SHORT: Record<DayRole, string> = { eeg: 'EEG', copro: 'Co-pro' };

/** The Monday of the week a date falls in, and moving by weeks. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekWords = (monday: string) => `${shortDate(monday)} to ${shortDate(plusDays(monday, 6))}`;

/** One place in a cell: "GSAL · EEG", saying when it is only offered, with any time note. */
function placeText(p: GridPlace): string {
  return `${p.school} · ${JOB_SHORT[p.role]}${p.status === 'offered' ? ' (offered)' : ''}${p.timeNote ? ` (${p.timeNote})` : ''}`;
}

/** What a cell says, in words, for the CSV and for screen readers. */
export function cellWords(c: GridCell): string {
  return [c.value ? CELL_LABEL[c.value] : 'No answer', ...c.places.map(placeText), c.notReady.length ? `Not ready: ${c.notReady.join('; ')}` : '', c.note ? `Note: ${c.note}` : ''].filter(Boolean).join(' · ');
}

type Sort = 'name' | 'level' | 'available';

export function AvailabilityGrid({ go }: { go: (hash: string) => void }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIso()));
  const [includeTeam, setIncludeTeam] = useState(false);
  const [weekend, setWeekend] = useState(false);
  const [tag, setTag] = useState('');
  const [level, setLevel] = useState('');
  const [job, setJob] = useState('');
  const [readyOnly, setReadyOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('name');
  // On a phone, one day at a time reads more easily than seven narrow columns.
  const [narrow] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 40rem)').matches));
  const [oneDay, setOneDay] = useState(narrow);
  const [day, setDay] = useState(0);
  const { value, error } = useLoad<Grid>('availability-grid', { weekStart, includeTeam });

  // Weekends start hidden; the day picker stays on a shown day.
  const shown = useMemo(() => (value ? value.dates.map((d, i) => ({ d, i })).filter(({ i }) => weekend || i < 5) : []), [value, weekend]);
  useEffect(() => {
    if (value && !shown.some((s) => s.i === day)) setDay(shown[0]?.i ?? 0);
  }, [value, shown, day]);
  const columns = oneDay ? shown.filter((s) => s.i === day) : shown;

  const rows = useMemo(() => {
    if (!value) return [];
    const freeOnShown = (r: GridRow) => columns.filter(({ i }) => r.cells[i].value && FREE.has(r.cells[i].value!)).length;
    return value.rows
      .filter((r) => !tag || r.person.tagIds.includes(tag))
      .filter((r) => !level || String(r.person.level ?? '') === level)
      .filter((r) => !job || r.person.capabilities.includes(job as DayRole))
      .filter((r) => !readyOnly || columns.every(({ i }) => !r.cells[i].notReady.length))
      .filter((r) => !availableOnly || freeOnShown(r) > 0)
      .sort((a, b) => (sort === 'level' ? (b.person.level ?? 0) - (a.person.level ?? 0) : sort === 'available' ? freeOnShown(b) - freeOnShown(a) : 0) || a.person.name.localeCompare(b.person.name));
  }, [value, tag, level, job, readyOnly, availableOnly, sort, columns]);

  const download = () => {
    if (!value) return;
    const header = ['Name', 'Role', 'Level', 'Jobs', ...shown.map(({ d }) => shortDate(d))];
    const body = rows.map((r) => [r.person.name, r.person.role === 'ra' ? 'Research assistant' : 'Research team', r.person.level ? `${r.person.level} ${LEVEL_LABEL[r.person.level]}` : '', r.person.capabilities.map((c) => DAY_ROLE_LABEL[c]).join(' and '), ...shown.map(({ i }) => cellWords(r.cells[i]))]);
    const totals = ['Free (research assistants)', '', '', '', ...shown.map(({ i }) => { const d = value.days[i]; return `${d.available} (EEG ${d.availableEeg}, Co-pro ${d.availableCopro}); maybe ${d.maybe}`; })];
    const visits = ['Visits', '', '', '', ...shown.map(({ i }) => value.days[i].visits.map((v) => `${v.schoolShort} EEG ${v.confirmed.eeg}/${v.need.eeg} Co-pro ${v.confirmed.copro}/${v.need.copro}`).join('; '))];
    saveFile(`availability-${value.weekStart}.csv`, toCsv(header, [...body, totals, visits]), 'text/csv;charset=utf-8');
  };

  return (
    <div className="mpmb-tools__section">
      <div className="mpmb-portal__gridbar">
        <div className="mpmb-actions" role="group" aria-label="Which week">
          <Button variant="secondary" onClick={() => setWeekStart(plusDays(weekStart, -7))}>
            ← Previous week
          </Button>
          <Button variant="secondary" onClick={() => setWeekStart(mondayOf(todayIso()))}>
            This week
          </Button>
          <Button variant="secondary" onClick={() => setWeekStart(plusDays(weekStart, 7))}>
            Next week →
          </Button>
        </div>
        <TextField id="grid-jump" label="Go to the week of" type="date" value={weekStart} onChange={(e) => e.target.value && setWeekStart(mondayOf(e.target.value))} />
      </div>
      <h2 className="mpmb-h2" aria-live="polite">
        Week of {weekWords(weekStart)}
      </h2>

      <details className="mpmb-portal__gridfilters" open={!narrow}>
        <summary>Filters and view</summary>
        <div className="mpmb-tools__grid">
          <SelectField id="grid-tag" label="Status" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Everyone" options={(value?.tags ?? []).map((t) => ({ value: t.id, label: t.label }))} />
          <SelectField id="grid-level" label="Level" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Any level" options={([4, 3, 2, 1] as Level[]).map((l) => ({ value: String(l), label: `${l}: ${LEVEL_LABEL[l]}` }))} />
          <SelectField id="grid-job" label="Can do" value={job} onChange={(e) => setJob(e.target.value)} placeholder="Any job" options={[{ value: 'eeg', label: 'EEG' }, { value: 'copro', label: 'Co-production' }]} />
          <SelectField id="grid-sort" label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)} options={[{ value: 'name', label: 'Name' }, { value: 'level', label: 'Level, highest first' }, { value: 'available', label: 'Most available' }]} />
        </div>
        <div className="mpmb-portal__gridtoggles">
          <label className="mpmb-portal__inline">
            <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} /> Ready only
          </label>
          <label className="mpmb-portal__inline">
            <input type="checkbox" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} /> Available only
          </label>
          <label className="mpmb-portal__inline">
            <input type="checkbox" checked={weekend} onChange={(e) => setWeekend(e.target.checked)} /> Show the weekend
          </label>
          <label className="mpmb-portal__inline">
            <input type="checkbox" checked={includeTeam} onChange={(e) => setIncludeTeam(e.target.checked)} /> Include the research team
          </label>
          <label className="mpmb-portal__inline">
            <input type="checkbox" checked={oneDay} onChange={(e) => setOneDay(e.target.checked)} /> One day at a time
          </label>
        </div>
      </details>

      <Loading error={error}>
        {!value ? (
          <p>Loading…</p>
        ) : (
          <>
            {oneDay && (
              <div className="mpmb-actions" role="group" aria-label="Which day">
                {shown.map(({ d, i }) => (
                  <Button key={d} variant={i === day ? 'primary' : 'secondary'} aria-pressed={i === day} onClick={() => setDay(i)}>
                    {shortDate(d)}
                  </Button>
                ))}
              </div>
            )}
            <p className="mpmb-hint">
              {rows.length} {rows.length === 1 ? 'person' : 'people'}. Totals count research assistants. “Not ready” means they could not be booked that day: hover or tap it for why.
            </p>
            <div className="mpmb-portal__gridwrap">
              <table className="mpmb-portal__grid">
                <thead>
                  <tr>
                    <th scope="col" className="mpmb-portal__gridname">
                      Person
                    </th>
                    {columns.map(({ d, i }) => {
                      const g = value.days[i];
                      return (
                        <th key={d} scope="col" className={`${i >= 5 ? 'is-weekend' : ''}${g.short ? ' is-short' : ''}${d === value.today ? ' is-today' : ''}`}>
                          <span className="mpmb-portal__griddate">{shortDate(d)}</span>
                          {g.visits.map((v) => (
                            <button key={v.visitId} type="button" className={`mpmb-portal__gridvisit${v.short ? ' is-short' : ''}`} title={`${v.schoolName}, ${v.start}–${v.end} · ${VISIT_STATUS_LABEL[v.status]}`} onClick={() => go(`#visit/${v.visitId}`)}>
                              <strong>{v.schoolShort}</strong> {v.status === 'provisional' ? 'provisional' : v.status === 'draft' ? 'draft' : ''}
                              <span>
                                EEG {v.confirmed.eeg}/{v.need.eeg} · Co-pro {v.confirmed.copro}/{v.need.copro}
                              </span>
                              {(v.offered.eeg > 0 || v.offered.copro > 0) && <span className="mpmb-portal__gridoffered">{v.offered.eeg + v.offered.copro} offered</span>}
                            </button>
                          ))}
                          <span className="mpmb-portal__gridtotals">
                            Free {g.available} (EEG {g.availableEeg} · Co-pro {g.availableCopro})
                            {g.maybe ? ` · Maybe ${g.maybe}` : ''}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.person.uid}>
                      <th scope="row" className="mpmb-portal__gridname">
                        <button type="button" className="mpmb-portal__gridperson" onClick={() => go(`#person/${r.person.uid}`)}>
                          {r.person.name}
                        </button>
                        <span className="mpmb-portal__gridmeta">
                          {r.person.level ? <span className="mpmb-portal__gridlevel" title={LEVEL_LABEL[r.person.level]}>L{r.person.level}</span> : null}
                          {r.person.capabilities.map((c) => (
                            <span key={c} className={`mpmb-portal__gridjob mpmb-portal__gridjob--${c}`} title={DAY_ROLE_LABEL[c]}>
                              {JOB_SHORT[c]}
                            </span>
                          ))}
                          {r.person.role !== 'ra' && <span className="mpmb-portal__gridjob">Team</span>}
                        </span>
                      </th>
                      {columns.map(({ d, i }) => {
                        const c = r.cells[i];
                        return (
                          <td key={d} className={`mpmb-portal__gridcell is-${c.value ?? 'none'}${i >= 5 ? ' is-weekend' : ''}${c.places.some((p) => p.status === 'confirmed') ? ' is-placed' : ''}`} title={cellWords(c)}>
                            <span className="mpmb-portal__gridstate">{c.value ? CELL_LABEL[c.value] : 'No answer'}</span>
                            {c.places.map((p) => (
                              <span key={`${p.visitId}${p.role}`} className={`mpmb-portal__gridplace is-${p.status}`}>
                                {placeText(p)}
                              </span>
                            ))}
                            {c.notReady.length > 0 && (
                              <details className="mpmb-portal__flagwrap">
                                <summary className="mpmb-portal__flag" title={c.notReady.join('; ')}>Not ready</summary>
                                <span className="mpmb-portal__flagwhy">{c.notReady.join('; ')}</span>
                              </details>
                            )}
                            {c.note && <span className="mpmb-portal__gridnote">{c.note}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && <p>Nobody matches these filters.</p>}
            <div className="mpmb-actions">
              <Button variant="secondary" onClick={download}>
                Download this week (CSV)
              </Button>
            </div>
          </>
        )}
      </Loading>
    </div>
  );
}
