import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getApi } from '../api';
import { ApiError, type AddressSuggestion, type ConsentApi, type FoundAddress } from '../api/types';
import { guardianFields } from '../config/fields';
import { limits, UK_POSTCODE } from '../lib/validation';
import type { GuardianIdentity, SessionInfo } from '../model/types';
import { useStore } from '../state/context';
import { Button } from './ui/Button';
import { describedBy, FieldWrapper, SelectField, TextField } from './ui/Field';

/**
 * Finding the parent's address (Ideal Postcodes, through the findAddresses
 * function; on with VITE_MPMB_ADDRESS_LOOKUP, see src/config/features.ts), two
 * ways: their postcode and a "Find your address" button, then the addresses at
 * it to pick from (AddressFinder); or suggestions as they type their address,
 * the one they choose then fetched in full (AddressSearch). Either fills in
 * the address box, which stays editable, and the postcode, and keeps the
 * property's UPRN with them; changing the address or the postcode by hand
 * drops the UPRN. If nothing matches, or the finder is not set up or not
 * answering, the parent types the address as before.
 */

interface Props {
  guardian: GuardianIdentity;
  update: (patch: Partial<GuardianIdentity>) => void;
  errors: Record<string, string>;
}

const compact = (postcode: string) => postcode.toUpperCase().replace(/\s+/g, '');

/** Calls the address finder with the form's session, starting one if there is none yet, and once more with a new one if it has expired. */
function useAddressCall() {
  const { state, dispatch } = useStore();
  const session = useRef(state.session);
  session.current = state.session;
  return useCallback(
    async <T,>(ask: (api: ConsentApi, session: SessionInfo) => Promise<T>): Promise<T> => {
      const api = getApi();
      let current = session.current ?? (await api.startSession());
      if (!session.current) dispatch({ type: 'session', session: current });
      try {
        return await ask(api, current);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'expired')) throw error;
        current = await api.startSession();
        dispatch({ type: 'session', session: current });
        return ask(api, current);
      }
    },
    [dispatch],
  );
}

type Finder = { status: 'idle' | 'busy' | 'not-found' | 'unavailable' | 'invalid' } | { status: 'found'; postcode: string; addresses: FoundAddress[] };

