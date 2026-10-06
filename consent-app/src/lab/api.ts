import { getApi } from '../api';
import { ApiError, type ClientInfo } from '../api/types';
import type { SessionInfo } from '../model/types';

export function labClientInfo(): ClientInfo {
  return { userAgent: navigator.userAgent.slice(0, 200), submittedAt: new Date().toISOString(), timezoneOffset: new Date().getTimezoneOffset() };
}

/** A session to call the server with, starting one if needed. */
export async function labSession(current: SessionInfo | null, remember: (s: SessionInfo) => void): Promise<SessionInfo> {
  if (current) return current;
  const session = await getApi().startSession();
  remember(session);
  return session;
}

export function describeError(error: unknown, what: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'network':
        return `We couldn’t reach the server to save ${what}. Check your connection and try again; nothing you entered has been lost.`;
      case 'validation':
        return `The server found a problem with ${what}${error.message ? `: ${error.message}` : ''}.`;
      case 'expired':
        return 'Your session timed out. Please try again.';
      case 'too-large':
        return 'That file is too large to upload.';
      default:
        return `Something went wrong on our side and ${what} could not be saved. Please try again in a moment.`;
    }
  }
  return `Something went wrong and ${what} could not be saved. Please try again.`;
}
