import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Button } from '../../components/ui/Button';
import { announce } from '../../lib/announce';
import { flatten, gridRows, optionsFor, problemWith, shown, type Answer, type Answers, type Placed, type SurveyItem, type SurveySection } from '../survey/engine';

interface Props {
  sections: SurveySection[];
  answers: Answers;
  position: number;
  ageNow: number | null;
  /** Saves as it goes: the answers and where they are. */
  onChange: (answers: Answers, position: number) => void;
  onDone: (answers: Answers) => void;
  onLater: () => void;
}

/** Choices as big radio rows, with a text box for an "other" answer. */
function SingleChoice({ item, ageNow, value, onChange }: { item: SurveyItem; ageNow: number | null; value: Answer | undefined; onChange: (a: Answer) => void }) {
  const chosen = value?.kind === 'code' ? value : null;
  return (
    <div className="ny-q__options" role="radiogroup" aria-labelledby="ny-q-stem">
      {optionsFor(item, ageNow).map((o) => (
        <label key={o.code} className={`ny-q__option${chosen?.code === o.code ? ' is-selected' : ''}`}>
          <input type="radio" name={item.variable} checked={chosen?.code === o.code} onChange={() => onChange({ kind: 'code', code: o.code, text: o.textEntry ? (chosen?.text ?? '') : undefined })} />
          <span>{o.label}</span>
        </label>
      ))}
      {chosen && item.options?.find((o) => o.code === chosen.code)?.textEntry && <input className="mpmb-input" aria-label="Your answer" maxLength={200} value={chosen.text ?? ''} onChange={(e) => onChange({ ...chosen, text: e.target.value })} />}
    </div>
  );
}

function MultiChoice({ item, value, onChange }: { item: SurveyItem; value: Answer | undefined; onChange: (a: Answer) => void }) {
  const now = value?.kind === 'codes' ? value : { kind: 'codes' as const, codes: [] as number[], text: '' };
  const other = item.options?.find((o) => o.textEntry && now.codes.includes(o.code));
  return (
    <div className="ny-q__options">
      {(item.options ?? []).map((o) => (
        <label key={o.code} className={`ny-q__option${now.codes.includes(o.code) ? ' is-selected' : ''}`}>
          <input type="checkbox" checked={now.codes.includes(o.code)} onChange={(e) => onChange({ ...now, codes: e.target.checked ? [...now.codes, o.code] : now.codes.filter((c) => c !== o.code) })} />
          <span>{o.label}</span>
        </label>
      ))}
      {other && <input className="mpmb-input" aria-label={`${other.label}: your answer`} maxLength={200} value={now.text ?? ''} onChange={(e) => onChange({ ...now, text: e.target.value })} />}
    </div>
  );
}

