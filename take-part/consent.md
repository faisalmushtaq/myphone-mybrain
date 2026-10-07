---
layout: default
title: "Take part online | MyPhone/MyBrain"
description: "Share your child’s screen time for MyPhone/MyBrain online, or carry on with your reference."
permalink: /take-part/consent/
noindex: true
---

<div id="mpmb-consent-app" class="mpmb-app-mount">
  <noscript>
    <div class="container" style="padding: 3rem 0;">
      <h1>Take part online</h1>
      <p>This form needs JavaScript, which is switched off in your browser. You can still take part: <a href="{{ '/contact/' | relative_url }}">contact the team</a> and we will send you a paper form or a link that works for you.</p>
    </div>
  </noscript>
  <p class="mpmb-app-loading container" aria-hidden="true">Loading the form…</p>
</div>

<link rel="stylesheet" href="{{ '/assets/consent-app/consent-app.css' | relative_url }}?v={{ site.time | date: '%s' }}">
<script type="module" src="{{ '/assets/consent-app/consent-app.js' | relative_url }}?v={{ site.time | date: '%s' }}"></script>