/** The postcode box, a "Find your address" button, and the addresses at the postcode to pick from. */
export function AddressFinder({ guardian, update, errors: errs }: Props) {
  const call = useAddressCall();
  const [lookup, setFinder] = useState<Finder>({ status: 'idle' });
  const [picked, setPicked] = useState('');
  // A postcode filled in from a suggestion below leaves the list for the old one behind.
  const finder: Finder = lookup.status === 'found' && compact(lookup.postcode) !== compact(guardian.postcode) ? { status: 'idle' } : lookup;

  const find = async () => {
    if (finder.status === 'busy') return;
    const postcode = guardian.postcode.trim();
    if (!UK_POSTCODE.test(postcode)) {
      setFinder({ status: 'invalid' });
      return;
    }
    setFinder({ status: 'busy' });
    setPicked('');
    try {
      const result = await call((api, session) => api.findAddresses(session, postcode));
      setFinder(result.status === 'found' ? result : { status: result.status });
    } catch (error) {
      setFinder({ status: error instanceof ApiError && error.code === 'validation' ? 'invalid' : 'unavailable' });
    }
  };

  const pick = (value: string) => {
    setPicked(value);
    if (finder.status !== 'found' || value === '') return;
    if (value === 'not-listed') {
      update({ uprn: '' });
      window.setTimeout(() => document.getElementById('guardian-address')?.focus(), 0);
      return;
    }
    const chosen = finder.addresses[Number(value)];
    if (chosen) update({ address: chosen.address, postcode: finder.postcode, uprn: chosen.uprn ?? '' });
  };

  // Enter in the postcode box finds the address, rather than trying to leave the page.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void find();
  };

  const message =
    finder.status === 'not-found'
      ? 'We couldn’t find any addresses for that postcode. Check it, or type your address below.'
      : finder.status === 'unavailable'
        ? 'The address finder isn’t working just now. Please type your address below.'
        : finder.status === 'invalid'
          ? 'Enter a full UK postcode, for example LS2 9JT, then press “Find your address”.'
          : finder.status === 'found'
            ? `${finder.addresses.length} address${finder.addresses.length === 1 ? '' : 'es'} at ${finder.postcode}: choose yours below.`
            : '';

  return (
    <div className="mpmb-address-finder">
      <div className="mpmb-address-finder__row">
        <TextField
          id="guardian-postcode"
          label="Your postcode"
          hint={guardianFields.postcode.hint}
          required
          autoComplete="postal-code"
          autoCapitalize="characters"
          maxLength={limits.postcode}
          width="short"
          className="mpmb-input--upper"
          value={guardian.postcode}
          onChange={(e) => {
            update(guardian.uprn ? { postcode: e.target.value, uprn: '' } : { postcode: e.target.value });
            if (finder.status !== 'idle' && finder.status !== 'busy') setFinder({ status: 'idle' });
          }}
          onKeyDown={onKey}
          error={errs['guardian-postcode']}
        />
        <Button variant="secondary" onClick={() => void find()} loading={finder.status === 'busy'}>
          Find your address
        </Button>
      </div>
      {message && (
        <p className="mpmb-hint mpmb-address-finder__status" aria-hidden="true">
          {message}
        </p>
      )}
      <p className="mpmb-sr-only" role="status">
        {message}
      </p>
      {finder.status === 'found' && (
        <SelectField
          id="guardian-address-pick"
          label="Choose your address"
          options={[...finder.addresses.map((a, i) => ({ value: String(i), label: a.label })), { value: 'not-listed', label: 'My address isn’t listed' }]}
          placeholder="Choose"
          value={picked}
          onChange={(e) => pick(e.target.value)}
        />
      )}
    </div>
  );
}

const MIN_LENGTH = 3;
const WAIT_MS = 300;
const LIST = 'guardian-address-suggestions';
const option = (i: number) => `guardian-address-option-${i}`;
/** A search is remembered by the words typed and the postcode box it was made near. */
const searchKey = (text: string, near: string) => `${text.replace(/\s+/g, ' ').trim().toLowerCase()}|${compact(near)}`;

/**
 * The address box, with addresses matching what the parent types listed
 * under it (a combobox: arrow keys and Enter, or a tap). The list is free to
 * show; the chosen address is then fetched in full, which costs a lookup.
 */
