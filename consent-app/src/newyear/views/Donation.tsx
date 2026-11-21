import { useEffect, useRef, useState, type FormEvent } from 'react';
import type JSZip from 'jszip';
import { ImageCapture } from '../../components/ImageCapture';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ErrorSummary } from '../../components/ui/ErrorSummary';
import { CheckboxField, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { loadImage, processImage } from '../../lib/image';
import type { FieldError } from '../../lib/validation';
import { alwaysRemoved, categories, cleanArchive, detectPlatforms, formatBytes, platformNames, type CategoryId, type CleanResult, type Platform } from '../../lab/cleaner';
import { canChooseFolder, readDownload, type ChosenFile } from '../../lab/download';
import { androidSteps, apps as dataApps, jumpTo, phones, screenTimeIphone, Steps } from '../../lab/guideSteps';
import { addDays, daysBetween, isIsoDate, type IsoDate } from '../dates';
import type { AppDataRecord, DataPlatform, Participant, PlatformDonation, ScreenshotImage, ScreenshotRecord } from '../model';
import { NyDraft } from '../NyShell';
import { chosenNames, hasChosen, listText } from '../targets';

/**
 * The online study's donations, made with the lab study's own instructions
 * and mechanisms (the PI, 21 November 2026): the same "Which phone do you
 * have?" steps with their illustrations, the same screenshot picker (camera
 * and location details removed on the device), and the same reading and
 * cleaning of the TikTok, YouTube and Instagram downloads on the device, with
 * the same choices of what to share. In the preview nothing is sent: the
 * screenshots are only looked at, and the cleaned downloads are summarised.
 */

const MAX_SHOTS = 8;
/** The longest stretch one set of screenshots can cover: phones keep a few weeks at most. */
const MAX_COVER_DAYS = 28;

interface Shot extends ScreenshotImage {
  url: string;
}

export function ScreenTimeShots({ participant: p, kind, defaultFrom, today, onSave, onLater }: { participant: Participant; kind: 'start' | 'later'; defaultFrom: IsoDate; today: IsoDate; onSave: (shot: ScreenshotRecord) => void; onLater: () => void }) {
  const [phone, setPhone] = useState<'iphone' | 'android' | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const yesterday = addDays(today, -1);
  const [from, setFrom] = useState<IsoDate>(defaultFrom > yesterday ? yesterday : defaultFrom);
  const [to, setTo] = useState<IsoDate>(yesterday);
  const [chosen, setChosen] = useState('');
  const [total, setTotal] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const names = listText(chosenNames(p));
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const choosePhone = (id: 'iphone' | 'android') => {
    setPhone(id);
    window.setTimeout(() => jumpTo(`ny-shots-${id}`), 60);
  };

  const addFiles = async (files: FileList) => {
    setBusy(true);
    const found: string[] = [];
    const added: Shot[] = [];
    for (const file of Array.from(files)) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        found.push(`${file.name}: please add a PNG or JPEG screenshot.`);
        continue;
      }
      if (shots.length + added.length >= MAX_SHOTS) {
        found.push(`${file.name}: at most ${MAX_SHOTS} screenshots at a time.`);
        continue;
      }
      try {
        // Re-encoding strips camera and location details, as in the lab study.
        const blob = await processImage(file, { redactions: [], crop: null, outputType: file.type });
        const img = await loadImage(blob);
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        added.push({ name: file.name.slice(0, 120), type: blob.type, bytes: blob.size, width: img.naturalWidth, height: img.naturalHeight, url });
      } catch {
        found.push(`${file.name}: we couldn’t open this image.`);
      }
    }
    setShots((now) => [...now, ...added]);
    setProblems(found);
    setErrors((now) => now.filter((e) => e.field !== 'ny-shots'));
    setBusy(false);
    announce(added.length ? `${added.length} screenshot${added.length === 1 ? '' : 's'} added.` : 'No screenshots were added.');
  };

  const minutesOk = (v: string) => /^\d{1,4}$/.test(v.trim()) && Number(v) <= 1440;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempt((a) => a + 1);
    const found: FieldError[] = [];
    if (!shots.length) found.push({ field: 'ny-shots', message: 'Please add your screen-time screenshots.' });
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) found.push({ field: 'ny-from', message: 'Please give the first and last day the screenshots show, first day first.' });
    else if (to > today) found.push({ field: 'ny-to', message: 'The last day can’t be later than today.' });
    else if (daysBetween(from, to) + 1 > MAX_COVER_DAYS) found.push({ field: 'ny-from', message: `One set of screenshots can cover up to ${MAX_COVER_DAYS} days. Send another set for the rest.` });
    if (hasChosen(p) && !minutesOk(chosen)) found.push({ field: 'ny-shot-chosen', message: 'Please give the minutes a day as a whole number (0 if none of them appear).' });
    if (p.goalMinutes && !minutesOk(total)) found.push({ field: 'ny-shot-total', message: 'Please give your total screen time a day in minutes (2h 30m is 150).' });
    setErrors(found);
    if (found.length) return;
    onSave({
      images: shots.map(({ url: _url, ...rest }) => rest),
      phone,
      from,
      to,
      chosenMinutesPerDay: hasChosen(p) ? Number(chosen) : null,
      totalMinutesPerDay: p.goalMinutes ? Number(total) : null,
      readBy: 'self',
      at: new Date().toISOString(),
    });
    announce('Screenshots saved.');
  };

  return (
    <form className="ny-form" onSubmit={submit} noValidate>
      <ErrorSummary errors={errors} focusKey={attempt} />
      <p>{kind === 'start' ? 'Screenshots of your phone’s Screen Time (iPhone) or Digital Wellbeing (Android) summary show how you used your phone before your break.' : 'These prove your days off. Every day of your break needs to be covered, so send them at least once a week, while your phone still has those days.'} Several are better than one: the weekly chart, the daily view and the full list of apps with their times.</p>

      <section aria-labelledby="ny-shots-how">
        <h2 className="mpmb-h3" id="ny-shots-how" tabIndex={-1}>
          1. Take the screenshots
        </h2>
        <p>Take several, not just the first screen: scroll down so the chart, the totals and the full app list (including anything under “Show more”) are all captured.</p>
        <fieldset className="mpmb-field">
          <legend className="mpmb-label">Which phone do you have?</legend>
          <div className="mpmb-chips" role="presentation">
            {phones.map((ph) => (
              <label key={ph.id} className={`mpmb-chip${phone === ph.id ? ' is-selected' : ''}`} htmlFor={`ny-phone-${ph.id}`}>
                <input id={`ny-phone-${ph.id}`} type="radio" name="ny-phone" value={ph.id} className="mpmb-choice__input" checked={phone === ph.id} onChange={() => choosePhone(ph.id as 'iphone' | 'android')} />
                <span className="mpmb-choice__dot" aria-hidden="true" />
                {ph.name}
              </label>
            ))}
          </div>
        </fieldset>
        {phone === 'iphone' && (
          <div id="ny-shots-iphone" className="mpmb-guide-phone" tabIndex={-1}>
            <h3 className="mpmb-h3">On iPhone</h3>
            <p className="mpmb-hint">To take a screenshot, press the Side button and Volume Up together.</p>
            <Steps steps={screenTimeIphone} />
          </div>
        )}
        {phone === 'android' && (
          <div id="ny-shots-android" className="mpmb-guide-phone" tabIndex={-1}>
            <h3 className="mpmb-h3">On Android</h3>
            <p className="mpmb-hint">To take a screenshot, press Power and Volume Down together.</p>
            <Steps steps={androidSteps} />
          </div>
        )}
        {p.ai.length > 0 && <p className="mpmb-hint">AI tools used in a web browser show under the browser (Safari or Chrome) or under Websites, not as an app. Include those screens too.</p>}
      </section>

      <section aria-labelledby="ny-shots-add" id="ny-shots" tabIndex={-1}>
        <h2 className="mpmb-h3" id="ny-shots-add">
          2. Add them here
        </h2>
        <p className="mpmb-hint">Camera and location details are removed on this device. In the preview, the screenshots stay on this device and are not kept after you leave this page.</p>
        <ImageCapture onFiles={(files) => void addFiles(files)} disabled={busy} count={shots.length} max={MAX_SHOTS} />
        {errs['ny-shots'] && (
          <p className="mpmb-error" role="alert">
            {errs['ny-shots']}
          </p>
        )}
        {problems.length > 0 && (
          <Callout tone="important" role="alert">
            <ul>
              {problems.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Callout>
        )}
        {shots.length > 0 && (
          <ul className="mpmb-shots" role="list">
            {shots.map((s, i) => (
              <li key={s.url}>
                <img src={s.url} alt={`Screenshot ${i + 1}`} />
                <div className="mpmb-shots__meta">
                  <span>
                    {s.width} × {s.height} · {formatBytes(s.bytes)}
                  </span>
                </div>
                <Button variant="link" onClick={() => setShots((now) => now.filter((x) => x.url !== s.url))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ny-shots-read">
        <h2 className="mpmb-h3" id="ny-shots-read">
          3. What they show
        </h2>
        <Callout tone="info">
          <p>
            In the real study, the screenshots are read for you, as in the school and lab studies. In the preview, please read them for us. <NyDraft label="Preview" />
          </p>
        </Callout>
        <div className="ny-row">
          <TextField id="ny-from" type="date" label="First day they show" value={from} max={today} className="mpmb-input--date" onChange={(e) => setFrom(e.target.value)} error={errs['ny-from']} />
          <TextField id="ny-to" type="date" label="Last day they show" value={to} max={today} className="mpmb-input--date" onChange={(e) => setTo(e.target.value)} error={errs['ny-to']} />
        </div>
        {hasChosen(p) && <TextField id="ny-shot-chosen" label={`Minutes a day on ${names}, on average`} hint="Add up their daily averages, including any browser time for AI tools. 0 if none of them appear." inputMode="numeric" pattern="[0-9]*" width="short" maxLength={4} value={chosen} onChange={(e) => setChosen(e.target.value)} error={errs['ny-shot-chosen']} />}
        {p.goalMinutes !== null && <TextField id="ny-shot-total" label="Total screen time a day, on average, in minutes" hint="The daily average at the top (2h 30m is 150)." inputMode="numeric" pattern="[0-9]*" width="short" maxLength={4} value={total} onChange={(e) => setTotal(e.target.value)} error={errs['ny-shot-total']} />}
      </section>

      <div className="mpmb-actions">
        <Button type="submit" variant="primary" arrow loading={busy}>
          Save my screenshots
        </Button>
        <Button variant="ghost" onClick={onLater}>
          Finish later
        </Button>
      </div>
    </form>
  );
}

type JSZipCtor = typeof JSZip;

interface Working {
  label: string;
  zip: JSZip;
  platforms: Platform[];
  on: Set<CategoryId>;
  result: CleanResult;
}

/**
 * The app data downloads, as in the lab study: for each of TikTok, YouTube
 * and Instagram, how to request the download (the lab's illustrated steps),
 * then the download read and cleaned on this device, with the same choices of
 * what to share. A download can take days to arrive, so the visit can be
 * finished later.
 */
export function AppData({ initial, onSave, onLater }: { initial: AppDataRecord | null; onSave: (data: AppDataRecord) => void; onLater: (partial: AppDataRecord) => void }) {
  const [record, setRecord] = useState<AppDataRecord>(initial ?? { platforms: {}, done: false });
  const [howTo, setHowTo] = useState<DataPlatform | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const zipCtor = useRef<JSZipCtor | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const [folderOk] = useState(() => canChooseFolder());

  const set = (p: DataPlatform, d: PlatformDonation | null) =>
    setRecord((now) => {
      const platforms = { ...now.platforms };
      if (d) platforms[p] = d;
      else delete platforms[p];
      return { platforms, done: false };
    });

  const onFiles = async (chosen: ChosenFile[]) => {
    if (!chosen.length) return;
    setProblem(null);
    setWorking(null);
    setBusy(true);
    announce('Reading your download on this device.');
    try {
      zipCtor.current ??= (await import('jszip')).default;
      const { zip, label } = await readDownload(chosen, zipCtor.current);
      const platforms = await detectPlatforms(zip);
      if (!platforms.length) throw new Error('No TikTok, YouTube or Instagram data was recognised in this download. Check you chose the download itself, and that it was requested in JSON format. For Google Takeout, if your export came in several parts, choose them all together.');
      const on = new Set<CategoryId>(categories.filter((c) => platforms.includes(c.platform)).map((c) => c.id));
      setWorking({ label, zip, platforms, on, result: await cleanArchive(zip, on) });
      announce(`Found ${platforms.map((x) => platformNames[x]).join(' and ')} data. Choose what to keep.`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'This download could not be read.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
      if (folderRef.current) folderRef.current.value = '';
    }
  };
  const fromList = (list: FileList | null | undefined): ChosenFile[] => Array.from(list ?? []).map((f) => ({ file: f, name: f.name, path: f.webkitRelativePath || undefined }));

  const toggle = async (id: CategoryId, checked: boolean) => {
    if (!working) return;
    const on = new Set(working.on);
    if (checked) on.add(id);
    else on.delete(id);
    setWorking((w) => (w ? { ...w, on } : w));
    const result = await cleanArchive(working.zip, on);
    setWorking((w) => (w && w.on === on ? { ...w, result } : w));
  };

  const keep = () => {
    if (!working) return;
    const bytes = working.result.files.reduce((n, f) => n + f.text.length, 0);
    for (const platform of working.platforms) {
      const cats = Array.from(working.on).filter((c) => categories.find((x) => x.id === c)?.platform === platform);
      const kept = Object.fromEntries(Object.entries(working.result.report.kept).filter(([c]) => cats.includes(c as CategoryId))) as Record<string, number>;
      set(platform, { status: 'prepared', categories: cats, kept, bytes, at: new Date().toISOString() });
    }
    announce('Kept. In the real study this would be sent when you continue.');
    setWorking(null);
  };

  const done = dataApps.every((a) => record.platforms[a.id as DataPlatform]);
  const finish = () => {
    if (!done) {
      setNudge('For each app, add its download or say you don’t use it. If a download hasn’t arrived yet, choose “Finish later”: everything else is saved.');
      return;
    }
    onSave({ ...record, done: true });
  };
  const removedList = working ? Array.from(new Set(working.platforms.flatMap((x) => alwaysRemoved[x]))) : [];

  return (
    <div className="ny-form">
      <p>As in the lab study: ask each of TikTok, YouTube and Instagram that you use for a copy of your data. Each can take from a few minutes to a few days to arrive. This page reads it on your own device, keeps only when you watched, liked or searched, the links and simple totals, and shows you what would be shared. You untick anything you would rather keep private.</p>
      {nudge && (
        <Callout tone="important" role="alert">
          <p>{nudge}</p>
        </Callout>
      )}
      <ul className="ny-platforms" role="list">
        {dataApps.map((a) => {
          const id = a.id as DataPlatform;
          const d = record.platforms[id];
          return (
            <li key={id} className="ny-card">
              <h2 className="mpmb-h3">{a.name}</h2>
              <p className="ny-platforms__status">{d?.status === 'prepared' ? `Ready: ${d.categories.length} kinds of data kept (${Object.values(d.kept).reduce((n, k) => n + k, 0)} items).` : d?.status === 'not-used' ? 'You don’t use it.' : 'Not added yet.'}</p>
              <div className="ny-links">
                {!d && (
                  <>
                    <Button variant="link" onClick={() => { setHowTo(id); window.setTimeout(() => jumpTo('ny-howto'), 60); }}>
                      How to get my {a.name} data
                    </Button>
                    <Button variant="link" onClick={() => set(id, { status: 'not-used', categories: [], kept: {}, bytes: 0, at: new Date().toISOString() })}>
                      I don’t use {a.name}
                    </Button>
                  </>
                )}
                {d && (
                  <Button variant="link" onClick={() => set(id, null)}>
                    Change
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {howTo && (
        <div id="ny-howto" className="mpmb-guide-phone" tabIndex={-1}>
          <h3 className="mpmb-h3">How to get your {platformNames[howTo]} data</h3>
          <p className="mpmb-hint">{dataApps.find((a) => a.id === howTo)?.where}</p>
          <Callout tone="info">
            <p>
              <strong>Before you start:</strong> make sure you are logged in to your own account. When a format option appears, always choose <strong>JSON</strong>. You do not need to share everything: you can untick items when you request the data, and you will choose again, item by item, before anything is shared.
            </p>
          </Callout>
          <Steps steps={dataApps.find((a) => a.id === howTo)?.steps ?? []} />
        </div>
      )}

      {!working && (
        <div className="mpmb-dropzone">
          <label className="mpmb-dropzone__label" htmlFor="ny-zip">
            <span className="mpmb-dropzone__title">{busy ? 'Reading your download…' : 'Choose your download'}</span>
            <span className="mpmb-dropzone__sub">The .zip from TikTok (JSON), Google Takeout (YouTube; a .tgz works too) or Instagram (JSON), up to 1 GB. If Google split it into parts, choose them all. It stays on this device.</span>
          </label>
          <input ref={inputRef} id="ny-zip" type="file" multiple className="mpmb-sr-only" disabled={busy} onChange={(e) => void onFiles(fromList(e.target.files))} />
          <div className="mpmb-actions">
            <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={busy}>
              Choose file
            </Button>
            {folderOk && (
              <>
                <input
                  ref={(el) => {
                    folderRef.current = el;
                    el?.setAttribute('webkitdirectory', '');
                  }}
                  type="file"
                  multiple
                  className="mpmb-sr-only"
                  disabled={busy}
                  onChange={(e) => void onFiles(fromList(e.target.files))}
                />
                <Button variant="ghost" onClick={() => folderRef.current?.click()} disabled={busy}>
                  My download is a folder (it was unzipped)
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {problem && (
        <Callout tone="important" role="alert">
          <p>{problem}</p>
        </Callout>
      )}

      {working && (
        <section className="mpmb-card" aria-labelledby="ny-found">
          <h2 className="mpmb-h3" id="ny-found">
            Found: {working.platforms.map((x) => platformNames[x]).join(' and ')} data in {working.label}
          </h2>
          <p className="mpmb-hint">Ticked items would be shared. Untick anything you would rather not share. Nothing is sent in the preview.</p>
          <div className="mpmb-fields">
            {categories
              .filter((c) => working.platforms.includes(c.platform))
              .map((c) => {
                const n = working.result.report.kept[c.id];
                return <CheckboxField key={c.id} id={`ny-cat-${c.id}`} checked={working.on.has(c.id)} onChange={(checked) => void toggle(c.id, checked)} label={<><strong>{c.title}</strong> <span className="mpmb-filelist__meta">{platformNames[c.platform]}{n !== undefined ? ` · ${n}` : ''}</span></>} hint={`${c.detail}.${c.sensitive ? ' Untick if too personal.' : ''}`} />;
              })}
          </div>
          <h3 className="mpmb-h3">Always removed</h3>
          <ul className="mpmb-removed" role="list">
            {removedList.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {working.result.preview.length > 0 && (
            <>
              <h3 className="mpmb-h3">A glimpse of what would be shared</h3>
              <table className="mpmb-preview">
                <tbody>
                  {working.result.preview.map((row, i) => (
                    <tr key={i}>
                      <th scope="row">{row.kind}</th>
                      <td>{row.when}</td>
                      <td className="mpmb-preview__what">{row.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="mpmb-actions">
            <Button variant="primary" onClick={keep}>
              Keep these choices
            </Button>
            <Button variant="link" onClick={() => setWorking(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      <div className="mpmb-actions">
        <Button variant="primary" arrow onClick={finish} disabled={busy || Boolean(working)}>
          Continue
        </Button>
        <Button variant="ghost" onClick={() => onLater(record)}>
          Finish later
        </Button>
      </div>
      <p className="mpmb-hint">Platform menus change from time to time, so a button may sit in a slightly different place. Large YouTube exports work best on a laptop.</p>
    </div>
  );
}
