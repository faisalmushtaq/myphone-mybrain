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
const menuToggle = document.querySelector('.menu-toggle');
const siteNav    = document.querySelector('#site-nav');

if (menuToggle && siteNav) {
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!open));
    siteNav.classList.toggle('open', !open);
    document.body.style.overflow = open ? '' : 'hidden';
  });

  siteNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menuToggle.setAttribute('aria-expanded', 'false');
      siteNav.classList.remove('open');
      document.body.style.overflow = '';
    });
  });
}

/* ── School sign-up form (mailto) ───────────────────────── */
const form = document.getElementById('school-interest-form');

if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const get = (name) => {
      const el = form.elements[name];
      if (!el) return '';
      return el.value ? el.value.trim() : '';
    };

    const checks = (name) =>
      [...form.querySelectorAll(`input[name="${name}"]:checked`)]
        .map((cb) => cb.value)
        .join(', ') || 'None selected';

    const recipient = form.dataset.recipient || 'myphone-mybrain@leeds.ac.uk';
    const subject   = encodeURIComponent(`School interest: ${get('school')}`);

    const body = encodeURIComponent([
      `SCHOOL INTEREST — MyPhone/MyBrain`,
      ``,
      `--- School information ---`,
      `School name:       ${get('school')}`,
      `School type:       ${get('school_type')}`,
      `Local authority:   ${get('area')}`,
      `Approx. students:  ${get('school_size')}`,
      ``,
      `--- Contact details ---`,
      `Name:              ${get('name')}`,
      `Role:              ${get('role')}`,
      `Email:             ${get('email')}`,
      `Phone:             ${get('phone') || 'Not provided'}`,
      ``,
      `--- Participation interest ---`,
      `Year groups:       ${checks('year_groups')}`,
      `Topics to discuss: ${checks('interest')}`,
      `How heard:         ${get('how_heard')}`,
      ``,
      `--- Additional information ---`,
      `${get('message') || 'Nothing added.'}`,
      ``,
      `---`,
      `Please do not include pupil names or individual pupil information in replies.`,
    ].join('\n'));

    window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
  });
}
