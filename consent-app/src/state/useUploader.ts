import { useCallback, useRef, useState } from 'react';
import { getApi } from '../api';
import { ApiError } from '../api/types';
import { announce } from '../lib/announce';
import { clientId } from '../lib/ids';
import { checkFile, loadImage, processImage } from '../lib/image';
import { assessImage } from '../lib/imageQuality';
import { imageStore } from '../lib/imageStore';
import type { DonationImage, SessionInfo } from '../model/types';
import { useStore } from './context';

export function friendlyUploadError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'network':
        return 'The upload didn’t finish. Check your connection and try again.';
      case 'too-large':
        return 'This image is too large to upload. Try a screenshot rather than a photo.';
      case 'validation':
        return 'This image couldn’t be accepted. Try a screenshot saved as PNG or JPEG.';
      case 'expired':
        return 'The upload took too long and timed out. Please try again.';
      default:
        return 'Something went wrong on our side. Please try again in a moment.';
    }
  }
  return 'Something went wrong while uploading. Please try again.';
}

/**
 * Manages the images a family adds. Nothing leaves the device when a file is
 * chosen: images are checked, re-encoded (which removes camera metadata such
 * as location) and shown for review. They are only uploaded when the person
 * presses "These are ready", so any hiding or cropping happens first.
 */
