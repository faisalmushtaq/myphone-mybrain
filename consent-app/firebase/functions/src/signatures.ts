import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';
import { sha256 } from './images.js';
import { study } from './forms.js';
import type { SignatureRecord } from './validate.js';

/** Decodes a PNG data URL and checks it really is a PNG of acceptable size. */
export function decodeSignature(dataUrl: string): Buffer {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) throw new HttpsError('invalid-argument', 'The signature is not a PNG image.');
  if (buffer.length > study.maxSignatureBytes) throw new HttpsError('invalid-argument', 'The signature image is too large.');
  return buffer;
}

/** Stores a drawn signature at signatures/{folder}/{name}.png; the folder is the participant id, or lab/{code} for the lab study. */
export async function storeSignature(folder: string, name: string, dataUrl: string): Promise<{ path: string; sha256: string }> {
  const buffer = decodeSignature(dataUrl);
  const path = `signatures/${folder}/${name}.png`;
  await getStorage().bucket().file(path).save(buffer, { contentType: 'image/png', resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  return { path, sha256: sha256(buffer) };
}

/** What is kept of a signature: never the image data itself, only where the stored PNG is and its hash. */
export function signatureRecord(sig: SignatureRecord | null | undefined, stored: { path: string; sha256: string } | null) {
  if (!sig) return null;
  return { method: sig.method, typedName: sig.typedName, strokeCount: sig.strokeCount, pointerType: sig.pointerType, capturedAt: sig.capturedAt, image: stored };
}
