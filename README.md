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

## School sign-up form

Because this site runs on GitHub Pages, there is no server-side form processor. The form is therefore implemented as a styled, accessible `mailto:` workflow. When a teacher completes the form, it opens their email client with a structured message already populated. The team can later swap this for Qualtrics, Microsoft Forms, REDCap, Formspree, or another approved University of Leeds form service by changing the form script or replacing the sign-up section.

## Local preview

Install Jekyll and run:

```bash
bundle exec jekyll serve
```

The live site is expected to be served through GitHub Pages at:

<https://faisalmushtaq.github.io/myphone-mybrain/>
