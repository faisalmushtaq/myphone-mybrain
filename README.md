# MyPhone/MyBrain Project Website

This repository contains the public website for **MyPhone/MyBrain**, a University of Leeds research programme funded by the **Huo Family Foundation**.

The site uses the same lightweight infrastructure as `brainpop-site`: **Jekyll**, **GitHub Pages**, plain-text YAML content files, and simple HTML includes. It is designed to be easy for the project team to update without needing to edit code.

## Updating content

Most public-facing text is in `_data/content.yml`. The school sign-up settings are also in that file, including the destination email address used by the form.

People are listed in `_data/people.yml`, partners and funders in `_data/partners.yml`, and frequently asked questions in `_data/faqs.yml`.

## Project structure

```text
myphone-mybrain/
├── _data/
│   ├── content.yml
│   ├── faqs.yml
│   ├── partners.yml
│   └── people.yml
├── _includes/
│   ├── about.html
│   ├── contact.html
│   ├── faq.html
│   ├── footer.html
│   ├── header.html
│   ├── hero.html
│   ├── partners.html
│   ├── people.html
│   ├── process.html
│   └── signup.html
├── _layouts/default.html
├── assets/
│   ├── css/style.css
│   └── js/form.js
├── index.md
└── _config.yml
```

## Consent and phone-use donation app (prototype)

`consent-app/` contains a React + TypeScript application (built with Vite) that mounts inside the site at `/take-part/consent/`. It lets a parent or guardian give consent, records the young person's own agreement (sent to the server the moment they have signed, so participation is on record even if the family stops there), and collects screenshots of the phone's screen-time summary, which are checked for safety and relevance before they are kept. All participant-facing wording is placeholder text marked "Draft wording" in the interface.

It has two backends: an in-memory **mock** (the default; nothing leaves the page) and **Firebase** (`consent-app/firebase/`, see `consent-app/docs/firebase.md`), chosen by repository variables at build time.

* Design and data model: `consent-app/docs/journey.md`, `consent-app/docs/architecture.md`
* Wording that must be replaced before use: `consent-app/docs/content-placeholders.md`
* Review findings and what was changed: `consent-app/docs/review.md`
* Backend set-up and data model: `consent-app/docs/firebase.md`

The same build also produces the **social media break study** pages for adults (`/break/`, with the consent and data-donation flow at `/break/take-part/`, a weekly check-in at `/break/check-in/` and the after-break donation at `/break/after/`, code in `consent-app/src/lab/`): participants make the code the lab questionnaire uses, consent with the approved wording, send screenshots of their phone's screen-time summary straight away, follow a guide to request their TikTok, YouTube or Instagram data (which can take days to arrive, so they can ask for an email reminder), clean the download on their own device (only dates, links and search words survive, and they untick categories), and send the cleaned archive. During the break they check in with a few questions, and afterwards they send both again on a shorter page without signing again; everything is filed under their participant code, on any device. The server accepts only the cleaner's own files.

The deploy workflow builds the app (`npm ci && npm run build` in `consent-app/`, output to `assets/consent-app/`, which is git-ignored: `consent-app.js`, `lab-app.js` and a shared `consent-app.css`) before building Jekyll. For a local preview, run that build first and then `bundle exec jekyll serve`; for a self-contained preview without Jekyll, run `npm run build:standalone` and open `consent-app/dist-standalone/preview.html`.

## Contact and school forms

Both forms post to the `enquiry` Cloud Function in `consent-app/firebase/functions` (the address is `enquiry_endpoint` in `_config.yml`). Each message is stored in the Firestore `enquiries` collection and emailed to the team by the function itself over SMTP, once the Gmail app password has been stored with `consent-app/firebase/scripts/set-mail-password.sh`. If the address is left empty, the forms fall back to opening an email draft. The school form requires two or more year groups and confirmation that the school can offer two-hour session slots for groups of up to 30 pupils.

## Local preview

Install Jekyll and run:

```bash
bundle exec jekyll serve
```

The live site is expected to be served through GitHub Pages at:

<https://myphonemybrain.com/>
