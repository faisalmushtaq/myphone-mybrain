export interface EntryLink {
  who: 'parent' | 'young' | null;
  optOut: boolean;
}

/**
 * The website's buttons open the form with ?who=parent, ?who=young or
 * ?optout=1 to say where it starts. The welcome screen reads that once and it
 * is dropped from the address, so that after "Finish and clear this device",
 * "Start again" or the privacy clear the next person on the device sees the
 * welcome screen and chooses for themselves. ?school= stays: it only fills in
 * the school, which can be changed.
 */
export function takeEntryLink(): EntryLink {
  const params = new URLSearchParams(window.location.search);
  const who = params.get('who');
  const link: EntryLink = { who: who === 'parent' || who === 'young' ? who : null, optOut: params.get('optout') === '1' };
  if (params.has('who') || params.has('optout')) {
    params.delete('who');
    params.delete('optout');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  }
  return link;
}
