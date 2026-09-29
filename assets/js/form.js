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
    const need = (ok, name, message) => { if (!ok) { list.push(message); focus.push(name); } };
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
    return { list, first: focus[0] ? form.querySelector(`[name="${focus[0]}"]`) : null };
  };

  const mailtoFallback = (form, p) => {
    const recipient = form.dataset.recipient || 'brainpop@leeds.ac.uk';
    const subject = p.kind === 'school' ? `School enquiry: ${p.school}` : `Website question: ${p.topic}`;
    const body = p.kind === 'school'
      ? [`School: ${p.school}`, `Local authority: ${p.area || 'not given'}`, `Approximate pupils: ${p.pupils || 'not given'}`, `Year groups: ${p.yearGroups.join(', ')}`, `Two-hour slots for groups of up to 30: ${p.canOfferSlots ? 'yes' : 'no'}`, '', `Contact: ${p.name}, ${p.role}`, `Email: ${p.email}`, `Phone: ${p.phone || 'not given'}`, '', p.message || ''].join('\n')
      : [`From: ${p.name}`, `Email: ${p.email}`, `Topic: ${p.topic}`, '', p.message].join('\n');
    window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  forms.forEach((form) => {
    const status = form.querySelector('.form-status');
    const button = form.querySelector('button[type="submit"]');
    const show = (message) => { status.textContent = message; status.hidden = !message; };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = collect(form);
      const { list, first } = problems(form, payload);
      if (list.length) {
        show(list.join(' '));
        first?.focus();
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
      } catch (error) {
        // Never lose a message: open an email draft with everything filled in.
        button.disabled = false;
        button.innerHTML = label;
        show(`${error.message} We have opened an email to ${form.dataset.recipient || 'brainpop@leeds.ac.uk'} with your message filled in; please press send there.`);
        mailtoFallback(form, payload);
      }
    });
  });
})();
