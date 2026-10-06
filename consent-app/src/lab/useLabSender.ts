import { getApi } from '../api';
import { ApiError } from '../api/types';
import { announce } from '../lib/announce';
import { describeError, labClientInfo, labSession } from './api';
import { labFileStore } from './fileStore';
import type { LabArchive, LabScreenshot } from './model';
import { useLab } from './store';

type Kind = 'archive' | 'screenshot';
type Item = { kind: 'archive'; item: LabArchive } | { kind: 'screenshot'; item: LabScreenshot };

/**
 * Uploads whatever is waiting of the given kinds and records the send against
 * the participant code, filed under the chosen phase. Used twice: the
 * screenshots go first, on their own, and the cleaned file follows when the
 * download has arrived.
 */
export function useLabSender() {
  const { state, dispatch } = useLab();
  const busy = state.submission.donationStage === 'sending';

  const uploadOne = async (sessionId: string, entry: Item): Promise<string | null> => {
    const { kind, item } = entry;
    const blob = labFileStore.get(item.id);
    const update = (patch: Partial<LabArchive & LabScreenshot>) => (kind === 'archive' ? dispatch({ type: 'update-archive', id: item.id, patch }) : dispatch({ type: 'update-screenshot', id: item.id, patch }));
    if (item.status === 'uploaded' && item.uploadId) return item.uploadId;
    if (!blob) {
      update({ status: 'failed', error: 'This file is no longer available on this device. Please add it again.' });
      return null;
    }
    update({ status: 'uploading', progress: 0, error: null });
    try {
      const api = getApi();
      const slot = await api.requestLabUploadSlot(sessionId, { contentType: blob.type || 'application/zip', size: blob.size });
      await api.uploadImage(slot, blob, (fraction) => update({ progress: fraction }));
      update({ status: 'uploaded', progress: 1, uploadId: slot.uploadId });
      return slot.uploadId;
    } catch (error) {
      update({ status: 'failed', progress: 0, error: error instanceof ApiError ? describeError(error, 'this file') : 'The upload did not finish. Please try again.' });
      return null;
    }
  };

  /** Sends what is pending of these kinds. Resolves ok when at least one file was accepted; otherwise carries a message for the person. */
  const send = async (kinds: Kind[]): Promise<{ ok: boolean; message?: string }> => {
    if (!state.phase) return { ok: false, message: 'Tell us whether these files are from before or after your social media break.' };
    const pendingShots = kinds.includes('screenshot') ? state.screenshots.filter((s) => s.status !== 'sent') : [];
    const pendingArchives = kinds.includes('archive') ? state.archives.filter((a) => a.status !== 'sent') : [];
    if (!pendingShots.length && !pendingArchives.length) return { ok: false, message: 'Nothing new to send. Add a file to send more.' };
    dispatch({ type: 'submission', patch: { donationStage: 'sending', donationError: null } });
    announce('Uploading your files.');
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const items: Item[] = [...pendingShots.map((s): Item => ({ kind: 'screenshot', item: s })), ...pendingArchives.map((a): Item => ({ kind: 'archive', item: a }))];
      const uploaded: { entry: Item; uploadId: string }[] = [];
      for (const entry of items) {
        const uploadId = await uploadOne(session.sessionId, entry);
        if (uploadId) uploaded.push({ entry, uploadId });
      }
      if (!uploaded.length) throw new ApiError('network', 'No file could be uploaded.');
      const result = await getApi().submitLabDonation(session, {
        participantCode: state.code,
        uploads: uploaded.map(({ entry, uploadId }) =>
          entry.kind === 'archive'
            ? { uploadId, kind: 'archive' as const, name: entry.item.name, contentType: 'application/zip', size: entry.item.size, platforms: entry.item.platforms, categories: entry.item.categories, kept: Object.fromEntries(Object.entries(entry.item.kept).map(([k, v]) => [k, Number(v)])) }
            : { uploadId, kind: 'screenshot' as const, name: entry.item.name, contentType: entry.item.type, size: entry.item.size },
        ),
        phase: state.phase,
        phone: state.phone,
        client: labClientInfo(),
      });
      for (const r of result.rejected) {
        const hit = uploaded.find((u) => u.uploadId === r.uploadId);
        if (!hit) continue;
        if (hit.entry.kind === 'archive') dispatch({ type: 'update-archive', id: hit.entry.item.id, patch: { status: 'failed', uploadId: null, error: r.reason } });
        else dispatch({ type: 'update-screenshot', id: hit.entry.item.id, patch: { status: 'failed', uploadId: null, error: r.reason } });
      }
      dispatch({ type: 'files-sent', ids: result.accepted, receivedAt: result.receivedAt, donationId: result.donationId });
      if (result.accepted.length) {
        announce(result.rejected.length ? `${result.accepted.length} sent, ${result.rejected.length} not accepted.` : 'Sent. Thank you.');
        return { ok: true };
      }
      return { ok: false, message: result.rejected[0]?.reason ?? 'Nothing could be accepted. Please check the files and try again.' };
    } catch (error) {
      const message = describeError(error, 'your data');
      dispatch({ type: 'submission', patch: { donationStage: 'failed', donationError: message } });
      return { ok: false, message };
    }
  };

  return { send, busy };
}
