import type { ImageQuality } from '../model/types';
import { loadImage } from './image';

/**
 * A quick, local check that an image looks like a screen-time page rather
 * than something else picked by mistake. It runs on the device before
 * anything is sent, so it has to be cheap and cannot look at content: it
 * judges shape and colour only.
 *
 *   - Phone screenshots are portrait and made of flat colour: a handful of
 *     colours cover most of the pixels.
 *   - Photographs (a room, a face, a pet) are noisy: no small set of colours
 *     covers much of the image.
 *   - A photo of another phone's screen sits in between, which is why the
 *     middle band is "unsure" and never warned about.
 *
 * The server runs the thorough checks (SafeSearch and text detection); this
 * is only there to catch obvious mistakes before they leave the device.
 */
const SAMPLE = 96;

export async function assessImage(blob: Blob): Promise<ImageQuality> {
  const img = await loadImage(blob);
  const portrait = img.naturalHeight >= img.naturalWidth * 1.2;
  const canvas = document.createElement('canvas');
  const scale = SAMPLE / Math.max(img.naturalWidth, img.naturalHeight);
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { verdict: 'unsure', reasons: ['Could not inspect the image.'], flatness: 0, portrait };
  // Sample pixels rather than averaging them: averaging blurs fine texture into a few mid-tones and makes noisy photos look flat.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const counts = new Map<number, number>();
  const total = canvas.width * canvas.height;
  for (let i = 0; i < data.length; i += 4) {
    // Quantise to 5 bits per channel so slight gradients and anti-aliasing count as one colour.
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = Array.from(counts.values())
    .sort((a, b) => b - a)
    .slice(0, 8)
    .reduce((sum, n) => sum + n, 0);
  const flatness = top / total;

  const reasons: string[] = [];
  let verdict: ImageQuality['verdict'] = 'unsure';
  if (flatness >= 0.45 && portrait) verdict = 'likely';
  else if (flatness < 0.2) {
    verdict = 'unlikely';
    reasons.push('It looks like a photograph of something other than a phone screen.');
  }
  if (!portrait && flatness < 0.45) {
    if (verdict !== 'unlikely') verdict = 'unsure';
    reasons.push('Screen-time screenshots are usually taller than they are wide.');
  }
  if (img.naturalWidth < 300 || img.naturalHeight < 300) {
    verdict = 'unlikely';
    reasons.push('The image is very small, so the app list would not be readable.');
  }
  return { verdict, reasons, flatness: Math.round(flatness * 100) / 100, portrait };
}
