import { study } from '../config/study';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Client-side checks before an image is accepted. The server repeats them. */
export function checkFile(file: File, currentCount: number): string | null {
  const accepted = study.upload.acceptedTypes as readonly string[];
  if (currentCount >= study.upload.maxImages) {
    return `You can add up to ${study.upload.maxImages} images. Remove one to add another.`;
  }
  if (!accepted.includes(file.type)) {
    if (file.type === 'image/heic' || file.type === 'image/heif' || /\.hei[cf]$/i.test(file.name)) {
      return 'This photo is in HEIC format, which we cannot show here. Take a screenshot instead of a photo, or change your camera settings to “Most compatible”.';
    }
    return 'We can only accept PNG, JPEG or WebP images. Screenshots are usually PNG.';
  }
  if (file.size > study.upload.maxBytesPerImage) {
    const mb = Math.round(study.upload.maxBytesPerImage / (1024 * 1024));
    return `This image is larger than ${mb} MB. Try a screenshot rather than a photo.`;
  }
  return null;
}

export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The image could not be opened.'));
    };
    img.src = url;
  });
}

export interface ProcessOptions {
  /** Areas to paint over, in image pixel coordinates. */
  redactions: Rect[];
  /** Area to keep, in image pixel coordinates. */
  crop: Rect | null;
  outputType: string;
}

/**
 * Applies redactions and/or a crop and returns a new image. Redaction paints
 * solid colour into the pixels (it is not an overlay), so the hidden content
 * is not recoverable from the output. Large images are scaled down to
 * `study.upload.maxEdgePx` to keep uploads small.
 */
export async function processImage(blob: Blob, options: ProcessOptions): Promise<Blob> {
  const img = await loadImage(blob);
  const crop = options.crop ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const scale = Math.min(1, study.upload.maxEdgePx / Math.max(crop.w, crop.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process the image.');
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#113b3f';
  for (const r of options.redactions) {
    ctx.fillRect((r.x - crop.x) * scale, (r.y - crop.y) * scale, r.w * scale, r.h * scale);
  }
  const type = options.outputType === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('The image could not be saved.'))), type, 0.92);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
