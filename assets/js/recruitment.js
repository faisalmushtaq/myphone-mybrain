/* ── Recruitment paused (5 November 2026) ─────────────────
   When the team pauses new sign-ups on the staff page, the study pages show
   the team's message in any element with data-recruitment-paused="break" (or
   "control"). Reads one public setting from the study's server, open or
   paused, and nothing about anyone. If it cannot be read, nothing changes. */
(() => {
  const boxes = document.querySelectorAll('[data-recruitment-paused]');
  const script = document.currentScript;
  const endpoint = script && script.dataset.endpoint;
  const waitlistEndpoint = script && script.dataset.waitlistEndpoint;

  // The waiting list: one email when recruitment reopens, then the address is deleted.
  document.querySelectorAll('form[data-waitlist]').forEach((form) => {
    const status = form.querySelector('[role="status"]');
    const button = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!waitlistEndpoint) return;
      const email = form.elements.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        status.textContent = 'Please enter a valid email address.';
        form.elements.email.focus();
        return;
      }
      button.disabled = true;
      status.textContent = 'Saving…';
      fetch(waitlistEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, group: form.dataset.waitlist, website: form.elements.website.value }) })
        .then((res) => res.json().catch(() => ({})).then((body) => ({ ok: res.ok, body })))
        .then(({ ok, body }) => {
          if (ok) {
            form.querySelector('.recruitment-waitlist__row').hidden = true;
            status.textContent = 'Thank you. We will email you once when recruitment reopens, then delete your address.';
          } else {
            status.textContent = (body && body.error) || 'That could not be saved. Please try again.';
            button.disabled = false;
          }
        })
        .catch(() => {
          status.textContent = 'We couldn’t reach the server. Check your connection and try again.';
          button.disabled = false;
        });
    });
  });

  if (!boxes.length || !endpoint) return;
  fetch(endpoint, { method: 'GET' })
    .then((res) => (res.ok ? res.json() : null))
    .then((status) => {
      if (!status) return;
      boxes.forEach((box) => {
        const group = status[box.dataset.recruitmentPaused];
        if (!group || group.open !== false) return;
        const text = box.querySelector('[data-recruitment-message]');
        if (text && group.message) text.textContent = group.message;
        box.hidden = false;
      });
    })
    .catch(() => {});
})();
