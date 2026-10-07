/**
 * Features that are built but switched on separately, from the build's
 * environment (consent-app/.env.production for the live site).
 *
 * The address finder (src/components/AddressFinder.tsx): the parent finds
 * their address from their postcode, or picks it from suggestions as they
 * type it. On once the Ideal Postcodes key is stored
 * (firebase/scripts/set-address-key.sh, see docs/address-lookup.md); the
 * standalone preview always shows it, with made-up addresses.
 */
export const addressFinder = import.meta.env.VITE_MPMB_ADDRESS_LOOKUP === 'on' || __STANDALONE__;
