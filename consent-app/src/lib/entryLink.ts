export interface EntryLink {
  who: 'parent' | 'young' | null;
  optOut: boolean;
  /** Carrying on with a record: ?finish=MPMB-… from the thank-you page or the copy of the record, or ?finish alone (from the FAQ) with the reference still to type. */
  finish: string | null;
}

/** The reference a ?finish= link carried, kept for the carry-on step until it has read it. */
let pendingReference: string | null = null;

/**
 * The website's buttons open the form with ?who=parent, ?who=young or
 * ?optout=1 to say where it starts, and the thank-you page's link with
 * ?finish=<reference> to carry on with a record later. The welcome screen
 * reads that once and it is dropped from the address, so that after "Finish
 * and clear this device", "Start again" or the privacy clear the next person
 * on the device sees the welcome screen and chooses for themselves. ?school=
 * stays: it only fills in the school, which can be changed.
 */
export function takeEntryLink(): EntryLink {
  const params = new URLSearchParams(window.location.search);
  const who = params.get('who');
  const link: EntryLink = { who: who === 'parent' || who === 'young' ? who : null, optOut: params.get('optout') === '1', finish: params.has('finish') ? (params.get('finish') ?? '').slice(0, 40) : null };
  // Kept until forgotten (not cleared by reading), so a second look in development's double render still finds it.
  if (link.finish) pendingReference = link.finish;
  if (params.has('who') || params.has('optout') || params.has('finish')) {
    params.delete('who');
    params.delete('optout');
    params.delete('finish');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  }
  return link;
}

/** The reference a ?finish= link carried, if any. */
export function peekFinishReference(): string {
  return pendingReference ?? '';
}

/** Forgets that reference: once the record is found, or when the device is cleared for the next person. */
export function forgetFinishReference(): void {
  pendingReference = null;
}

/** A reference as typed: upper case, spaces gone, the dashes put back (MPMB-ABCD-EF2). Anything else is returned tidied but unchanged. */
export function normaliseReference(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length === 11 && compact.startsWith('MPMB') ? `MPMB-${compact.slice(4, 8)}-${compact.slice(8)}` : input.trim().toUpperCase();
}

export const REFERENCE = /^MPMB-[A-Z2-9]{4}-[A-Z2-9]{3}$/;

/** The link that brings a family back to carry on with their record: this page, with ?finish=<reference>. */
export function finishLink(referenceCode: string): string {
  return `${window.location.origin}${window.location.pathname}?finish=${encodeURIComponent(referenceCode)}`;
}
