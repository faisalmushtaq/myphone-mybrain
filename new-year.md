---
layout: default
title: "New Year social media break (preview) | MyPhone/MyBrain"
description: "Preview of a self-run New Year break from social media, with a tracker, daily check-ins and short memory and attention checks. Not open yet; nothing leaves your device."
permalink: /new-year/
noindex: true
---

<div id="mpmb-newyear-app" class="mpmb-app-mount">
  <noscript>
    <div class="container" style="padding: 3rem 0;">
      <h1>New Year social media break</h1>
      <p>This preview needs JavaScript, which is switched off in your browser. It is not open to take part in yet. Questions: <a href="mailto:{{ site.email }}">{{ site.email }}</a>.</p>
    </div>
  </noscript>
  <p class="mpmb-app-loading container" aria-hidden="true">Loading…</p>
</div>

<link rel="stylesheet" href="{{ '/assets/consent-app/consent-app.css' | relative_url }}?v={{ site.time | date: '%s' }}">
<script type="module" src="{{ '/assets/consent-app/newyear-app.js' | relative_url }}?v={{ site.time | date: '%s' }}"></script>
