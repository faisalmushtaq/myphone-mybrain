/**
 * Tells the site's anonymous usage counter (assets/js/usage.js) which form
 * this is, which way through it, which step is on screen, and when a step
 * listed fields to fix or a save failed, so the team can see where people
 * get stuck. Only step names and field ids are passed, never what anyone
 * typed. Before the counter has loaded the calls wait in a short queue; on a
 * page without it (the standalone preview) they go nowhere.
 */
type Method = 'app' | 'variant' | 'part' | 'event';
type Call = [Method, ...unknown[]];

interface UsageCounter {
  app(name: string): void;
  variant(name: string): void;
  part(name: string): void;
  event(type: string, data?: Record<string, unknown>): void;
}

declare global {
  interface Window {
    mpmbUsage?: UsageCounter;
    mpmbUsageQueue?: Call[];
  }
}

function call(...args: Call) {
  if (typeof window === 'undefined') return;
  const counter = window.mpmbUsage;
  if (counter) {
    const [method, ...rest] = args;
    (counter[method] as (...a: unknown[]) => void)(...rest);
    return;
  }
  const queue = (window.mpmbUsageQueue ??= []);
  if (queue.length < 200) queue.push(args);
}

export const usage = {
  app: (name: 'family' | 'break') => call('app', name),
  variant: (name: string) => call('variant', name),
  part: (name: string) => call('part', name),
  errors: (fields: string[]) => call('event', 'errors', { fields }),
  saveFailed: () => call('event', 'save-failed'),
};