export function useUploader() {
  const { state, dispatch } = useStore();
  const sessionRef = useRef<SessionInfo | null>(state.session);
  sessionRef.current = state.session;
  const imagesRef = useRef(state.donation.images);
  imagesRef.current = state.donation.images;
  const [rejected, setRejected] = useState<string[]>([]);

  const ensureSession = useCallback(
    async (renew = false): Promise<SessionInfo> => {
      if (sessionRef.current && !renew) return sessionRef.current;
      const session = await getApi().startSession();
      sessionRef.current = session;
      dispatch({ type: 'session', session });
      return session;
    },
    [dispatch],
  );

  const uploadOne = useCallback(
    async (image: DonationImage, index: number, total: number): Promise<string | null> => {
      const stored = imageStore.get(image.id);
      if (!stored) {
        dispatch({ type: 'update-image', id: image.id, patch: { status: 'failed', error: 'This image is no longer available. Please add it again.' } });
        return null;
      }
      dispatch({ type: 'update-image', id: image.id, patch: { status: 'uploading', progress: 0, error: null } });
      announce(`Uploading image ${index + 1} of ${total}.`);
      const attempt = async (session: SessionInfo) => {
        const api = getApi();
        const slot = await api.requestUploadSlot(session.sessionId, { contentType: stored.blob.type, size: stored.blob.size, width: image.width, height: image.height });
        await api.uploadImage(slot, stored.blob, (fraction) => dispatch({ type: 'update-image', id: image.id, patch: { progress: fraction } }));
        return slot.uploadId;
      };
      try {
        let uploadId: string;
        try {
          uploadId = await attempt(await ensureSession());
        } catch (error) {
          // An expired session is renewed once, transparently.
          if (error instanceof ApiError && error.code === 'expired') uploadId = await attempt(await ensureSession(true));
          else throw error;
        }
        dispatch({ type: 'update-image', id: image.id, patch: { status: 'uploaded', progress: 1, uploadId, error: null } });
        announce(`Image ${index + 1} uploaded.`);
        return uploadId;
      } catch (error) {
        const message = friendlyUploadError(error);
        dispatch({ type: 'update-image', id: image.id, patch: { status: 'failed', progress: 0, error: message } });
        announce(`Image ${index + 1} failed to upload. ${message}`);
        return null;
      }
    },
    [dispatch, ensureSession],
  );

  /**
   * Uploads everything that is waiting. Resolves with whether every image is
   * now uploaded, and the images as they now stand. The list is returned
   * explicitly because React state may not have re-rendered by the time the
   * caller continues, and the send must include every image just uploaded.
   */
  const uploadPending = useCallback(async (): Promise<{ ok: boolean; images: DonationImage[] }> => {
    const images = imagesRef.current.slice();
    let ok = true;
    for (let i = 0; i < images.length; i += 1) {
      const image = images[i];
      if (image.status === 'uploaded' || image.status === 'sent') continue;
      const uploadId = await uploadOne(image, i, images.length);
      if (uploadId) images[i] = { ...image, status: 'uploaded', progress: 1, uploadId, error: null };
      else {
        ok = false;
        images[i] = { ...image, status: 'failed', uploadId: null };
      }
    }
    return { ok, images };
  }, [uploadOne]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const problems: string[] = [];
      let count = imagesRef.current.length;
      for (const file of Array.from(files)) {
        const problem = checkFile(file, count);
        if (problem) {
          problems.push(`${file.name}: ${problem}`);
          continue;
        }
        let blob: Blob;
        let width = 0;
        let height = 0;
        try {
          // Re-encoding through a canvas strips metadata (camera model, GPS) and bounds the size.
          blob = await processImage(file, { redactions: [], crop: null, outputType: file.type });
          const img = await loadImage(blob);
          width = img.naturalWidth;
          height = img.naturalHeight;
        } catch {
          problems.push(`${file.name}: we couldn’t open this image. Try a different screenshot.`);
          continue;
        }
        const id = clientId();
        imageStore.put(id, blob);
        const quality = await assessImage(blob).catch(() => null);
        const image: DonationImage = { id, name: file.name, type: blob.type, size: blob.size, width, height, redacted: false, cropped: false, status: 'pending', progress: 0, uploadId: null, error: null, quality, acknowledged: false };
        dispatch({ type: 'add-image', image });
        count += 1;
        announce(quality?.verdict === 'unlikely' ? `Image ${count} added, but it does not look like a screen-time page. Check it before sending.` : `Image ${count} added. Nothing is sent until you press the send button.`);
      }
      setRejected(problems);
      if (problems.length) announce(`${problems.length} file${problems.length === 1 ? ' was' : 's were'} not added.`);
    },
    [dispatch],
  );

  const remove = useCallback(
    (image: DonationImage) => {
      if (image.uploadId && sessionRef.current) {
        void getApi()
          .deleteUpload(sessionRef.current.sessionId, image.uploadId)
          .catch(() => {
            /* Orphaned uploads are cleaned up server-side. */
          });
      }
      dispatch({ type: 'remove-image', id: image.id });
      announce('Image removed.');
    },
    [dispatch],
  );

  /** Swap in an edited version. If the original had already been uploaded, it is deleted and the new one waits to be sent. */
  const replace = useCallback(
    async (image: DonationImage, blob: Blob, flags: { redacted: boolean; cropped: boolean }) => {
      if (image.uploadId && sessionRef.current) {
        void getApi()
          .deleteUpload(sessionRef.current.sessionId, image.uploadId)
          .catch(() => {
            /* ignore */
          });
      }
      imageStore.put(image.id, blob);
      let width = image.width;
      let height = image.height;
      try {
        const img = await loadImage(blob);
        width = img.naturalWidth;
        height = img.naturalHeight;
      } catch {
        /* keep previous dimensions */
      }
      const quality = await assessImage(blob).catch(() => image.quality);
      dispatch({ type: 'update-image', id: image.id, patch: { type: blob.type, size: blob.size, width, height, redacted: image.redacted || flags.redacted, cropped: image.cropped || flags.cropped, status: 'pending', progress: 0, uploadId: null, error: null, quality, acknowledged: false } });
      if (image.status === 'uploaded') dispatch({ type: 'donation-status', status: 'in-progress' });
      announce(flags.redacted ? 'Hidden areas applied. The image will be sent when you press the send button.' : 'Crop applied.');
    },
    [dispatch],
  );

  const acknowledge = useCallback(
    (ids: string[]) => {
      for (const id of ids) dispatch({ type: 'update-image', id, patch: { acknowledged: true } });
    },
    [dispatch],
  );

  return { addFiles, uploadPending, remove, replace, acknowledge, rejected, clearRejected: () => setRejected([]) };
}
