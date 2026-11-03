import { GoogleAuth } from 'google-auth-library';
import { sheetErrorText, sheetRequests, type ExistingTab, type Tab } from './portalSheets.js';

/**
 * Sends the staff portal's sheet to Google (5 November 2026), as the
 * functions' own service account: the project manager shares the sheet with
 * that address as an Editor, and nothing else is needed (no key). The Sheets
 * API must be turned on in the project.
 */

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'myphone-mybrain';

let auth: GoogleAuth | null = null;
const authOf = () => (auth ??= new GoogleAuth({ scopes: SCOPES }));

/** The address the sheet must be shared with: the functions' service account. Empty when it cannot be found (the emulator). */
export async function serviceAccountEmail(): Promise<string> {
  try {
    const creds = await authOf().getCredentials();
    return creds.client_email ?? '';
  } catch {
    return '';
  }
}

export class SheetError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Record<string, unknown>> {
  const client = await authOf().getClient();
  const headers = await client.getRequestHeaders();
  const res = await fetch(url, { method, headers: { ...(headers instanceof Headers ? Object.fromEntries(headers.entries()) : (headers as Record<string, string>)), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error ?? {}) as { message?: string; status?: string; details?: { reason?: string }[] };
    const reason = (err.details ?? []).map((d) => d.reason).filter(Boolean).join(' ');
    throw new SheetError(res.status, `${err.status ?? ''} ${reason} ${err.message ?? res.statusText}`.trim());
  }
  return json;
}

/** Writes every tab to the spreadsheet (tabs the team added are left alone). Returns the spreadsheet's title. */
export async function writeWorkbook(spreadsheetId: string, tabs: Tab[]): Promise<string> {
  const meta = await call('GET', `${API}/${spreadsheetId}?fields=properties.title,sheets(properties(sheetId,title),bandedRanges(bandedRangeId))`);
  const sheets = (meta.sheets ?? []) as { properties: { sheetId: number; title: string }; bandedRanges?: { bandedRangeId: number }[] }[];
  const existing: ExistingTab[] = sheets.map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title, bandIds: (s.bandedRanges ?? []).map((b) => b.bandedRangeId) }));
  const requests = sheetRequests(tabs, existing);
  // Large tables go in a few calls, so no one call is too big.
  const chunks: Record<string, unknown>[][] = [];
  let size = 0;
  for (const r of requests) {
    const n = JSON.stringify(r).length;
    if (!chunks.length || size + n > 4_000_000) {
      chunks.push([]);
      size = 0;
    }
    chunks.at(-1)!.push(r);
    size += n;
  }
  for (const chunk of chunks) await call('POST', `${API}/${spreadsheetId}:batchUpdate`, { requests: chunk });
  return String((meta.properties as { title?: string } | undefined)?.title ?? '');
}

/** An error from Google, or anything else, in words for the settings page. */
export function syncErrorText(error: unknown, serviceAccount: string): string {
  if (error instanceof SheetError) return sheetErrorText(error.status, error.message, serviceAccount, PROJECT);
  const m = error instanceof Error ? error.message : String(error);
  if (/Could not load the default credentials|metadata/i.test(m)) return 'The portal could not sign in to Google from here (this works once deployed).';
  return `The sync failed: ${m.slice(0, 300)}`;
}