function Steps({ count, from, value, top, bottom, onChange, vertical }: { count: number; from: number; value: number | null; top?: string; bottom?: string; onChange: (n: number) => void; vertical?: boolean }) {
  const values = Array.from({ length: count }, (_, i) => from + i);
  const ordered = vertical ? [...values].reverse() : values;
  return (
    <div className={vertical ? 'ny-q__ladder' : 'ny-q__scale'}>
      {(vertical ? top : bottom) && <p className="mpmb-hint">{vertical ? top : bottom}</p>}
      <div className="ny-q__steps" role="radiogroup" aria-labelledby="ny-q-stem">
        {ordered.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className={`ny-q__step${value === n ? ' is-selected' : ''}`} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
      {(vertical ? bottom : top) && <p className="mpmb-hint ny-q__end">{vertical ? bottom : top}</p>}
    </div>
  );
}

function SortApps({ item, value, onChange }: { item: SurveyItem; value: Answer | undefined; onChange: (a: Answer) => void }) {
  const [haveKey, notKey] = [item.groups?.[0]?.key ?? 'have', item.groups?.[1]?.key ?? 'dont_have'];
  const have = value?.kind === 'groups' ? (value.groups[haveKey] ?? []) : [];
  const all = (item.options ?? []).map((o) => o.code);
  const toggle = (code: number) => {
    const next = have.includes(code) ? have.filter((c) => c !== code) : [...have, code];
    onChange({ kind: 'groups', groups: { [haveKey]: next, [notKey]: all.filter((c) => !next.includes(c)) } });
  };
  return (
    <>
      <p className="mpmb-hint">{item.groups?.[0]?.ranked ? `Tap each app you have, starting with the one you use most. (${item.groups?.[0]?.label})` : 'Tap each app you have.'}</p>
      <div className="ny-q__options">
        {(item.options ?? []).map((o) => (
          <label key={o.code} className={`ny-q__option${have.includes(o.code) ? ' is-selected' : ''}`}>
            <input type="checkbox" checked={have.includes(o.code)} onChange={() => toggle(o.code)} />
            <span>
              {o.label}
              {have.includes(o.code) && item.groups?.[0]?.ranked ? <span className="ny-q__rank"> {have.indexOf(o.code) + 1}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </>
  );
}

function TimeGrid({ item, all, answers, value, onChange }: { item: SurveyItem; all: Placed[]; answers: Answers; value: Answer | undefined; onChange: (a: Answer) => void }) {
  const rows = gridRows(item, all, answers);
  const now = value?.kind === 'minutes' ? value.rows : {};
  const set = (code: number, h: string, m: string) => onChange({ kind: 'minutes', rows: { ...Object.fromEntries(rows.map((r) => [String(r.code), now[String(r.code)] ?? 0])), [String(code)]: Math.min(1440, (Number(h) || 0) * 60 + (Number(m) || 0)) } });
  const total = rows.reduce((n, r) => n + (now[String(r.code)] ?? 0), 0);
  return (
    <div className="ny-q__grid">
      {rows.map((r) => {
        const mins = now[String(r.code)] ?? 0;
        return (
          <div key={r.code} className="ny-q__gridrow">
            <span>{r.label}</span>
            <label>
              <input className="mpmb-input" inputMode="numeric" aria-label={`${r.label}: hours`} value={value ? String(Math.floor(mins / 60)) : ''} onChange={(e) => set(r.code, e.target.value.replace(/\D/g, ''), String(mins % 60))} /> h
            </label>
            <label>
              <input className="mpmb-input" inputMode="numeric" aria-label={`${r.label}: minutes`} value={value ? String(mins % 60) : ''} onChange={(e) => set(r.code, String(Math.floor(mins / 60)), e.target.value.replace(/\D/g, ''))} /> min
            </label>
          </div>
        );
      })}
      <p className="mpmb-hint">
        Total: {Math.floor(total / 60)} h {total % 60} min a day
      </p>
    </div>
  );
}

/**
 * The questionnaires, one question at a time (as in the break study's MySelf
 * surveys): the section's name, the question, its instructions, and Back and
 * Next. Answers are saved as they go, so the visit can be finished later.
 */
export function Survey({ sections, answers: initial, position, ageNow, onChange, onDone, onLater }: Props) {
  const all = useMemo(() => flatten(sections), [sections]);
  const [answers, setAnswers] = useState<Answers>(initial);
  const [at, setAt] = useState(() => Math.min(position, all.length - 1));
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmHigh, setConfirmHigh] = useState(false);
  const stemRef = useRef<HTMLHeadingElement>(null);

  // Questions hidden by an earlier answer are passed over.
  const firstShownFrom = (i: number, step: 1 | -1) => {
    for (let j = i; j >= 0 && j < all.length; j += step) if (shown(all[j], all, answers)) return j;
    return -1;
  };
  const current = all[at];
  useEffect(() => {
    if (current && !shown(current, all, answers)) {
      const j = firstShownFrom(at, 1);
      if (j >= 0) setAt(j);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  useEffect(() => {
    stemRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    setProblem(null);
    setConfirmHigh(false);
  }, [at]);

  if (!current) return null;
  const { item, block, section } = current;
  const value = answers[item.variable];
  const visible = all.filter((p) => shown(p, all, answers));
  const number = visible.indexOf(current) + 1;
  const firstOfBlock = all.findIndex((p) => p.block === block && shown(p, all, answers)) === at;
  const firstOfSection = all.findIndex((p) => p.section === section && shown(p, all, answers)) === at;

  const set = (a: Answer) => {
    const next = { ...answers, [item.variable]: a };
    setAnswers(next);
    setProblem(null);
    onChange(next, at);
  };
  const go = (step: 1 | -1, withAnswers = answers) => {
    const j = firstShownFrom(at + step, step);
    if (j < 0) {
      if (step === 1) onDone(withAnswers);
      return;
    }
    setAt(j);
    onChange(withAnswers, j);
  };
  const next = () => {
    const p = problemWith(item, value);
    if (p) {
      setProblem(p);
      announce(p);
      return;
    }
    if (item.responseType === 'numeric' && item.confirmAbove !== undefined && value?.kind === 'number' && value.value > item.confirmAbove && !confirmHigh) {
      setConfirmHigh(true);
      setProblem(`${value.value} is a lot. If that’s right, press Next again.`);
      return;
    }
    // A question not answered and not required is recorded as skipped.
    if (!value && item.responseType !== 'info') {
      const withSkip = { ...answers, [item.variable]: { kind: 'skipped' as const } };
      setAnswers(withSkip);
      go(1, withSkip);
      return;
    }
    go(1);
  };

  let input: ReactElement | null = null;
  switch (item.responseType) {
    case 'single_choice':
      input = <SingleChoice item={item} ageNow={ageNow} value={value} onChange={set} />;
      break;
    case 'multi_choice':
      input = <MultiChoice item={item} value={value} onChange={set} />;
      break;
    case 'ladder':
      input = <Steps vertical count={item.rungs ?? 10} from={item.lowestValue ?? 1} top={item.topLabel} bottom={item.bottomLabel} value={value?.kind === 'number' ? value.value : null} onChange={(n) => set({ kind: 'number', value: n })} />;
      break;
    case 'scale_0_10':
      input = <Steps count={11} from={0} bottom={item.ends?.[0]} top={item.ends?.[1]} value={value?.kind === 'number' ? value.value : null} onChange={(n) => set({ kind: 'number', value: n })} />;
      break;
    case 'numeric':
      input = (
        <label className="ny-q__number">
          <input className="mpmb-input mpmb-input--short" inputMode="numeric" aria-labelledby="ny-q-stem" value={value?.kind === 'number' ? String(value.value) : ''} onChange={(e) => (e.target.value.trim() === '' ? set({ kind: 'skipped' }) : set({ kind: 'number', value: Number(e.target.value.replace(',', '.')) }))} /> {item.unitLabel ?? ''}
        </label>
      );
      break;
    case 'text_short':
      input = <input className="mpmb-input" aria-labelledby="ny-q-stem" maxLength={item.maxChars ?? 200} value={value?.kind === 'text' ? value.value : ''} onChange={(e) => set({ kind: 'text', value: e.target.value })} />;
      break;
    case 'text_long':
      input = <textarea className="mpmb-input mpmb-input--area" rows={4} aria-labelledby="ny-q-stem" maxLength={item.maxChars ?? 500} value={value?.kind === 'text' ? value.value : ''} onChange={(e) => set({ kind: 'text', value: e.target.value })} />;
      break;
    case 'rank_group':
      input = <SortApps item={item} value={value} onChange={set} />;
      break;
    case 'time_grid':
      input = <TimeGrid item={item} all={all} answers={answers} value={value} onChange={set} />;
      break;
    default:
      input = null;
  }

  return (
    <div className="ny-q">
      <p className="ny-q__where">
        {section.title} <span className="ny-q__count">· {number} of {visible.length}</span>
      </p>
      <div className="ny-stepper__bar" aria-hidden="true">
        <span style={{ width: `${(number / visible.length) * 100}%` }} />
      </div>
      {firstOfSection && section.transition && <p className="ny-q__transition">{section.transition}</p>}
      {firstOfBlock && block.instructions && <p className="ny-q__instructions">{block.instructions}</p>}
      <h2 className="mpmb-h2 ny-q__stem" id="ny-q-stem" tabIndex={-1} ref={stemRef}>
        {item.stem.text}
      </h2>
      {item.lede?.text && item.lede.text.split('\n\n').map((para) => (
        <p key={para} className="mpmb-hint ny-q__lede">
          {para}
        </p>
      ))}
      {input}
      {problem && (
        <p className="mpmb-error" role="alert">
          {problem}
        </p>
      )}
      <div className="mpmb-actions">
        <Button variant="primary" arrow onClick={next}>
          Next
        </Button>
        {at > 0 && (
          <Button variant="secondary" onClick={() => go(-1)}>
            Back
          </Button>
        )}
        {item.allowDecline && item.responseType !== 'info' && (
          <Button
            variant="link"
            onClick={() => {
              const withDecline = { ...answers, [item.variable]: { kind: 'declined' as const } };
              setAnswers(withDecline);
              go(1, withDecline);
            }}
          >
            Prefer not to say
          </Button>
        )}
      </div>
      <p className="ny-q__later">
        <Button variant="link" onClick={onLater}>
          Save and finish later
        </Button>
      </p>
    </div>
  );
}
