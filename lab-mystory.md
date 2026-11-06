---
layout: default
title: "MyStory: MyPhone/MyBrain lab study | MyPhone/MyBrain"
description: "MyStory: a short chat, in your own words, for people taking part in the MyPhone/MyBrain lab study."
permalink: /lab/mystory/
noindex: true
---

<div id="mpmb-lab-app" class="mpmb-app-mount" data-group="control" data-flow="story">
  <noscript>
    <div class="container" style="padding: 3rem 0;">
      <h1>MyStory</h1>
      <p>This page needs JavaScript, which is switched off in your browser. Questions: contact Miftah Faizah at <a href="mailto:M.Faizah@leeds.ac.uk">M.Faizah@leeds.ac.uk</a>.</p>
    </div>
  </noscript>
  <p class="mpmb-app-loading container" aria-hidden="true">Loading…</p>
</div>

<link rel="stylesheet" href="{{ '/assets/consent-app/consent-app.css' | relative_url }}?v={{ site.time | date: '%s' }}">
<script type="module" src="{{ '/assets/consent-app/lab-app.js' | relative_url }}?v={{ site.time | date: '%s' }}"></script>
