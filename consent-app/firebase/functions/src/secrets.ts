import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logger } from 'firebase-functions/v2';

/**
 * Secrets the functions need at run time (the staff password, the text
 * message service's credentials), read from Secret Manager, where a Cloud
 * Shell script puts them once; never in the repository or GitHub. Cached for
 * ten minutes; null while a secret does not exist yet, so the feature that
 * needs it says it is not set up rather than failing.
 *
 * In the emulator there is no Secret Manager: fixed test values stand in
 * (FUNCTIONS_EMULATOR is only ever set by the emulator).
 */

const CACHE_FOR = 10 * 60_000;
const RETRY_AFTER = 2 * 60_000;
const cache = new Map<string, { value: string | null; at: number }>();
let client: SecretManagerServiceClient | null = null;

/** Values used only by the emulator's end-to-end test. */
export const EMULATOR_SECRETS: Record<string, string> = {
  'mpmb-staff-key': 'emulator-staff-key',
  'mpmb-address-key': 'emulator-address-key',
};

export async function readSecret(name: string): Promise<string | null> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') return EMULATOR_SECRETS[name] ?? null;
  const now = Date.now();
  const hit = cache.get(name);
  if (hit && now - hit.at < (hit.value ? CACHE_FOR : RETRY_AFTER)) return hit.value;
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) return null;
  try {
    client ??= new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({ name: `projects/${project}/secrets/${name}/versions/latest` });
    const data = version.payload?.data;
    const value = (typeof data === 'string' ? data : data ? Buffer.from(data).toString('utf8') : '').trim() || null;
    cache.set(name, { value, at: now });
    return value;
  } catch (error) {
    cache.set(name, { value: null, at: now });
    logger.info('Secret not available yet', { name, error: String((error as Error).message ?? error).slice(0, 200) });
    return null;
  }
}