export function AddressSearch({ guardian, update, errors: errs }: Props) {
  const call = useAddressCall();
  const [list, setList] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [spoken, setSpoken] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const address = useRef(guardian.address);
  address.current = guardian.address;
  // Once the finder says "unavailable" (not set up, or this browser has asked for a lot), the box is a plain one.
  const off = useRef(false);
  const cache = useRef(new Map<string, AddressSuggestion[]>());
  const wanted = useRef('');
  const timer = useRef<number | undefined>(undefined);
  const closing = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(closing.current);
    },
    [],
  );

  // The address picked with the arrow keys stays in view.
  useEffect(() => {
    if (open && active >= 0) document.getElementById(option(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const show = (key: string, suggestions: AddressSuggestion[]) => {
    if (key !== wanted.current) return;
    // Shown only while the parent is still in the box: an answer that comes after they have moved on waits for them.
    const visible = suggestions.length > 0 && document.activeElement === input.current;
    setList(suggestions);
    setActive(-1);
    setOpen(visible);
    setSpoken(visible ? `${suggestions.length} matching address${suggestions.length === 1 ? '' : 'es'}. Use the up and down arrow keys to choose one, then press Enter.` : '');
  };

  const search = (text: string) => {
    window.clearTimeout(timer.current);
    const near = guardian.postcode;
    const key = searchKey(text, near);
    wanted.current = key;
    if (off.current || text.replace(/\s+/g, ' ').trim().length < MIN_LENGTH || !/[A-Za-z0-9]/.test(text)) {
      setList([]);
      close();
      return;
    }
    const known = cache.current.get(key);
    if (known) {
      show(key, known);
      return;
    }
    timer.current = window.setTimeout(() => {
      call((api, session) => api.suggestAddresses(session, text, near))
        .then((result) => {
          if (result.status === 'unavailable') {
            off.current = true;
            if (key === wanted.current) {
              setList([]);
              close();
            }
            return;
          }
          cache.current.set(key, result.suggestions);
          show(key, result.suggestions);
        })
        .catch(() => {
          /* Not answering (offline, perhaps): the next letter typed tries again. */
        });
    }, WAIT_MS);
  };

  const choose = async (chosen: AddressSuggestion) => {
    window.clearTimeout(timer.current);
    wanted.current = '';
    close();
    setBusy(true);
    setNotice('');
    setSpoken('Getting the full address.');
    const typed = address.current;
    try {
      const result = await call((api, session) => api.pickAddress(session, chosen.id));
      // Typed over while it was fetched: what they typed stays.
      if (address.current !== typed) return;
      if (result.status === 'picked') {
        update({ address: result.address, postcode: result.postcode, uprn: result.uprn ?? '' });
        setList([]);
        setSpoken(`Filled in: ${result.address}, ${result.postcode}.`);
      } else if (result.status === 'not-found') {
        setNotice('We couldn’t get that address. Choose another, or type your address in full.');
        setSpoken('We couldn’t get that address. Choose another, or type your address in full.');
        setOpen(list.length > 0);
      } else {
        off.current = true;
        setNotice('The address finder isn’t working just now. Please type your address in full.');
        setSpoken('The address finder isn’t working just now. Please type your address in full.');
      }
    } catch {
      setNotice('We couldn’t get that address just now. Check your connection, or type your address in full.');
      setSpoken('We couldn’t get that address just now. Check your connection, or type your address in full.');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (busy) return;
    if (e.key === 'ArrowDown' && list.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      // Up from the first address goes back to what was typed.
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault();
      void choose(list[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  };

  const hint = guardian.uprn ? 'From the address list. Change it if anything is wrong.' : 'Start typing, then choose your address from the list, or type it in full.';
  const error = errs['guardian-address'];

  return (
    <FieldWrapper id="guardian-address" label={guardianFields.address.label} hint={hint} error={error} required>
      <div className="mpmb-suggest">
        <input
          ref={input}
          id="guardian-address"
          className="mpmb-input mpmb-input--full"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={LIST}
          aria-activedescendant={open && active >= 0 ? option(active) : undefined}
          aria-describedby={describedBy('guardian-address', hint, error)}
          aria-invalid={error ? true : undefined}
          aria-required
          autoComplete="street-address"
          maxLength={limits.address}
          value={guardian.address}
          onChange={(e) => {
            update(guardian.uprn ? { address: e.target.value, uprn: '' } : { address: e.target.value });
            setNotice('');
            search(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => window.clearTimeout(closing.current)}
          // Wait a moment, so a tap on an address counts before the list goes.
          onBlur={() => {
            closing.current = window.setTimeout(close, 150);
          }}
        />
        <ul id={LIST} className="mpmb-suggest__list" role="listbox" aria-label="Matching addresses" hidden={!open}>
          {list.map((s, i) => (
            <li
              key={s.id}
              id={option(i)}
              className={`mpmb-suggest__option${i === active ? ' is-active' : ''}`}
              role="option"
              aria-selected={i === active}
              // Keeps the focus in the box, so choosing does not close the list first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void choose(s)}
            >
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      {(busy || notice) && (
        <p className="mpmb-hint mpmb-address-finder__status" aria-hidden="true">
          {busy ? 'Getting the full address…' : notice}
        </p>
      )}
      <p className="mpmb-sr-only" role="status">
        {spoken}
      </p>
    </FieldWrapper>
  );
}
