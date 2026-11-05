/* ── Recruitment paused (5 November 2026) ─────────────────
   When the team pauses new sign-ups on the staff page, the study pages show
   the team's message in any element with data-recruitment-paused="break" (or
   "control"). Reads one public setting from the study's server, open or
   paused, and nothing about anyone. If it cannot be read, nothing changes. */
(() => {
  const boxes = document.querySelectorAll('[data-recruitment-paused]');
  const script = document.currentScript;
  const endpoint = script && script.dataset.endpoint;
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
