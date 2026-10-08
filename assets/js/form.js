/* ── Scroll-reveal ──────────────────────────────────────── */
const revealObserver = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      revealObserver.unobserve(e.target);
    }
  }),
  { threshold: 0.12 }
);

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

/* ── Sticky header ──────────────────────────────────────── */
const header = document.querySelector('.site-header');
if (header) {
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 60);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ── Mobile menu toggle ─────────────────────────────────── */
const menuToggle  = document.querySelector('.menu-toggle');
const mobileNav   = document.getElementById('mobile-nav');

if (menuToggle && mobileNav) {
  const openMenu = () => {
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', 'Close navigation menu');
    mobileNav.classList.add('is-open');
    mobileNav.setAttribute('aria-hidden', 'false');
  };

  const closeMenu = () => {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation menu');
    mobileNav.classList.remove('is-open');
    mobileNav.setAttribute('aria-hidden', 'true');
  };

  menuToggle.addEventListener('click', () => {
    menuToggle.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu();
  });

  /* Close when any navigation link is tapped */
  mobileNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  /* Close on Escape key */
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
}

/* ── Enquiry forms: the contact form and the school form ───
   Posts to the enquiry Cloud Function (data-endpoint). With no endpoint
   configured, or if the send fails, falls back to a prepared email. */
