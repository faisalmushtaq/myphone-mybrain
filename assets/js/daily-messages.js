/* ── Daily messages on or off (16 November 2026) ───────────
   The page /break/messages/?code=… reads and changes one setting for the
   participant in the link: whether the everyday messages are sent. The
   check-ins and the visit reminders are not affected. */
(() => {
  const box = document.querySelector('[data-daily-messages]');
  const script = document.currentScript;
  const endpoint = script && script.dataset.endpoint;
  if (!box || !endpoint) return;
  const status = box.querySelector('[data-status]');
  const offButton = box.querySelector('[data-turn="off"]');
  const onButton = box.querySelector('[data-turn="on"]');
  const code = new URLSearchParams(window.location.search).get('code') || '';

  const show = (off) => {
    status.textContent = off
      ? 'Your daily messages are off. You will still get your weekly check-ins and your visit reminders.'
      : 'Your daily messages are on.';
    offButton.hidden = off;
    onButton.hidden = !off;
  };
  const ask = (body) =>
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((res) => res.json().catch(() => ({})).then((data) => ({ ok: res.ok, data })));
  const failed = (data) => {
    status.textContent = (data && data.error) || 'That didn’t work. Please try again, or email us and we will do it for you.';
  };

  if (!code) {
    status.textContent = 'Please open this page from the link in one of your daily messages, or email us and we will turn them off for you.';
    return;
  }
  ask({ code })
    .then(({ ok, data }) => (ok ? show(Boolean(data.off)) : failed(data)))
    .catch(() => failed(null));

  const change = (off) => {
    offButton.disabled = true;
    onButton.disabled = true;
    status.textContent = 'Saving…';
    ask({ code, off })
      .then(({ ok, data }) => (ok ? show(Boolean(data.off)) : failed(data)))
      .catch(() => failed(null))
      .finally(() => {
        offButton.disabled = false;
        onButton.disabled = false;
      });
  };
  offButton.addEventListener('click', () => change(true));
  onButton.addEventListener('click', () => change(false));
})();
