/**
 * Quality and safety checks for donated screenshots.
 *
 * The browser makes a quick, content-blind guess (shape and colour only) and
 * asks the family to look again when an image seems to be a photograph.
 * This is the thorough layer, run on the metadata-stripped copy:
 *
 *   - flatness: phone screenshots are made of a handful of flat colours,
 *     photographs are not (computed here with no external service);
 *   - Cloud Vision SafeSearch, to refuse anything adult, violent or
 *     sexualised that was added by mistake, without a person having to look;
 *   - Cloud Vision text detection, to confirm the words a screen-time page
 *     carries ("Screen Time", "Digital Wellbeing", "Most used", durations…).
 *
 * Vision only runs when MPMB_VISION=true (the Cloud Vision API must be
 * enabled on the project). Data stays in the EU: the client talks to
 * eu-vision.googleapis.com. Nothing here keeps or logs image content.
 *
 * Verdicts: 'accepted' (looks like a screen-time page), 'review' (kept, but
 * a coordinator should glance at it), 'rejected' (not stored; the family is
 * told why in plain words).
 */
export type Likelihood = 'UNKNOWN' | 'VERY_UNLIKELY' | 'UNLIKELY' | 'POSSIBLE' | 'LIKELY' | 'VERY_LIKELY';

export interface SafeSearch {
  adult: Likelihood;
  violence: Likelihood;
  racy: Likelihood;
  medical: Likelihood;
  spoof: Likelihood;
}

export interface VisionFindings {
  safeSearch: SafeSearch | null;
  /** All text found in the image, or '' when there was none. */
  text: string;
}

export interface QualityInput {
  width: number;
  height: number;
  /** Fraction of pixels covered by the eight most common colours. */
  flatness: number;
  vision: VisionFindings | null;
  /** The family saw the browser's warning and said the image was right. */
  acknowledgedWarning: boolean;
}

export interface Quality {
  verdict: 'accepted' | 'review' | 'rejected';
  /** For the team; never shown to families. */
  reasons: string[];
  /** Shown to the family when the image is rejected. */
  familyReason: string | null;
  looksLikeScreen: boolean;
  termsFound: string[];
  safeSearch: SafeSearch | null;
  checkedWithVision: boolean;
  flatness: number;
  portrait: boolean;
  acknowledgedWarning: boolean;
}

const LIKELIHOODS: Likelihood[] = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
const atLeast = (value: Likelihood | undefined, threshold: Likelihood) => LIKELIHOODS.indexOf(value ?? 'UNKNOWN') >= LIKELIHOODS.indexOf(threshold);