(() => {
  const forms = document.querySelectorAll('form[data-kind]');
  if (!forms.length) return;

  const value = (form, name) => {
    const el = form.elements[name];
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  };
  const checked = (form, name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);

  const collect = (form) => {
    const kind = form.dataset.kind;
    const payload = { kind, name: value(form, 'name'), email: value(form, 'email'), message: value(form, 'message'), website: value(form, 'website') };
    if (kind === 'contact') payload.topic = value(form, 'topic');
    if (kind === 'school') Object.assign(payload, { school: value(form, 'school'), role: value(form, 'role'), phone: value(form, 'phone'), area: value(form, 'area'), pupils: value(form, 'pupils'), yearGroups: checked(form, 'year_groups'), canOfferSlots: checked(form, 'slots').length > 0 });
    return payload;
  };

  const problems = (form, p) => {
    const list = [];
    const focus = [];
    const byField = [];
    const need = (ok, name, message) => { if (!ok) { list.push(message); focus.push(name); byField.push([name, message]); } };
    if (p.kind === 'school') {
      need(p.school.length >= 3, 'school', 'Give the school’s name.');
      need(p.role, 'role', 'Give your role at the school.');
    }
    need(p.name, 'name', 'Give your name.');
    need(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email), 'email', 'Give an email address we can reply to.');
    if (p.kind === 'contact') need(p.message, 'message', 'Write your question.');
    if (p.kind === 'school') {
      need(p.yearGroups.length >= 2, 'year_groups', 'Choose at least two year groups: the study needs two or more from each school.');
      need(p.canOfferSlots, 'slots', 'Confirm that your school can offer two-hour session slots for groups of up to 30 pupils.');
    }
    return { list, byField, first: focus[0] ? form.querySelector(`[name="${focus[0]}"]`) : null };
  };

  /* Each problem is also shown next to its own field, so it is on screen where the person is looking. */
  const clearFieldErrors = (form) => {
    form.querySelectorAll('.field-error').forEach((el) => el.remove());
    form.querySelectorAll('[aria-invalid="true"]').forEach((el) => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
  };
  const showFieldErrors = (form, byField) => {
    byField.forEach(([name, message], i) => {
      const fields = [...form.querySelectorAll(`[name="${name}"]`)];
      if (!fields.length) return;
      const holder = fields[0].closest('fieldset') || fields[0].closest('label') || fields[0];
      const note = document.createElement('span');
      note.className = 'field-error';
      note.id = `${form.id || 'form'}-error-${i}`;
      note.textContent = message;
      holder.insertAdjacentElement(holder.tagName === 'INPUT' || holder.tagName === 'TEXTAREA' || holder.tagName === 'SELECT' ? 'afterend' : 'beforeend', note);
      fields.forEach((f) => { f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', note.id); });
    });
  };

  const messageText = (p) => p.kind === 'school'
    ? [`School: ${p.school}`, `Local authority: ${p.area || 'not given'}`, `Approximate pupils: ${p.pupils || 'not given'}`, `Year groups: ${p.yearGroups.join(', ')}`, `Two-hour slots for groups of up to 30: ${p.canOfferSlots ? 'yes' : 'no'}`, '', `Contact: ${p.name}, ${p.role}`, `Email: ${p.email}`, `Phone: ${p.phone || 'not given'}`, '', p.message || ''].join('\n')
    : [`From: ${p.name}`, `Email: ${p.email}`, `Topic: ${p.topic}`, '', p.message].join('\n');

  /* When the send fails: say so plainly, beside the button, and offer to copy the message or open an email draft. Nothing opens by itself. */
  const showFailure = (form, p) => {
    form.querySelector('.form-failure')?.remove();
    const recipient = form.dataset.recipient || 'brainpop@leeds.ac.uk';
    const box = document.createElement('div');
    box.className = 'form-failure';
    box.setAttribute('role', 'alert');
    box.innerHTML = `<p><strong>Sorry, your message has not been sent.</strong> Please email it to <a href="mailto:${recipient}">${recipient}</a>. You can copy what you wrote, or open it in your email app.</p><div class="form-failure__actions"><button type="button" class="btn btn-secondary" data-copy>Copy my message</button><button type="button" class="btn btn-outline" data-mail>Open in my email app</button></div><p class="form-failure__status" aria-live="polite"></p>`;
    const anchor = form.querySelector('.form-submit') || form.querySelector('.contact-form-actions') || form.lastElementChild;
    anchor.insertAdjacentElement('afterend', box);
    const status = box.querySelector('.form-failure__status');
    box.querySelector('[data-copy]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(messageText(p));
        status.textContent = `Copied. Paste it into an email to ${recipient}.`;
      } catch {
        status.textContent = 'Your browser did not allow copying. Select the text in the form and copy it yourself.';
      }
    });
    box.querySelector('[data-mail]').addEventListener('click', () => mailtoFallback(form, p));
    box.scrollIntoView({ block: 'center' });
  };

  const mailtoFallback = (form, p) => {
    const recipient = form.dataset.recipient || 'brainpop@leeds.ac.uk';
    const subject = p.kind === 'school' ? `School enquiry: ${p.school}` : `Website question: ${p.topic}`;
    const body = messageText(p);
    window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  forms.forEach((form) => {
    const status = form.querySelector('.form-status');
    const button = form.querySelector('button[type="submit"]');
    const show = (message) => { status.textContent = message; status.hidden = !message; };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = collect(form);
      const { list, byField, first } = problems(form, payload);
      clearFieldErrors(form);
      form.querySelector('.form-failure')?.remove();
      if (list.length) {
        show(list.length === 1 ? list[0] : `Please check ${list.length} things: ${list.join(' ')}`);
        showFieldErrors(form, byField);
        first?.focus();
        first?.scrollIntoView({ block: 'center' });
        return;
      }
      const endpoint = form.dataset.endpoint;
      if (!endpoint) { mailtoFallback(form, payload); return; }
      show('');
      button.disabled = true;
      const label = button.innerHTML;
      button.textContent = 'Sending…';
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || 'The message could not be sent.');
        const done = document.createElement('div');
        done.className = 'form-success';
        done.setAttribute('role', 'status');
        done.innerHTML = `<h3>Thank you, ${payload.name.split(' ')[0]}.</h3><p>Your message has reached the research team. We reply within five working days, to ${payload.email}.</p>`;
        form.replaceWith(done);
        done.querySelector('h3').setAttribute('tabindex', '-1');
        done.querySelector('h3').focus();
      } catch {
        // Never lose a message: everything stays in the form, and the person can copy it or open an email draft.
        button.disabled = false;
        button.innerHTML = label;
        showFailure(form, payload);
      }
    });
  });
})();

/* ── Copy buttons (the school pages' messages for staff to send families) ── */
document.addEventListener('click', async (e) => {
  const button = e.target instanceof Element ? e.target.closest('[data-copy-from]') : null;
  if (!button) return;
  const source = document.getElementById(button.dataset.copyFrom);
  const status = button.parentElement.querySelector('.copy-status');
  if (!source) return;
  try {
    await navigator.clipboard.writeText(source.value || source.textContent);
    if (status) status.textContent = 'Copied. Paste it into your message to families.';
  } catch {
    // No clipboard access: select the text so it can be copied by hand.
    if (source.select) source.select();
    if (status) status.textContent = 'Your browser did not allow copying. The text is selected: copy it yourself.';
  }
});
