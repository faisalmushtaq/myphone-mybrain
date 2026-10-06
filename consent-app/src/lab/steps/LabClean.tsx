import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type JSZip from 'jszip';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { CheckboxField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { downloadBlob } from '../../lib/consentPdf';
import { clientId } from '../../lib/ids';
import { alwaysRemoved, buildCleanedZip, categories, cleanArchive, cleanedArchiveName, detectPlatforms, formatBytes, platformNames, type CategoryId, type CleanResult, type Platform } from '../cleaner';
import { labFileStore } from '../fileStore';
import { LabShell } from '../LabShell';
import { PlatformChecklist } from '../PlatformChecklist';
import { phaseHave } from '../reducer';
import { useLab } from '../store';
import { checkArchiveFile } from '../validation';

type JSZipCtor = typeof JSZip;

interface Working {
  file: File;
  zip: JSZip;
  platforms: Platform[];
  on: Set<CategoryId>;
  result: CleanResult;
}

/**
 * The cleaning step. The participant's ZIP is read on their own device;
 * they see what was found, untick anything they would rather not share, and
 * the cleaned file is prepared in memory for the next step. Nothing is sent
 * here.
 */
export function LabClean() {
  const { state, dispatch } = useLab();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([]);
  const [nudges, setNudges] = useState(0);
  const zipCtor = useRef<JSZipCtor | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';

  const loadZip = async (): Promise<JSZipCtor> => {
    zipCtor.current ??= (await import('jszip')).default;
    return zipCtor.current;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setWorking(null);
    const bad = checkArchiveFile(file);
    if (bad) {
      setProblem(bad);
      return;
    }
    setBusy(true);
    announce('Reading your file on this device.');
    try {
      const Zip = await loadZip();
      const zip = await Zip.loadAsync(await file.arrayBuffer());
      const platforms = await detectPlatforms(zip);
      if (!platforms.length) throw new Error('No TikTok, YouTube or Instagram data was recognised in this file. Check you chose the ZIP you downloaded, and that it was requested in JSON format.');
      const on = new Set<CategoryId>(categories.filter((c) => platforms.includes(c.platform)).map((c) => c.id));
      const result = await cleanArchive(zip, on);
      setWorking({ file, zip, platforms, on, result });
      announce(`Found ${platforms.map((p) => platformNames[p]).join(' and ')} data. Choose what to keep.`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'This file could not be read.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // The tick changes at once; the cleaned result and counts follow when the re-clean finishes (a later toggle wins).
  const toggle = async (id: CategoryId, checked: boolean) => {
    if (!working) return;
    const on = new Set(working.on);
    if (checked) on.add(id);
    else on.delete(id);
    setWorking((w) => (w ? { ...w, on } : w));
    const result = await cleanArchive(working.zip, on);
    setWorking((w) => (w && w.on === on ? { ...w, result } : w));
  };

  const add = async () => {
    if (!working) return;
    setBusy(true);
    try {
      const Zip = await loadZip();
      const blob = (await buildCleanedZip(Zip, working.result.files, 'blob')) as Blob;
      const id = clientId('zip');
      labFileStore.put(id, blob);
      dispatch({ type: 'add-archive', archive: { id, name: cleanedArchiveName(working.platforms), size: blob.size, platforms: working.platforms, categories: Array.from(working.on), kept: working.result.report.kept, status: 'ready', progress: 0, uploadId: null, error: null } });
      announce('Added to your donation. Nothing is sent until the next step.');
      setWorking(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The cleaned file could not be built.');
    } finally {
      setBusy(false);
    }
  };

  const saveCopy = async () => {
    if (!working) return;
    const Zip = await loadZip();
    downloadBlob((await buildCleanedZip(Zip, working.result.files, 'blob')) as Blob, cleanedArchiveName(working.platforms));
  };

  const remove = (id: string) => {
    labFileStore.remove(id);
    dispatch({ type: 'remove-archive', id });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void onFile(e.dataTransfer.files[0]);
  };

  if (!ready) {
    return (
      <LabShell kicker="Choose what to share" title="Enter your participant code first." intro={<p>We need your code and your consent before any data can be sent. It takes a minute.</p>} hideContinue hideBack>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'participant-id' })}>
            Enter my code
          </Button>
        </div>
      </LabShell>
    );
  }

  const removedList = working ? Array.from(new Set(working.platforms.flatMap((p) => alwaysRemoved[p]))) : [];

  return (
    <LabShell kicker="Choose what to share" title="Choose what to share from your data." intro={<p>Pick a ZIP you downloaded from TikTok, Google Takeout (YouTube) or Instagram. This page reads it on your own device, keeps only dates, links and search words, and shows you what would be shared. Untick anything you would rather keep private. Do this for each app you use, one file at a time.</p>} errors={errors}
      onContinue={() => {
        // The study asks for at least one cleaned file; after two nudges the person may go on without.
        if (!state.archives.length && !phaseHave(state).archives && nudges < 2) {
          setNudges(nudges + 1);
          setErrors([{ field: 'lab-zip', message: nudges === 0 ? 'Prepare at least one TikTok, YouTube or Instagram file before going on; more than one if you have them. The study needs it alongside your screenshots.' : 'The study really does need your TikTok, YouTube or Instagram data. If you cannot provide it right now, press Continue once more to go on and add the file later.' }]);
          return;
        }
        setErrors([]);
        dispatch({ type: 'next' });
      }}
      continueLabel="Next: send my data"
      width="wide"
    >
      <section aria-labelledby="apps-heading">
        <h2 className="mpmb-h3" id="apps-heading">
          Your apps
        </h2>
        <PlatformChecklist
          renderFiles={(files) => (
            <ul className="mpmb-filelist" role="list">
              {files.map((a) => (
                <li key={a.id}>
                  <div>
                    {a.name} · {formatBytes(a.size)}
                    <span className="mpmb-filelist__meta">
                      {a.categories.length} of {categories.filter((c) => a.platforms.includes(c.platform)).length} categories kept{a.status === 'sent' ? ' · sent' : ''}
                    </span>
                  </div>
                  {a.status !== 'sent' && (
                    <Button variant="link" onClick={() => remove(a.id)}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        />
      </section>

      {!working && (
        <div className={`mpmb-dropzone${over ? ' is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <label className="mpmb-dropzone__label" htmlFor="lab-zip">
            <span className="mpmb-dropzone__title">{busy ? 'Reading your file…' : 'Choose a ZIP file'}</span>
            <span className="mpmb-dropzone__sub">TikTok (JSON), YouTube (Google Takeout) or Instagram (JSON). It stays on this device.</span>
          </label>
          <input ref={inputRef} id="lab-zip" type="file" accept=".zip,application/zip,application/x-zip-compressed" className="mpmb-sr-only" disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>) => void onFile(e.target.files?.[0])} />
          <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={busy}>
            Choose file
          </Button>
        </div>
      )}
      {problem && (
        <Callout tone="important" role="alert">
          <p>{problem}</p>
        </Callout>
      )}

      {working && (
        <section className="mpmb-card" aria-labelledby="found-heading">
          <h2 className="mpmb-h3" id="found-heading">
            Found: {working.platforms.map((p) => platformNames[p]).join(' and ')} data in {working.file.name}
          </h2>
          <p className="mpmb-hint">Ticked items will be shared. Untick anything you would rather not share; it is your choice and nothing is sent yet.</p>
          <div className="mpmb-fields">
            {categories
              .filter((c) => working.platforms.includes(c.platform))
              .map((c) => {
                const n = working.result.report.kept[c.id];
                return <CheckboxField key={c.id} id={`cat-${c.id}`} checked={working.on.has(c.id)} onChange={(checked) => void toggle(c.id, checked)} label={<><strong>{c.title}</strong> <span className="mpmb-filelist__meta">{platformNames[c.platform]}{n !== undefined ? ` · ${n}` : ''}</span></>} hint={`${c.detail}.${c.sensitive ? ' Untick if too personal.' : ''}`} />;
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
            <Button variant="primary" onClick={() => void add()} loading={busy}>
              Add this to my donation
            </Button>
            <Button variant="ghost" onClick={() => void saveCopy()}>
              Save a copy of the cleaned file
            </Button>
            <Button variant="link" onClick={() => setWorking(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}
      <p className="mpmb-hint">Nothing has been sent. Your original download is untouched; only the cleaned version is prepared for sending.</p>
    </LabShell>
  );
}
