# The address finder

Parents give their home address on the family form, for linking the young
person's records. The address finder helps them give it completely and spelt
the way official records spell it, and adds the property's **UPRN** (Ordnance
Survey's Unique Property Reference Number), which makes linking far more
reliable than matching address text.

It uses **Ideal Postcodes** (ideal-postcodes.co.uk, decided 7 October 2026;
getAddress.io closed in February 2026, and postcodes.io has postcodes but no
addresses). **It is built and switched off** until the study has an account.
While it is off, parents type their address and postcode as before.

## What parents see

When it is on, the parent's address comes in two parts on "Your details":

1. **Your postcode**, with a **Find your address** button. The addresses at
   that postcode appear in a list. Picking one fills in the address box.
   "My address isn't listed" takes them to the address box to type it.
2. **Your home address**. As they type (three characters or more),
   addresses matching what they have typed appear under the box. Choosing
   one, with a tap or the arrow keys and Enter, fills in the address and the
   postcode. A postcode already in the box puts addresses there first.

Either way the address stays editable. The hint says it came from the
address list, and the UPRN is kept with it. Changing the address or the
postcode by hand drops the UPRN, so a stored UPRN always belongs to the
stored address. If nothing matches, or the finder is not answering, they
type the address; nothing is lost.

## Turning it on

1. **Account.** Open an account at ideal-postcodes.co.uk and buy credit (see
   Cost). In the dashboard, on the API key:
   * **Allowed URLs: leave empty.** Requests come from the study's server,
     not from browsers, so a web-address restriction would refuse them all.
   * **Daily limit:** set one, for example 1,500, as a second guard beside the
     site's own (below).
   * **Usage history:** set the period after which Ideal Postcodes redacts
     personal data from the key's usage log (the search terms) to **0
     days**. The default is 28.
   * **Notifications:** ask for a low-balance email to brainpop@leeds.ac.uk.
2. **Store the key** in Secret Manager, in Cloud Shell
   (shell.cloud.google.com):
   `bash consent-app/firebase/scripts/set-address-key.sh myphone-mybrain`.
   It asks for the key without showing it. Never put the key in the code,
   GitHub, an email or a chat. The functions pick it up within about ten
   minutes; no redeploy is needed.
3. **Show it on the form:** change `VITE_MPMB_ADDRESS_LOOKUP=off` to `on` in
   `consent-app/.env.production` and push to `main`; the site rebuilds.
4. **Check:** open the form as a parent, find your own address both ways,
   then look at the Ideal Postcodes dashboard: there should be two lookups.

To switch it off again, set the line back to `off` and push. Removing the
key also stops it, and the form then quietly asks parents to type.

## Cost

A **lookup** is one credit: a postcode search that finds addresses, or a
suggestion chosen and fetched in full. An unknown postcode costs nothing, and
neither do the suggestions as someone types. Most families use one lookup, a
few two or three. Credit lasts 12 months, and the UPRN costs nothing extra.

Prices at the time of writing (check ideal-postcodes.co.uk): 200 lookups
£9, 1,100 £42, 4,300 £155, 12,800 £420, 32,100 £900. For 1,000 families,
allow about 1,500 lookups.

## Limits, and when it stops

* **Per browser session:** 5 lookups and 60 suggestions an hour.
* **For the whole site, per day:** `MPMB_ADDRESS_DAILY_CAP` lookups (1,500
  unless the repository variable of that name says otherwise; the deploy
  workflow passes it on), enough for 600 or more families on a busy day,
  and ten times as many suggestions. Ideal Postcodes
  suspends accounts that ask for many suggestions without fetching
  addresses, so the suggestions' cap matters as much as the lookups'.

When a limit is reached, or the account runs out of credit, or Ideal
Postcodes refuses the key, families are asked to type their address. The
team gets **one email a day** saying why ("MyPhone/MyBrain — the address
finder has stopped"), from the same account as the enquiry emails.

## Privacy and the DPIA

* The family's browser asks the study's own function (`findAddresses`),
  and the function asks Ideal Postcodes. So Ideal Postcodes receives the
  postcode, or the part of the address typed so far, and the chosen address's
  id, from Google's servers. It never receives the family's IP address,
  their name or anything else from the form. Nothing typed is logged by the
  function.
* Ideal Postcodes keeps search terms in the key's usage log until it
  redacts them, after 28 days unless the dashboard says otherwise (step 1:
  set it to 0). It is a **processor** for this: name it in the DPIA and the
  University's record of processing, with its terms, and in the privacy
  notice's list of who handles data.
* The UPRN is stored with the parent's address (`participants/`,
  `guardian.uprn`) and exported only to
  `schools/identifying/participants_key.tsv`, never to the research dataset.

## Where it is

| Path | What |
| --- | --- |
| `src/components/AddressFinder.tsx` | `AddressFinder` (the postcode and its list) and `AddressSearch` (the address box with suggestions) |
| `src/components/GuardianFields.tsx` | Uses them when `addressFinder` is on (`src/config/features.ts`, from `VITE_MPMB_ADDRESS_LOOKUP`) |
| `firebase/functions/src/address.ts` | The `findAddresses` callable: `{ postcode }`, `{ search, near }` and `{ pick }`, the limits and the team's email |
| `firebase/scripts/set-address-key.sh` | Stores the key in Secret Manager (`mpmb-address-key`) |
| `src/api/mock.ts` | Made-up addresses for the standalone preview, which always shows the finder |
| `scripts/emulator-e2e.mjs` | Builds the form with the finder on and tests it against a stand-in for Ideal Postcodes |
