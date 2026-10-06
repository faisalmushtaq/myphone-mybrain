import { logger } from 'firebase-functions/v2';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assess, flatnessOfPixels, inspectWithVision, visionEnabled, type Quality } from './quality.js';

/**
 * The image pipeline shared by the family app's screenshots and the lab
 * study's: prove the upload is a real image, re-encode it (which drops EXIF,
 * GPS, ICC and XMP), then run the quality and safety checks on the clean copy.
 */

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** An upload the checks would not keep. Carries a reason the person can act on. */
export class RejectedUpload extends Error {
  constructor(
    public reason: string,
    public quality: Quality | null = null,
  ) {
    super(reason);
  }
}

export interface CleanImage {
  data: Buffer;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  ext: 'png' | 'jpg';
  contentType: 'image/png' | 'image/jpeg';
  sha256: string;
}

/** Colour flatness of a small copy: high for flat UI, low for photographs. */
export async function flatnessOf(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image).resize(96, 96, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return flatnessOfPixels(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.channels);
}

/** Checks the bytes are an image we accept and re-encodes them without metadata. */
export async function cleanImage(original: Buffer): Promise<CleanImage> {
  let pipeline = sharp(original, { failOn: 'error' }).rotate();
  let meta;
  try {
    meta = await pipeline.metadata();
  } catch {
    throw new RejectedUpload('This file is not an image we can read. Please add a PNG or JPEG screenshot.');
  }
  if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) throw new RejectedUpload('This file is not a supported image. Please add a PNG or JPEG screenshot.');
  if ((meta.width ?? 0) > 6000 || (meta.height ?? 0) > 12000) pipeline = pipeline.resize({ width: 3000, height: 6000, fit: 'inside', withoutEnlargement: true });
  // Re-encoding without withMetadata() strips EXIF, GPS, ICC and XMP.
  const output = meta.format === 'png' ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const format = meta.format === 'png' ? 'png' : 'jpeg';
  return { data: output.data, width: output.info.width, height: output.info.height, format, ext: format === 'png' ? 'png' : 'jpg', contentType: format === 'png' ? 'image/png' : 'image/jpeg', sha256: sha256(output.data) };
}

/** Quality and safety checks on the clean copy. A Vision outage flags the image for review rather than losing it. */
export async function checkImage(image: CleanImage, acknowledgedWarning: boolean, context: Record<string, unknown> = {}): Promise<Quality> {
  const flatness = await flatnessOf(image.data);
  let vision = null;
  if (visionEnabled()) {
    try {
      vision = await inspectWithVision(image.data);
    } catch (error) {
      logger.warn('Vision check failed; image kept for review', { ...context, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const quality = assess({ width: image.width, height: image.height, flatness, vision, acknowledgedWarning });
  if (!visionEnabled()) quality.reasons.push('Vision checks not enabled.');
  return quality;
}
