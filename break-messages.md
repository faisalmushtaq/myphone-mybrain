---
layout: default
title: "Daily messages: social media break study | MyPhone/MyBrain"
description: "Turn on, or off, the daily messages during the MyPhone/MyBrain social media break study."
permalink: /break/messages/
noindex: true
---

<!-- Daily messages on or off (16 November 2026): off unless the participant turns them on. Links from the booking page, the booking email and each daily message bring the participant ID (?code=). The check-ins and the visit reminders come either way. -->
<section class="section">
  <div class="container narrow-content daily-messages" data-daily-messages>
    <h1>Your daily messages</h1>
    <p>During your break we can send you a short, encouraging message every day. They are off unless you turn them on, and you can turn them off again at any time. <strong>Either way, you will get your weekly check-ins and the reminders before each lab visit</strong>, as these are part of the study.</p>
    <p class="daily-messages__status" role="status" aria-live="polite" data-status>Checking your settings…</p>
    <div class="daily-messages__actions">
      <button type="button" class="btn btn-primary" data-turn="on" hidden>Turn on daily messages</button>
      <button type="button" class="btn btn-secondary" data-turn="off" hidden>Turn off daily messages</button>
    </div>
    <p>You can also email Miftah Faizah at <a href="mailto:M.Faizah@leeds.ac.uk">M.Faizah@leeds.ac.uk</a> and we will turn them on or off for you. This doesn’t change anything else about your part in the study.</p>
  </div>
</section>

<script src="{{ '/assets/js/daily-messages.js' | relative_url }}" data-endpoint="{{ site.daily_messages_endpoint }}" defer></script>