/** Words that appear on iOS Screen Time and Android Digital Wellbeing pages. */
const TERMS = [
  'screen time',
  'digital wellbeing',
  'digital well-being',
  'daily average',
  'daily total',
  'most used',
  'pickups',
  'app limits',
  'downtime',
  'unlocks',
  'app activity',
  'app usage',
  'last 7 days',
  'this week',
  'last week',
  'notifications',
  'see all activity',
  'show categories',
  'show apps',
  'dashboard',
  'bedtime mode',
  'focus mode',
  'total screen time',
  'time on screen',
  'usage time',
];
const DURATION = /\b\d{1,2}\s?(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/g;

export const FAMILY_REASONS = {
  unsafe: 'This image can’t be accepted. Please send a screenshot of the phone’s screen-time page instead.',
  notScreen: 'This doesn’t look like a screenshot of the screen-time page. Check the image and try again, or remove it.',
};

/** Screen-time words and durations found in detected text. */
export function findTerms(text: string): string[] {
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  const found = TERMS.filter((t) => lower.includes(t));
  const durations = lower.match(DURATION)?.length ?? 0;
  if (durations >= 2) found.push(`${durations} durations`);
  return found;
}

/**
 * Coverage of the eight most common colours (5 bits per channel), from raw
 * pixels of a small resized copy. Flat UI scores high, photographs low.
 * Same idea as the browser check, computed here so it cannot be spoofed.
 */
export function flatnessOfPixels(pixels: Uint8Array, channels: number): number {
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i + 2 < pixels.length; i += channels) {
    const key = ((pixels[i] >> 3) << 10) | ((pixels[i + 1] >> 3) << 5) | (pixels[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  if (!total) return 0;
  const top = Array.from(counts.values())
    .sort((a, b) => b - a)
    .slice(0, 8)
    .reduce((sum, n) => sum + n, 0);
  return Math.round((top / total) * 100) / 100;
}

export function assess(input: QualityInput): Quality {
  const portrait = input.height >= input.width * 1.2;
  const looksLikeScreen = input.flatness >= 0.45 && portrait;
  const reasons: string[] = [];
  const termsFound = input.vision ? findTerms(input.vision.text) : [];
  const safeSearch = input.vision?.safeSearch ?? null;
  const base: Omit<Quality, 'verdict' | 'familyReason'> = {
    reasons,
    looksLikeScreen,
    termsFound,
    safeSearch,
    checkedWithVision: input.vision !== null,
    flatness: input.flatness,
    portrait,
    acknowledgedWarning: input.acknowledgedWarning,
  };

  // 1. Safety: refuse outright, never store.
  if (safeSearch) {
    for (const key of ['adult', 'violence', 'racy'] as const) {
      if (atLeast(safeSearch[key], 'LIKELY')) reasons.push(`SafeSearch ${key}: ${safeSearch[key]}`);
    }
    if (reasons.length) return { ...base, verdict: 'rejected', familyReason: FAMILY_REASONS.unsafe };
    for (const key of ['adult', 'violence', 'racy', 'medical'] as const) {
      if (atLeast(safeSearch[key], 'POSSIBLE')) reasons.push(`SafeSearch ${key}: ${safeSearch[key]} (possible)`);
    }
  }

  // 2. Relevance. Text is the strongest signal; shape and colour back it up.
  if (input.vision) {
    if (termsFound.length) {
      if (!looksLikeScreen) reasons.push('Screen-time words found, but the image is not flat and portrait (a photo of a screen?).');
      return { ...base, verdict: reasons.length ? 'review' : 'accepted', familyReason: null };
    }
    reasons.push(input.vision.text.trim() ? 'No screen-time words in the text found.' : 'No text found in the image.');
    if (input.flatness < 0.2) {
      reasons.push('Looks like a photograph, not a screenshot.');
      return { ...base, verdict: 'rejected', familyReason: FAMILY_REASONS.notScreen };
    }
    return { ...base, verdict: 'review', familyReason: null };
  }

  // Vision not enabled: shape and colour only, and never reject on those alone.
  if (looksLikeScreen && !reasons.length) return { ...base, verdict: 'accepted', familyReason: null };
  if (!portrait) reasons.push('Not portrait.');
  if (input.flatness < 0.45) reasons.push(input.flatness < 0.2 ? 'Looks like a photograph, not a screenshot.' : 'Less flat than a typical screenshot.');
  if (input.acknowledgedWarning) reasons.push('The family saw the warning and said the image was right.');
  return { ...base, verdict: 'review', familyReason: null };
}

export function visionEnabled(): boolean {
  return process.env.MPMB_VISION === 'true';
}

type VisionClient = import('@google-cloud/vision').ImageAnnotatorClient;
let client: VisionClient | null = null;

async function visionClient(): Promise<VisionClient> {
  if (!client) {
    const { ImageAnnotatorClient } = await import('@google-cloud/vision');
    client = new ImageAnnotatorClient({ apiEndpoint: process.env.MPMB_VISION_ENDPOINT ?? 'eu-vision.googleapis.com' });
  }
  return client;
}

function likelihood(value: unknown): Likelihood {
  if (typeof value === 'number') return LIKELIHOODS[value] ?? 'UNKNOWN';
  return LIKELIHOODS.includes(value as Likelihood) ? (value as Likelihood) : 'UNKNOWN';
}

/** SafeSearch and text detection on one image. The image is sent, inspected and not kept by the API. */
export async function inspectWithVision(image: Buffer): Promise<VisionFindings> {
  const vision = await visionClient();
  const [result] = await vision.annotateImage({
    image: { content: image },
    features: [{ type: 'SAFE_SEARCH_DETECTION' }, { type: 'TEXT_DETECTION' }],
  });
  if (result.error?.message) throw new Error(result.error.message);
  const s = result.safeSearchAnnotation;
  return {
    safeSearch: s ? { adult: likelihood(s.adult), violence: likelihood(s.violence), racy: likelihood(s.racy), medical: likelihood(s.medical), spoof: likelihood(s.spoof) } : null,
    text: result.fullTextAnnotation?.text ?? result.textAnnotations?.[0]?.description ?? '',
  };
}
