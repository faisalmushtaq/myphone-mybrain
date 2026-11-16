---
layout: default
title: "Daily messages: social media break study | MyPhone/MyBrain"
description: "Turn the daily messages off, or on again, during the MyPhone/MyBrain social media break study."
permalink: /break/messages/
noindex: true
---

<!-- Turning the daily messages off (16 November 2026). The link in each daily message brings the participant ID (?code=). The check-ins and the visit reminders still come. -->
<section class="section">
  <div class="container narrow-content daily-messages" data-daily-messages>
    <h1>Your daily messages</h1>
    <p>During your break we send you a short message every day. If you would rather not get them, you can turn them off here. <strong>You will still get your weekly check-ins and the reminders before each lab visit</strong>, as these are part of the study.</p>
    <p class="daily-messages__status" role="status" aria-live="polite" data-status>Checking your settings…</p>
    <div class="daily-messages__actions">
      <button type="button" class="btn btn-primary" data-turn="off" hidden>Turn off my daily messages</button>
      <button type="button" class="btn btn-secondary" data-turn="on" hidden>Turn my daily messages back on</button>
    </div>
    <p>You can also email Miftah Faizah at <a href="mailto:M.Faizah@leeds.ac.uk">M.Faizah@leeds.ac.uk</a> and we will turn them off for you. Turning them off doesn’t change anything else about your part in the study.</p>
  </div>
</section>

<script src="{{ '/assets/js/daily-messages.js' | relative_url }}" data-endpoint="{{ site.daily_messages_endpoint }}" defer></script>
